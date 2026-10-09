#include "bridge.h"
#ifdef _WIN32
#define NOMINMAX
#include <windows.h>
#include <objbase.h>
#endif
#include <chrono>
#include <cstring>
#include <fstream>
#include <iostream>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>
static void check(bool value, const char *message) {
    if (!value)
        throw std::runtime_error(std::string(message) + ": " + sh_last_error());
}
static void codecs() {
    for (uint32_t rate : {44100u, 48000u, 88200u, 96000u})
        for (uint8_t bits : {uint8_t(16), uint8_t(24)}) {
            std::vector<int32_t> samples(rate / 10 * 2);
            uint32_t seed = 42;
            for (auto &s : samples) {
                seed = seed * 1664525 + 1013904223;
                s = int32_t(seed & ((1u << bits) - 1)) - (1 << (bits - 1));
            }
            ShBytes encoded{};
            check(sh_encode(samples.data(), samples.size(), rate, bits, 2, 1, &encoded) > 0,
                  "FLAC encode");
            ShPcm pcm{};
            check(sh_decode(encoded.data, encoded.size, 1, rate, bits, 2, &pcm) > 0, "FLAC decode");
            check(pcm.count == samples.size() &&
                      std::memcmp(samples.data(), pcm.data, samples.size() * 4) == 0,
                  "lossless PCM mismatch");
            sh_free(pcm.data);
            sh_free(encoded.data);
            encoded = {};
            check(sh_encode(samples.data(), samples.size(), rate, bits, 2, 2, &encoded) > 0,
                  "Opus encode");
            pcm = {};
            check(sh_decode(encoded.data, encoded.size, 2, rate, bits, 2, &pcm) > 0, "Opus decode");
            check(pcm.count == samples.size(), "Opus duration mismatch");
            sh_free(pcm.data);
            sh_free(encoded.data);
        }
    ShBytes out{};
    int32_t sample[2] = {0, 0};
    check(sh_encode(sample, 2, 48000, 16, 1, 1, &out) < 0, "unsupported mono accepted");
    uint8_t corrupt[6] = {0, 0, 0, 0, 0, 0};
    ShPcm pcm{};
    check(sh_decode(corrupt, 6, 1, 48000, 16, 2, &pcm) < 0, "corrupt FLAC accepted");
}
static void wav() {
    const uint32_t rate = 48000, frames = rate * 4, bytes = frames * 4;
    std::ofstream file("native-test.wav", std::ios::binary);
    auto u16 = [&](uint16_t n) {
        char b[2] = {char(n), char(n >> 8)};
        file.write(b, 2);
    };
    auto u32 = [&](uint32_t n) {
        char b[4] = {char(n), char(n >> 8), char(n >> 16), char(n >> 24)};
        file.write(b, 4);
    };
    file.write("RIFF", 4);
    u32(bytes + 36);
    file.write("WAVEfmt ", 8);
    u32(16);
    u16(1);
    u16(2);
    u32(rate);
    u32(rate * 4);
    u16(4);
    u16(16);
    file.write("data", 4);
    u32(bytes);
    for (uint32_t i = 0; i < frames; i++) {
        u16(uint16_t(int16_t(i % 20000 - 10000)));
        u16(uint16_t(int16_t(10000 - i % 20000)));
    }
    file.close();
    ShBytes metadata{};
    void *f = sh_file_open("native-test.wav", &metadata);
    check(f, "file open");
    sh_free(metadata.data);
    ShPcm p{};
    check(sh_file_read(f, &p) > 0, "file read");
    check(p.rate == 48000 && p.bits == 16 && p.count == 9600 && p.data[0] == -10000 &&
              p.data[1] == 10000,
          "file PCM mismatch");
    sh_free(p.data);
    check(sh_file_seek(f, 500) > 0, "file seek");
    check(sh_file_read(f, &p) > 0, "file read after seek");
    check(p.position == 500 && p.data[0] == int16_t(24000 % 20000 - 10000),
          "seek position mismatch");
    sh_free(p.data);
    sh_file_close(f);
    std::remove("native-test.wav");
}
static void peers() {
    void *a = sh_peer_open("[]", true), *b = sh_peer_open("[]", false);
    check(a && b, "peer open");
    bool open = false, received = false, sent = false;
    std::vector<uint8_t> packet(16384, 42);
    const auto start = std::chrono::steady_clock::now();
    while (std::chrono::steady_clock::now() - start < std::chrono::seconds(15) && !received) {
        for (int i = 0; i < 2; i++) {
            void *p = i ? b : a, *remote = i ? a : b;
            ShBytes event{};
            while (sh_peer_poll(p, &event) > 0) {
                if (event.size && event.data[0] == 1) {
                    std::string text(reinterpret_cast<char *>(event.data + 1), event.size - 1);
                    if (text.find("\"kind\":\"description\"") != std::string::npos ||
                        text.find("\"kind\":\"candidate\"") != std::string::npos)
                        check(sh_peer_remote(remote, text.c_str()) > 0, "signaling");
                    if (!i && text.find("\"kind\":\"open\"") != std::string::npos)
                        open = true;
                } else if (i && event.size == packet.size() + 1 && event.data[0] == 2) {
                    check(std::memcmp(event.data + 1, packet.data(), packet.size()) == 0,
                          "peer data mismatch");
                    received = true;
                }
                sh_free(event.data);
                event = {};
            }
        }
        if (open && !sent) {
            check(sh_peer_send(a, packet.data(), packet.size(), false) > 0, "peer send");
            sent = true;
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(5));
    }
    sh_peer_close(a);
    sh_peer_close(b);
    check(received, "P2P local roundtrip timeout");
}
#ifdef _WIN32
static void com_device_query() {
    const HRESULT initialized = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    check(SUCCEEDED(initialized), "STA initialization");
    ShBytes devices{};
    const int result = sh_capture_devices(&devices);
    APTTYPE apartment; APTTYPEQUALIFIER qualifier;
    const HRESULT apartment_result = CoGetApartmentType(&apartment, &qualifier);
    if (devices.data) sh_free(devices.data);
    CoUninitialize();
    check(result == 1, "Device query on an existing STA");
    check(SUCCEEDED(apartment_result) && (apartment == APTTYPE_STA || apartment == APTTYPE_MAINSTA), "Caller STA must remain initialized");
}
#endif
int main() {
    try {
        check(sh_abi_version() == 1, "ABI mismatch");
#ifdef _WIN32
        com_device_query();
#endif
        codecs();
        wav();
        peers();
        std::cout << "Native codec, WAV seek and local P2P roundtrips passed\n";
        return 0;
    } catch (const std::exception &e) {
        std::cerr << e.what() << "\n";
        return 1;
    }
}
