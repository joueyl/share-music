#pragma once
#include <cstddef>
#include <cstdint>
#ifdef _WIN32
#ifdef SH_BUILD
#define SH_API __declspec(dllexport)
#else
#define SH_API __declspec(dllimport)
#endif
#else
#define SH_API __attribute__((visibility("default")))
#endif
struct ShBytes {
    uint8_t *data;
    size_t size;
};
struct ShPcm {
    int32_t *data;
    size_t count;
    uint32_t rate;
    uint8_t bits;
    uint8_t channels;
    uint64_t position;
};
extern "C" {
SH_API uint32_t sh_abi_version();
SH_API const char *sh_last_error();
SH_API void sh_free(void *);
SH_API void *sh_file_open(const char *, ShBytes *);
SH_API int sh_file_read(void *, ShPcm *);
SH_API int sh_file_seek(void *, uint64_t);
SH_API void sh_file_close(void *);
SH_API int sh_encode(const int32_t *, size_t, uint32_t, uint8_t, uint8_t, uint8_t, ShBytes *);
SH_API int sh_decode(const uint8_t *, size_t, uint8_t, uint32_t, uint8_t, uint8_t, ShPcm *);
SH_API void *sh_output_open(uint32_t, uint8_t, uint8_t);
SH_API int sh_output_queue(void *, const int32_t *, size_t, float);
SH_API uint64_t sh_output_queued(void *);
SH_API void sh_output_close(void *);
SH_API int sh_capture_devices(ShBytes *);
SH_API void *sh_capture_open(const char *, uint32_t, uint8_t, ShBytes *);
SH_API int sh_capture_read(void *, ShPcm *);
SH_API void sh_capture_close(void *);
SH_API void *sh_peer_open(const char *, bool);
SH_API int sh_peer_remote(void *, const char *);
SH_API int sh_peer_poll(void *, ShBytes *);
SH_API int sh_peer_send(void *, const uint8_t *, size_t, bool);
SH_API size_t sh_peer_buffered(void *);
SH_API size_t sh_peer_limit(void *);
SH_API void sh_peer_close(void *);
}
