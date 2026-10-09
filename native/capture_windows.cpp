#define NOMINMAX
#include "internal.h"
// clang-format off: the Windows SDK property macros require this include order.
#include <windows.h>
#include <propkeydef.h>
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <functiondiscoverykeys_devpkey.h>
#include <ks.h>
#include <ksmedia.h>
#include <wrl/client.h>
// clang-format on
using Microsoft::WRL::ComPtr;
static void check(HRESULT value, const char *message) {
    if (FAILED(value))
        throw std::runtime_error(std::string(message) + " (HRESULT " +
                                 std::to_string(static_cast<uint32_t>(value)) + ")");
}
static std::string utf8(const wchar_t *value) {
    int n = WideCharToMultiByte(CP_UTF8, 0, value, -1, nullptr, 0, nullptr, nullptr);
    std::string s(n, '\0');
    WideCharToMultiByte(CP_UTF8, 0, value, -1, s.data(), n, nullptr, nullptr);
    s.pop_back();
    return s;
}
static std::wstring wide(const char *value) {
    int n = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value, -1, nullptr, 0);
    require(n > 0, "INVALID_DEVICE_ID");
    std::wstring s(n, L'\0');
    MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value, -1, s.data(), n);
    return s;
}
struct ComInit {
    bool owned = false;
    ComInit() {
        HRESULT r = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
        if (r == S_OK || r == S_FALSE)
            owned = true;
        else if (r != RPC_E_CHANGED_MODE)
            check(r, "COM initialization failed");
        // An existing STA belongs to its caller. Borrow it, never uninitialize it.
    }
    ~ComInit() {
        if (owned)
            CoUninitialize();
    }
};
struct Capture {
    ComInit com;
    ComPtr<IMMDeviceEnumerator> enumerator;
    ComPtr<IMMDevice> device;
    ComPtr<IAudioClient> client;
    ComPtr<IAudioCaptureClient> capture;
    WAVEFORMATEX *format = nullptr;
    uint32_t rate;
    uint8_t bits;
    bool floating = false;
    uint16_t valid_bits = 0;
    ~Capture() {
        if (client)
            client->Stop();
        CoTaskMemFree(format);
    }
};
extern "C" int sh_capture_devices(ShBytes *out) {
    return guarded([&] {
        ComInit com;
        ComPtr<IMMDeviceEnumerator> e;
        check(CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL, IID_PPV_ARGS(&e)),
              "device enumerator");
        ComPtr<IMMDeviceCollection> devices;
        check(e->EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE, &devices), "list outputs");
        UINT count = 0;
        devices->GetCount(&count);
        json list = json::array();
        std::string default_id;
        ComPtr<IMMDevice> default_device;
        if (SUCCEEDED(e->GetDefaultAudioEndpoint(eRender, eMultimedia, &default_device))) {
            LPWSTR value = nullptr;
            if (SUCCEEDED(default_device->GetId(&value))) {
                default_id = utf8(value);
                CoTaskMemFree(value);
            }
        }
        for (UINT i = 0; i < count; i++) {
            ComPtr<IMMDevice> device;
            devices->Item(i, &device);
            LPWSTR id = nullptr;
            device->GetId(&id);
            ComPtr<IPropertyStore> props;
            device->OpenPropertyStore(STGM_READ, &props);
            PROPVARIANT name;
            PropVariantInit(&name);
            if (props)
                props->GetValue(PKEY_Device_FriendlyName, &name);
            json info{{"id", utf8(id)},
                      {"name", name.vt == VT_LPWSTR ? utf8(name.pwszVal) : "Audio output"},
                      {"isDefault", utf8(id) == default_id}};
            ComPtr<IAudioClient> client;
            WAVEFORMATEX *mix = nullptr;
            if (SUCCEEDED(device->Activate(__uuidof(IAudioClient), CLSCTX_ALL, nullptr,
                                           reinterpret_cast<void **>(client.GetAddressOf()))) &&
                SUCCEEDED(client->GetMixFormat(&mix))) {
                info["sampleRate"] = mix->nSamplesPerSec;
                info["channels"] = mix->nChannels;
                info["deviceBits"] = mix->wBitsPerSample;
                bool floating = mix->wFormatTag == WAVE_FORMAT_IEEE_FLOAT;
                uint16_t valid_bits = mix->wBitsPerSample;
                if (mix->wFormatTag == WAVE_FORMAT_EXTENSIBLE) {
                    auto *ext = reinterpret_cast<WAVEFORMATEXTENSIBLE *>(mix);
                    floating = IsEqualGUID(ext->SubFormat, KSDATAFORMAT_SUBTYPE_IEEE_FLOAT);
                    valid_bits = ext->Samples.wValidBitsPerSample;
                }
                info["captureBits"] = !floating && valid_bits <= 16 ? 16 : 24;
                info["integerConversion"] = floating || valid_bits > 24;
                info["supported"] = mix->nChannels == 2 &&
                    (mix->nSamplesPerSec == 44100 || mix->nSamplesPerSec == 48000 ||
                     mix->nSamplesPerSec == 88200 || mix->nSamplesPerSec == 96000);
            }
            CoTaskMemFree(mix);
            list.push_back(std::move(info));
            PropVariantClear(&name);
            CoTaskMemFree(id);
        }
        json_out(out, list);
        return 1;
    });
}
extern "C" void *sh_capture_open(const char *id, uint32_t rate, uint8_t bits, ShBytes *out) {
    try {
        validate(rate, bits, 2);
        auto c = std::make_unique<Capture>();
        c->rate = rate;
        c->bits = bits;
        check(CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL,
                               IID_PPV_ARGS(&c->enumerator)),
              "device enumerator");
        if (std::strcmp(id, "default") == 0)
            check(c->enumerator->GetDefaultAudioEndpoint(eRender, eMultimedia, &c->device),
                  "default output");
        else {
            auto value = wide(id);
            check(c->enumerator->GetDevice(value.c_str(), &c->device), "selected output");
        }
        check(c->device->Activate(__uuidof(IAudioClient), CLSCTX_ALL, nullptr,
                                  reinterpret_cast<void **>(c->client.GetAddressOf())),
              "activate loopback");
        check(c->client->GetMixFormat(&c->format), "output mix format");
        require(c->format->nSamplesPerSec == rate && c->format->nChannels == 2,
                (std::string("CAPTURE_RATE_OR_CHANNEL_MISMATCH: device=") +
                    std::to_string(c->format->nSamplesPerSec) + "Hz/" +
                    std::to_string(c->format->nChannels) + "ch, requested=" +
                    std::to_string(rate) + "Hz/2ch").c_str());
        c->floating = c->format->wFormatTag == WAVE_FORMAT_IEEE_FLOAT;
        c->valid_bits = c->format->wBitsPerSample;
        if (c->format->wFormatTag == WAVE_FORMAT_EXTENSIBLE) {
            auto *ext = reinterpret_cast<WAVEFORMATEXTENSIBLE *>(c->format);
            c->floating = IsEqualGUID(ext->SubFormat, KSDATAFORMAT_SUBTYPE_IEEE_FLOAT);
            c->valid_bits = ext->Samples.wValidBitsPerSample;
        }
        require(c->floating ? c->format->wBitsPerSample == 32
                            : (c->format->wBitsPerSample == 16 || c->format->wBitsPerSample == 24 ||
                               c->format->wBitsPerSample == 32),
                "UNSUPPORTED_CAPTURE_FORMAT");
        check(c->client->Initialize(AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK, 1000000,
                                    0, c->format, nullptr),
              "initialize loopback");
        check(c->client->GetService(IID_PPV_ARGS(&c->capture)), "loopback service");
        check(c->client->Start(), "start loopback");
        json_out(out, json{{"sampleRate", rate},
                           {"bits", bits},
                           {"channels", 2},
                           {"integerConversion", c->floating || c->valid_bits != bits}});
        return c.release();
    } catch (const std::exception &e) {
        sh_error(e.what());
        return nullptr;
    }
}
extern "C" int sh_capture_read(void *handle, ShPcm *out) {
    return guarded([&] {
        require(handle, "INVALID_CAPTURE");
        auto *c = static_cast<Capture *>(handle);
        UINT frames = 0;
        check(c->capture->GetNextPacketSize(&frames), "capture packet");
        if (!frames)
            return 0;
        BYTE *data = nullptr;
        DWORD flags;
        check(c->capture->GetBuffer(&data, &frames, &flags, nullptr, nullptr), "capture read");
        std::vector<int32_t> pcm(frames * 2);
        double scale = std::ldexp(1.0, c->bits - 1);
        for (size_t i = 0; i < pcm.size(); i++) {
            if (flags & AUDCLNT_BUFFERFLAGS_SILENT) {
                pcm[i] = 0;
                continue;
            }
            if (c->floating) {
                float value;
                std::memcpy(&value, data + i * 4, 4);
                pcm[i] =
                    std::isfinite(value)
                        ? static_cast<int32_t>(std::clamp<double>(value * scale, -scale, scale - 1))
                        : 0;
            } else {
                int32_t value = 0;
                unsigned bytes = c->format->wBitsPerSample / 8;
                std::memcpy(&value, data + i * bytes, bytes);
                if (bytes == 2)
                    value = static_cast<int16_t>(value);
                else if (bytes == 3)
                    value = (value << 8) >> 8;
                const int shift = c->format->wBitsPerSample - c->bits;
                pcm[i] = shift >= 0
                             ? value >> shift
                             : static_cast<int32_t>(static_cast<int64_t>(value) * (1ll << -shift));
            }
        }
        check(c->capture->ReleaseBuffer(frames), "release capture buffer");
        pcm_out(out, pcm, c->rate, c->bits);
        return 1;
    });
}
extern "C" void sh_capture_close(void *handle) {
    delete static_cast<Capture *>(handle);
}
