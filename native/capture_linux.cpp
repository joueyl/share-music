#include "internal.h"
#include <atomic>
#include <pipewire/pipewire.h>
#include <spa/param/audio/format-utils.h>
#include <spa/utils/result.h>
// The PipeWire callback writes to a preallocated SPSC ring: no allocation,
// mutex acquisition, file I/O or network I/O on the realtime audio thread.
struct LinuxCapture {
    pw_thread_loop *loop = nullptr;
    pw_stream *stream = nullptr;
    spa_hook listener{};
    uint32_t rate;
    uint8_t bits;
    std::vector<int32_t> ring;
    std::atomic<size_t> write{0}, read{0};
    std::atomic<int> failure{0};
    uint64_t position = 0;
    ~LinuxCapture() {
        if (loop) {
            pw_thread_loop_stop(loop);
            if (stream) {
                pw_stream_disconnect(stream);
                pw_stream_destroy(stream);
            }
            pw_thread_loop_destroy(loop);
        }
    }
};
static void changed(void *data, pw_stream_state, pw_stream_state state, const char *) {
    auto *c = static_cast<LinuxCapture *>(data);
    if (state == PW_STREAM_STATE_ERROR)
        c->failure.store(1, std::memory_order_release);
}
static void format(void *data, uint32_t id, const spa_pod *param) {
    if (id != SPA_PARAM_Format || !param)
        return;
    auto *c = static_cast<LinuxCapture *>(data);
    spa_audio_info_raw info{};
    if (spa_format_audio_raw_parse(param, &info) < 0 || info.channels != 2 ||
        info.rate != c->rate || info.format != SPA_AUDIO_FORMAT_S32_LE)
        c->failure.store(2, std::memory_order_release);
}
static void process(void *data) {
    auto *c = static_cast<LinuxCapture *>(data);
    pw_buffer *buffer = pw_stream_dequeue_buffer(c->stream);
    if (!buffer)
        return;
    auto *raw = buffer->buffer;
    if (raw->n_datas == 0 || !raw->datas[0].data || !raw->datas[0].chunk) {
        pw_stream_queue_buffer(c->stream, buffer);
        return;
    }
    auto &audio = raw->datas[0];
    size_t size = std::min<size_t>(audio.chunk->size, audio.maxsize),
           offset = audio.chunk->offset % audio.maxsize;
    size_t count = std::min(size, audio.maxsize - offset) / sizeof(int32_t);
    count -= count % 2;
    const int32_t *samples =
        reinterpret_cast<const int32_t *>(static_cast<const uint8_t *>(audio.data) + offset);
    size_t write = c->write.load(std::memory_order_relaxed),
           read = c->read.load(std::memory_order_acquire);
    if (write - read + count > c->ring.size()) {
        c->failure.store(3, std::memory_order_release);
    } else {
        for (size_t i = 0; i < count; i++)
            c->ring[(write + i) % c->ring.size()] = samples[i] >> (32 - c->bits);
        c->write.store(write + count, std::memory_order_release);
    }
    pw_stream_queue_buffer(c->stream, buffer);
}
static const pw_stream_events events = {.version = PW_VERSION_STREAM_EVENTS, .state_changed = changed,
                                        .param_changed = format, .process = process};
