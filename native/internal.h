#pragma once
#include "bridge.h"
#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <deque>
#include <memory>
#include <mutex>
#include <nlohmann/json.hpp>
#include <stdexcept>
#include <string>
#include <vector>
using json = nlohmann::json;
void sh_error(const std::string &message);
inline void require(bool value, const char *message) {
    if (!value)
        throw std::runtime_error(message);
}
inline void validate(uint32_t rate, uint8_t bits, uint8_t channels) {
    require(channels == 2 && (bits == 16 || bits == 24) &&
                (rate == 44100 || rate == 48000 || rate == 88200 || rate == 96000),
            "UNSUPPORTED_AUDIO_SPEC");
}
inline void bytes_out(ShBytes *out, const uint8_t *data, size_t size) {
    require(out && size <= 256 * 1024, "INVALID_OUTPUT_SIZE");
    out->data = static_cast<uint8_t *>(std::malloc(size));
    require(out->data || size == 0, "OUT_OF_MEMORY");
    out->size = size;
    if (size)
        std::memcpy(out->data, data, size);
}
inline void json_out(ShBytes *out, const json &value) {
    const auto text = value.dump();
    bytes_out(out, reinterpret_cast<const uint8_t *>(text.data()), text.size());
}
inline void pcm_out(ShPcm *out, const std::vector<int32_t> &samples, uint32_t rate, uint8_t bits,
                    uint64_t position = 0) {
    require(out, "INVALID_OUTPUT");
    out->data = static_cast<int32_t *>(std::malloc(samples.size() * sizeof(int32_t)));
    require(out->data || samples.empty(), "OUT_OF_MEMORY");
    out->count = samples.size();
    out->rate = rate;
    out->bits = bits;
    out->channels = 2;
    out->position = position;
    if (!samples.empty())
        std::memcpy(out->data, samples.data(), samples.size() * 4);
}
template <class F> int guarded(F &&fn) {
    try {
        return fn();
    } catch (const std::exception &e) {
        sh_error(e.what());
        return -1;
    } catch (...) {
        sh_error("UNKNOWN_NATIVE_ERROR");
        return -1;
    }
}
struct CaptureQueue {
    std::mutex mutex;
    std::deque<std::vector<int32_t>> chunks;
    uint32_t rate = 0;
    uint8_t bits = 0;
    bool failed = false;
    std::string error;
    size_t frames = 0;
    uint64_t position = 0;
    void push(std::vector<int32_t> chunk) {
        std::lock_guard<std::mutex> lock(mutex);
        if (frames + chunk.size() / 2 > rate * 5) {
            failed = true;
            error = "CAPTURE_BUFFER_OVERFLOW";
            return;
        }
        frames += chunk.size() / 2;
        chunks.push_back(std::move(chunk));
    }
    int read(ShPcm *out) {
        std::lock_guard<std::mutex> lock(mutex);
        if (failed)
            throw std::runtime_error(error);
        if (chunks.empty())
            return 0;
        std::vector<int32_t> samples;
        const size_t target = rate / 10 * 2;
        while (!chunks.empty() && samples.size() < target) {
            auto &front = chunks.front();
            size_t take = std::min(target - samples.size(), front.size());
            samples.insert(samples.end(), front.begin(), front.begin() + take);
            front.erase(front.begin(), front.begin() + take);
            frames -= take / 2;
            if (front.empty())
                chunks.pop_front();
        }
        pcm_out(out, samples, rate, bits, position);
        position += samples.size() / 2 * 1000 / rate;
        return 1;
    }
};
