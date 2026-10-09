#include "internal.h"
#include <FLAC/stream_decoder.h>
#include <FLAC/stream_encoder.h>
#include <SDL.h>
#include <limits>
#include <memory>
#include <opus/opus.h>
extern "C" {
#include <libavcodec/avcodec.h>
#include <libavformat/avformat.h>
#include <libavutil/channel_layout.h>
#include <libswresample/swresample.h>
}
static thread_local std::string last_error;
void sh_error(const std::string &message) {
    last_error = message;
}
extern "C" uint32_t sh_abi_version() {
    return 1;
}
extern "C" const char *sh_last_error() {
    return last_error.c_str();
}
extern "C" void sh_free(void *ptr) {
    std::free(ptr);
}
static void av_check(int result, const char *operation) {
    if (result < 0) {
        char error[AV_ERROR_MAX_STRING_SIZE];
        av_strerror(result, error, sizeof(error));
        throw std::runtime_error(std::string(operation) + ": " + error);
    }
}
static FLAC__StreamEncoderWriteStatus flac_write(const FLAC__StreamEncoder *,
                                                 const FLAC__byte data[], size_t bytes, uint32_t,
                                                 uint32_t, void *client) {
    auto *output = static_cast<std::vector<uint8_t> *>(client);
    if (output->size() + bytes > 256 * 1024)
        return FLAC__STREAM_ENCODER_WRITE_STATUS_FATAL_ERROR;
    output->insert(output->end(), data, data + bytes);
    return FLAC__STREAM_ENCODER_WRITE_STATUS_OK;
}
struct FlacReader {
    const uint8_t *data;
    size_t size, position = 0;
    uint32_t rate;
    uint8_t bits;
    std::vector<int32_t> output;
    bool failed = false;
};
static FLAC__StreamDecoderReadStatus flac_read(const FLAC__StreamDecoder *, FLAC__byte *buffer,
                                               size_t *count, void *client) {
    auto *r = static_cast<FlacReader *>(client);
    *count = std::min(*count, r->size - r->position);
    if (!*count)
        return FLAC__STREAM_DECODER_READ_STATUS_END_OF_STREAM;
    std::memcpy(buffer, r->data + r->position, *count);
    r->position += *count;
    return FLAC__STREAM_DECODER_READ_STATUS_CONTINUE;
}
static FLAC__StreamDecoderWriteStatus flac_pcm(const FLAC__StreamDecoder *,
                                               const FLAC__Frame *frame,
                                               const FLAC__int32 *const samples[], void *client) {
    auto *r = static_cast<FlacReader *>(client);
    if (frame->header.channels != 2 || frame->header.sample_rate != r->rate ||
        frame->header.bits_per_sample != r->bits ||
        r->output.size() + frame->header.blocksize * 2 > r->rate / 5 * 2) {
        r->failed = true;
        return FLAC__STREAM_DECODER_WRITE_STATUS_ABORT;
    }
    for (uint32_t i = 0; i < frame->header.blocksize; i++) {
        r->output.push_back(samples[0][i]);
        r->output.push_back(samples[1][i]);
    }
    return FLAC__STREAM_DECODER_WRITE_STATUS_CONTINUE;
}
static void flac_error(const FLAC__StreamDecoder *, FLAC__StreamDecoderErrorStatus, void *client) {
    static_cast<FlacReader *>(client)->failed = true;
}
static std::vector<float> resample_float(const std::vector<float> &input, uint32_t from,
                                         uint32_t to) {
    if (from == to)
        return input;
    AVChannelLayout stereo = AV_CHANNEL_LAYOUT_STEREO;
    SwrContext *context = nullptr;
    av_check(swr_alloc_set_opts2(&context, &stereo, AV_SAMPLE_FMT_FLT, to, &stereo,
                                 AV_SAMPLE_FMT_FLT, from, 0, nullptr),
             "resampler");
    std::unique_ptr<SwrContext, void (*)(SwrContext *)> guard(context,
                                                              [](SwrContext *c) { swr_free(&c); });
    av_check(swr_init(context), "resampler init");
    const int frames = static_cast<int>(input.size() / 2),
              capacity = static_cast<int>(av_rescale_rnd(frames + 64, to, from, AV_ROUND_UP)) + 128;
    std::vector<float> output(capacity * 2);
    const uint8_t *src[] = {reinterpret_cast<const uint8_t *>(input.data())};
    uint8_t *dest[] = {reinterpret_cast<uint8_t *>(output.data())};
    int written = swr_convert(context, dest, capacity, src, frames);
    av_check(written, "resample");
    uint8_t *tail[] = {reinterpret_cast<uint8_t *>(output.data() + written * 2)};
    int flushed = swr_convert(context, tail, capacity - written, nullptr, 0);
    av_check(flushed, "resample flush");
    output.resize((written + flushed) * 2);
    return output;
}
extern "C" int sh_encode(const int32_t *samples, size_t count, uint32_t rate, uint8_t bits,
                         uint8_t channels, uint8_t codec, ShBytes *out) {
    return guarded([&] {
        validate(rate, bits, channels);
        require(samples && count > 0 && count % 2 == 0 && count <= rate / 5 * 2,
                "INVALID_PCM_BLOCK");
        std::vector<uint8_t> encoded;
        if (codec == 1) {
            auto *encoder = FLAC__stream_encoder_new();
            require(encoder, "FLAC_ALLOC_FAILED");
            std::unique_ptr<FLAC__StreamEncoder, void (*)(FLAC__StreamEncoder *)> guard(
                encoder, FLAC__stream_encoder_delete);
            FLAC__stream_encoder_set_channels(encoder, 2);
            FLAC__stream_encoder_set_bits_per_sample(encoder, bits);
            FLAC__stream_encoder_set_sample_rate(encoder, rate);
            FLAC__stream_encoder_set_compression_level(encoder, 3);
            FLAC__stream_encoder_set_verify(encoder, true);
            FLAC__stream_encoder_set_total_samples_estimate(encoder, count / 2);
            require(FLAC__stream_encoder_init_stream(encoder, flac_write, nullptr, nullptr, nullptr,
                                                     &encoded) ==
                        FLAC__STREAM_ENCODER_INIT_STATUS_OK,
                    "FLAC_INIT_FAILED");
            require(FLAC__stream_encoder_process_interleaved(encoder, samples, count / 2),
                    "FLAC_ENCODE_FAILED");
            require(FLAC__stream_encoder_finish(encoder), "FLAC_FINISH_FAILED");
        } else if (codec == 2) {
            std::vector<float> input(count);
            const double scale = std::ldexp(1.0, bits - 1);
            for (size_t i = 0; i < count; i++)
                input[i] = static_cast<float>(samples[i] / scale);
            auto audio = resample_float(input, rate, 48000);
            int lookahead = 0;
            int error = 0;
            auto *encoder = opus_encoder_create(48000, 2, OPUS_APPLICATION_AUDIO, &error);
            require(encoder && error == OPUS_OK, "OPUS_INIT_FAILED");
            std::unique_ptr<OpusEncoder, void (*)(OpusEncoder *)> guard(encoder,
                                                                        opus_encoder_destroy);
            opus_encoder_ctl(encoder, OPUS_SET_BITRATE(192000));
            opus_encoder_ctl(encoder, OPUS_GET_LOOKAHEAD(&lookahead));
            const size_t frames = audio.size() / 2, packets = (frames + lookahead + 959) / 960;
            require(packets <= 12, "OPUS_BLOCK_TOO_LARGE");
            encoded.resize(8);
            uint32_t original = static_cast<uint32_t>(count / 2);
            for (int i = 0; i < 4; i++)
                encoded[i] = (original >> (i * 8)) & 255;
            encoded[4] = packets & 255;
            encoded[5] = packets >> 8;
            encoded[6] = lookahead & 255;
            encoded[7] = (lookahead >> 8) & 255;
            audio.resize(packets * 960 * 2, 0);
            for (size_t i = 0; i < packets; i++) {
                uint8_t packet[4096];
                int size = opus_encode_float(encoder, audio.data() + i * 960 * 2, 960, packet,
                                             sizeof(packet));
                require(size > 0, "OPUS_ENCODE_FAILED");
                encoded.push_back(size & 255);
                encoded.push_back((size >> 8) & 255);
                encoded.insert(encoded.end(), packet, packet + size);
            }
        } else
            throw std::runtime_error("UNKNOWN_CODEC");
        bytes_out(out, encoded.data(), encoded.size());
        return 1;
    });
}
extern "C" int sh_decode(const uint8_t *bytes, size_t size, uint8_t codec, uint32_t rate,
                         uint8_t bits, uint8_t channels, ShPcm *out) {
    return guarded([&] {
        validate(rate, bits, channels);
        require(bytes && size > 0 && size <= 256 * 1024, "INVALID_ENCODED_BLOCK");
        std::vector<int32_t> decoded;
        if (codec == 1) {
            FlacReader reader{bytes, size, 0, rate, bits, {}, false};
            auto *decoder = FLAC__stream_decoder_new();
            require(decoder, "FLAC_ALLOC_FAILED");
            std::unique_ptr<FLAC__StreamDecoder, void (*)(FLAC__StreamDecoder *)> guard(
                decoder, FLAC__stream_decoder_delete);
            FLAC__stream_decoder_set_md5_checking(decoder, true);
            require(FLAC__stream_decoder_init_stream(
                        decoder, flac_read, nullptr, nullptr, nullptr, nullptr, flac_pcm, nullptr,
                        flac_error, &reader) == FLAC__STREAM_DECODER_INIT_STATUS_OK,
                    "FLAC_DECODE_INIT_FAILED");
            require(FLAC__stream_decoder_process_until_end_of_stream(decoder) && !reader.failed,
                    "FLAC_CORRUPT_BLOCK");
            require(FLAC__stream_decoder_finish(decoder), "FLAC_MD5_MISMATCH");
            decoded = std::move(reader.output);
        } else if (codec == 2) {
            require(size >= 8, "OPUS_CORRUPT_BLOCK");
            uint32_t original = bytes[0] | uint32_t(bytes[1]) << 8 | uint32_t(bytes[2]) << 16 |
                                uint32_t(bytes[3]) << 24;
            uint16_t count = bytes[4] | uint16_t(bytes[5]) << 8;
            uint16_t lookahead = bytes[6] | uint16_t(bytes[7]) << 8;
            require(lookahead <= 5760, "OPUS_INVALID_LOOKAHEAD");
            require(original > 0 && original <= rate / 5 && count > 0 && count <= 12,
                    "OPUS_CORRUPT_BLOCK");
            int error;
            auto *decoder = opus_decoder_create(48000, 2, &error);
            require(decoder && error == OPUS_OK, "OPUS_DECODE_INIT_FAILED");
            std::unique_ptr<OpusDecoder, void (*)(OpusDecoder *)> guard(decoder,
                                                                        opus_decoder_destroy);
            std::vector<float> audio;
            size_t position = 8;
            for (uint16_t i = 0; i < count; i++) {
                require(position + 2 <= size, "OPUS_CORRUPT_BLOCK");
                size_t length = bytes[position] | size_t(bytes[position + 1]) << 8;
                position += 2;
                require(length > 0 && length <= 4096 && position + length <= size,
                        "OPUS_CORRUPT_BLOCK");
                float frame[5760 * 2];
                int frames = opus_decode_float(decoder, bytes + position, length, frame, 5760, 0);
                require(frames > 0, "OPUS_DECODE_FAILED");
                audio.insert(audio.end(), frame, frame + frames * 2);
                position += length;
            }
            require(position == size, "OPUS_TRAILING_DATA");
            require(audio.size() >= lookahead * 2, "OPUS_INVALID_LOOKAHEAD");
            audio.erase(audio.begin(), audio.begin() + lookahead * 2);
            audio = resample_float(audio, 48000, rate);
            audio.resize(original * 2, 0);
            decoded.resize(original * 2);
            double scale = std::ldexp(1.0, bits - 1);
            for (size_t i = 0; i < decoded.size(); i++)
                decoded[i] =
                    static_cast<int32_t>(std::clamp<double>(audio[i] * scale, -scale, scale - 1));
        } else
            throw std::runtime_error("UNKNOWN_CODEC");
        require(!decoded.empty(), "EMPTY_DECODED_BLOCK");
        pcm_out(out, decoded, rate, bits);
        return 1;
    });
}