static void initialize() {
    static std::once_flag once;
    std::call_once(once, [] { pw_init(nullptr, nullptr); });
}
struct DeviceList {
    pw_thread_loop *loop = nullptr;
    pw_context *context = nullptr;
    pw_core *core = nullptr;
    pw_registry *registry = nullptr;
    spa_hook registry_listener{}, core_listener{};
    json list = json::array();
    int sync = 0;
    bool done = false;
    ~DeviceList() {
        if (loop) {
            pw_thread_loop_stop(loop);
            if (registry)
                pw_proxy_destroy(reinterpret_cast<pw_proxy *>(registry));
            if (core)
                pw_core_disconnect(core);
            if (context)
                pw_context_destroy(context);
            pw_thread_loop_destroy(loop);
        }
    }
};
static void global(void *data, uint32_t id, uint32_t, const char *type, uint32_t,
                   const spa_dict *props) {
    if (std::strcmp(type, PW_TYPE_INTERFACE_Node) != 0 || !props)
        return;
    const char *cls = spa_dict_lookup(props, PW_KEY_MEDIA_CLASS);
    if (!cls || std::strcmp(cls, "Audio/Sink") != 0)
        return;
    auto *d = static_cast<DeviceList *>(data);
    const char *name = spa_dict_lookup(props, PW_KEY_NODE_DESCRIPTION);
    if (!name)
        name = spa_dict_lookup(props, PW_KEY_NODE_NAME);
    const char *serial = spa_dict_lookup(props, PW_KEY_OBJECT_SERIAL);
    d->list.push_back(
        json{{"id", serial ? serial : std::to_string(id)}, {"name", name ? name : "Audio output"}});
}
static void done(void *data, uint32_t, int seq) {
    auto *d = static_cast<DeviceList *>(data);
    if (seq == d->sync) {
        d->done = true;
        pw_thread_loop_signal(d->loop, false);
    }
}
extern "C" int sh_capture_devices(ShBytes *out) {
    return guarded([&] {
        initialize();
        DeviceList d;
        d.loop = pw_thread_loop_new("music-devices", nullptr);
        require(d.loop, "PIPEWIRE_LOOP_FAILED");
        d.context = pw_context_new(pw_thread_loop_get_loop(d.loop), nullptr, 0);
        require(d.context, "PIPEWIRE_CONTEXT_FAILED");
        d.core = pw_context_connect(d.context, nullptr, 0);
        require(d.core, "PIPEWIRE_CONNECTION_FAILED");
        d.registry = pw_core_get_registry(d.core, PW_VERSION_REGISTRY, 0);
        const pw_registry_events registry_events = {.version = PW_VERSION_REGISTRY_EVENTS, .global = global};
        const pw_core_events core_events = {.version = PW_VERSION_CORE_EVENTS, .done = done};
        pw_registry_add_listener(d.registry, &d.registry_listener, &registry_events, &d);
        pw_core_add_listener(d.core, &d.core_listener, &core_events, &d);
        require(pw_thread_loop_start(d.loop) == 0, "PIPEWIRE_START_FAILED");
        pw_thread_loop_lock(d.loop);
        d.sync = pw_core_sync(d.core, PW_ID_CORE, 0);
        while (!d.done) {
            if (pw_thread_loop_timed_wait(d.loop, 3) == -ETIMEDOUT)
                break;
        }
        pw_thread_loop_unlock(d.loop);
        require(d.done, "PIPEWIRE_DEVICE_TIMEOUT");
        json_out(out, d.list);
        return 1;
    });
}
extern "C" void *sh_capture_open(const char *device, uint32_t rate, uint8_t bits, ShBytes *out) {
    try {
        initialize();
        validate(rate, bits, 2);
        auto c = std::make_unique<LinuxCapture>();
        c->rate = rate;
        c->bits = bits;
        c->ring.resize(rate * 2 * 5);
        c->loop = pw_thread_loop_new("music-capture", nullptr);
        require(c->loop, "PIPEWIRE_LOOP_FAILED");
        auto *props =
            pw_properties_new(PW_KEY_MEDIA_TYPE, "Audio", PW_KEY_MEDIA_CATEGORY, "Capture",
                              PW_KEY_MEDIA_ROLE, "Music", "stream.capture.sink", "true", nullptr);
        if (std::strcmp(device, "default") != 0)
            pw_properties_set(props, PW_KEY_TARGET_OBJECT, device);
        c->stream = pw_stream_new_simple(pw_thread_loop_get_loop(c->loop),
                                         "Music Share system audio", props, &events, c.get());
        require(c->stream, "PIPEWIRE_STREAM_FAILED");
        uint8_t memory[1024];
        spa_pod_builder builder = SPA_POD_BUILDER_INIT(memory, sizeof(memory));
        spa_audio_info_raw info{};
        info.format = SPA_AUDIO_FORMAT_S32_LE;
        info.rate = rate;
        info.channels = 2;
        info.position[0] = SPA_AUDIO_CHANNEL_FL;
        info.position[1] = SPA_AUDIO_CHANNEL_FR;
        const spa_pod *params[] = {
            spa_format_audio_raw_build(&builder, SPA_PARAM_EnumFormat, &info)};
        require(pw_stream_connect(c->stream, PW_DIRECTION_INPUT, PW_ID_ANY,
                                  static_cast<pw_stream_flags>(PW_STREAM_FLAG_AUTOCONNECT |
                                                               PW_STREAM_FLAG_MAP_BUFFERS |
                                                               PW_STREAM_FLAG_RT_PROCESS),
                                  params, 1) >= 0,
                "PIPEWIRE_CONNECT_FAILED");
        require(pw_thread_loop_start(c->loop) == 0, "PIPEWIRE_START_FAILED");
        json_out(out, json{{"sampleRate", rate},
                           {"bits", bits},
                           {"channels", 2},
                           {"integerConversion", true}});
        return c.release();
    } catch (const std::exception &e) {
        sh_error(e.what());
        return nullptr;
    }
}
extern "C" int sh_capture_read(void *handle, ShPcm *out) {
    return guarded([&] {
        require(handle, "INVALID_CAPTURE");
        auto *c = static_cast<LinuxCapture *>(handle);
        require(c->failure.load(std::memory_order_acquire) == 0,
                "PIPEWIRE_CAPTURE_FAILED_OR_OVERFLOW");
        size_t read = c->read.load(std::memory_order_relaxed),
               write = c->write.load(std::memory_order_acquire);
        size_t count = std::min(write - read, static_cast<size_t>(c->rate / 10 * 2));
        if (!count)
            return 0;
        std::vector<int32_t> pcm(count);
        for (size_t i = 0; i < count; i++)
            pcm[i] = c->ring[(read + i) % c->ring.size()];
        c->read.store(read + count, std::memory_order_release);
        pcm_out(out, pcm, c->rate, c->bits, c->position);
        c->position += count / 2 * 1000 / c->rate;
        return 1;
    });
}
extern "C" void sh_capture_close(void *handle) {
    delete static_cast<LinuxCapture *>(handle);
}