struct AudioFile {
    AVFormatContext *format = nullptr;
    AVCodecContext *codec = nullptr;
    AVFrame *frame = nullptr;
    AVPacket *packet = nullptr;
    SwrContext *swr = nullptr;
    int stream = -1;
    uint32_t rate = 0;
    uint8_t bits = 0;
    bool draining = false, finished = false;
    uint64_t position_frames = 0, seek_frames = 0;
    std::vector<int32_t> queued;
    ~AudioFile() {
        swr_free(&swr);
        av_packet_free(&packet);
        av_frame_free(&frame);
        avcodec_free_context(&codec);
        avformat_close_input(&format);
    }
    void decode_more() {
        while (!finished) {
            int result = avcodec_receive_frame(codec, frame);
            if (result == 0) {
                std::vector<int32_t> converted(frame->nb_samples * 2);
                uint8_t *dst[] = {reinterpret_cast<uint8_t *>(converted.data())};
                int n = swr_convert(swr, dst, frame->nb_samples,
                                    const_cast<const uint8_t **>(frame->extended_data),
                                    frame->nb_samples);
                av_check(n, "convert decoded PCM");
                converted.resize(n * 2);
                for (auto &value : converted)
                    value >>= (32 - bits);
                int64_t timestamp = frame->best_effort_timestamp;
                const auto *st = format->streams[stream];
                uint64_t start =
                    timestamp == AV_NOPTS_VALUE
                        ? position_frames
                        : static_cast<uint64_t>(std::max<int64_t>(
                              0, av_rescale_q(
                                     timestamp -
                                         (st->start_time == AV_NOPTS_VALUE ? 0 : st->start_time),
                                     st->time_base, AVRational{1, static_cast<int>(rate)})));
                if (start + n <= seek_frames) {
                    av_frame_unref(frame);
                    continue;
                }
                size_t skip =
                    seek_frames > start ? std::min<uint64_t>(seek_frames - start, n) * 2 : 0;
                if (queued.empty())
                    position_frames = start + skip / 2;
                queued.insert(queued.end(), converted.begin() + skip, converted.end());
                seek_frames = 0;
                av_frame_unref(frame);
                return;
            }
            if (result == AVERROR_EOF) {
                finished = true;
                return;
            }
            if (result != AVERROR(EAGAIN))
                av_check(result, "decode frame");
            if (draining) {
                finished = true;
                return;
            }
            while (true) {
                result = av_read_frame(format, packet);
                if (result == AVERROR_EOF) {
                    av_check(avcodec_send_packet(codec, nullptr), "flush decoder");
                    draining = true;
                    break;
                }
                av_check(result, "read file");
                if (packet->stream_index == stream) {
                    result = avcodec_send_packet(codec, packet);
                    av_packet_unref(packet);
                    av_check(result, "decode packet");
                    break;
                }
                av_packet_unref(packet);
            }
        }
    }
};
extern "C" void *sh_file_open(const char *path, ShBytes *metadata) {
    try {
        require(path && metadata, "INVALID_PATH");
        auto f = std::make_unique<AudioFile>();
        av_check(avformat_open_input(&f->format, path, nullptr, nullptr), "open music file");
        av_check(avformat_find_stream_info(f->format, nullptr), "read music metadata");
        const AVCodec *decoder = nullptr;
        f->stream = av_find_best_stream(f->format, AVMEDIA_TYPE_AUDIO, -1, -1, &decoder, 0);
        av_check(f->stream, "find audio stream");
        auto *stream = f->format->streams[f->stream];
        f->codec = avcodec_alloc_context3(decoder);
        require(f->codec, "CODEC_ALLOC_FAILED");
        av_check(avcodec_parameters_to_context(f->codec, stream->codecpar), "codec parameters");
        av_check(avcodec_open2(f->codec, decoder, nullptr), "open decoder");
        f->rate = f->codec->sample_rate;
        bool lossless =
            (avcodec_descriptor_get(f->codec->codec_id)->props & AV_CODEC_PROP_LOSSLESS) != 0;
        int bits = f->codec->bits_per_raw_sample;
        if (!bits)
            bits = av_get_bits_per_sample(f->codec->codec_id);
        if (!lossless)
            bits = 24;
        f->bits = static_cast<uint8_t>(bits);
        validate(f->rate, f->bits, f->codec->ch_layout.nb_channels);
        AVChannelLayout stereo = AV_CHANNEL_LAYOUT_STEREO;
        av_check(swr_alloc_set_opts2(&f->swr, &stereo, AV_SAMPLE_FMT_S32, f->rate,
                                     &f->codec->ch_layout, f->codec->sample_fmt, f->rate, 0,
                                     nullptr),
                 "sample format conversion");
        av_check(swr_init(f->swr), "conversion init");
        f->frame = av_frame_alloc();
        f->packet = av_packet_alloc();
        require(f->frame && f->packet, "FRAME_ALLOC_FAILED");
        int64_t duration =
            stream->duration != AV_NOPTS_VALUE
                ? av_rescale_q(stream->duration, stream->time_base, AVRational{1, 1000})
                : f->format->duration / 1000;
        require(duration > 0 && duration <= 86400000, "INVALID_DURATION");
        // Admission uses the conservative decoded PCM rate, including lossy sources
        // re-encoded as FLAC. Container bitrate would underestimate wire demand.
        int64_t bitrate = int64_t(f->rate) * f->bits * 2;
        json_out(metadata,
                 json{{"durationMs", duration},
                      {"lossless", lossless},
                      {"bitrateBps", bitrate},
                      {"spec", {{"sampleRate", f->rate}, {"bits", f->bits}, {"channels", 2}}}});
        return f.release();
    } catch (const std::exception &e) {
        sh_error(e.what());
        return nullptr;
    }
}
extern "C" int sh_file_read(void *handle, ShPcm *out) {
    return guarded([&] {
        require(handle, "INVALID_FILE");
        auto *f = static_cast<AudioFile *>(handle);
        size_t target = f->rate / 10 * 2;
        while (f->queued.size() < target && !f->finished)
            f->decode_more();
        if (f->queued.empty())
            return 0;
        size_t count = std::min(target, f->queued.size());
        std::vector<int32_t> samples(f->queued.begin(), f->queued.begin() + count);
        pcm_out(out, samples, f->rate, f->bits, f->position_frames * 1000 / f->rate);
        f->queued.erase(f->queued.begin(), f->queued.begin() + count);
        f->position_frames += count / 2;
        return 1;
    });
}
extern "C" int sh_file_seek(void *handle, uint64_t position) {
    return guarded([&] {
        require(handle, "INVALID_FILE");
        auto *f = static_cast<AudioFile *>(handle);
        auto *st = f->format->streams[f->stream];
        int64_t timestamp = av_rescale_q(position, AVRational{1, 1000}, st->time_base) +
                            (st->start_time == AV_NOPTS_VALUE ? 0 : st->start_time);
        av_check(av_seek_frame(f->format, f->stream, timestamp, AVSEEK_FLAG_BACKWARD), "seek file");
        avcodec_flush_buffers(f->codec);
        swr_close(f->swr);
        av_check(swr_init(f->swr), "reset sample conversion");
        f->draining = false;
        f->finished = false;
        f->queued.clear();
        f->position_frames = position * f->rate / 1000;
        f->seek_frames = f->position_frames;
        return 1;
    });
}
extern "C" void sh_file_close(void *handle) {
    delete static_cast<AudioFile *>(handle);
}
struct Output {
    SDL_AudioDeviceID id = 0;
    uint32_t rate = 0;
    uint8_t bits = 0;
    ~Output() {
        if (id)
            SDL_CloseAudioDevice(id);
    }
};
extern "C" void *sh_output_open(uint32_t rate, uint8_t bits, uint8_t channels) {
    try {
        validate(rate, bits, channels);
        require(SDL_InitSubSystem(SDL_INIT_AUDIO) == 0, SDL_GetError());
        auto output = std::make_unique<Output>();
        output->rate = rate;
        output->bits = bits;
        SDL_AudioSpec spec{}, obtained{};
        spec.freq = rate;
        spec.format = AUDIO_S32SYS;
        spec.channels = 2;
        spec.samples = 256;
        output->id = SDL_OpenAudioDevice(nullptr, 0, &spec, &obtained, 0);
        require(output->id != 0, SDL_GetError());
        require(obtained.freq == static_cast<int>(rate) && obtained.format == AUDIO_S32SYS &&
                    obtained.channels == 2,
                "OUTPUT_SPEC_MISMATCH");
        SDL_PauseAudioDevice(output->id, 0);
        return output.release();
    } catch (const std::exception &e) {
        sh_error(e.what());
        return nullptr;
    }
}
// Input PCM is right-aligned 16/24 bit; output scaling is handled by the worker.
extern "C" int sh_output_queue(void *handle, const int32_t *samples, size_t count, float volume) {
    return guarded([&] {
        require(handle && samples && count % 2 == 0 && std::isfinite(volume) && volume >= 0 &&
                    volume <= 1,
                "INVALID_OUTPUT_PCM");
        auto *output = static_cast<Output *>(handle);
        require(SDL_GetQueuedAudioSize(output->id) <= output->rate * 8, "OUTPUT_BACKPRESSURE");
        std::vector<int32_t> audio(count);
        for (size_t i = 0; i < count; i++)
            audio[i] = static_cast<int32_t>(std::clamp<double>(
                static_cast<double>(samples[i]) * (1u << (32 - output->bits)) * volume,
                -2147483648.0, 2147483647.0));
        require(SDL_QueueAudio(output->id, audio.data(), audio.size() * 4) == 0, SDL_GetError());
        return 1;
    });
}
extern "C" uint64_t sh_output_queued(void *handle) {
    auto *output = static_cast<Output *>(handle);
    return output ? SDL_GetQueuedAudioSize(output->id) * 1000ull / (output->rate * 8) : 0;
}
extern "C" void sh_output_close(void *handle) {
    delete static_cast<Output *>(handle);
}
