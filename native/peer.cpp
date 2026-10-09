#include "internal.h"
#include <atomic>
#include <rtc/rtc.h>
struct Peer {
    int pc = -1;
    std::atomic<int> play{-1}, prefetch{-1};
    std::mutex mutex;
    std::deque<std::vector<uint8_t>> events;
    size_t bytes = 0;
    std::atomic<bool> failed{false};
    ~Peer() {
        if (pc >= 0) {
            rtcClosePeerConnection(pc);
            if (play >= 0)
                rtcDeleteDataChannel(play);
            if (prefetch >= 0)
                rtcDeleteDataChannel(prefetch);
            rtcDeletePeerConnection(pc);
        }
    }
    void push(std::vector<uint8_t> event) {
        std::lock_guard<std::mutex> lock(mutex);
        if (bytes + event.size() > 8 * 1024 * 1024) {
            failed = true;
            return;
        }
        bytes += event.size();
        events.push_back(std::move(event));
    }
    void event(const json &value) {
        const auto text = value.dump();
        std::vector<uint8_t> event{1};
        event.insert(event.end(), text.begin(), text.end());
        push(std::move(event));
    }
};
static void description(int, const char *sdp, const char *type, void *client) {
    static_cast<Peer *>(client)->event(
        json{{"kind", "description"}, {"sdp", sdp}, {"descriptionType", type}});
}
static void candidate(int, const char *value, const char *mid, void *client) {
    static_cast<Peer *>(client)->event(
        json{{"kind", "candidate"}, {"candidate", value}, {"mid", mid}});
}
static void state(int, rtcState state, void *client) {
    if (state == RTC_FAILED || state == RTC_CLOSED || state == RTC_DISCONNECTED)
        static_cast<Peer *>(client)->event(
            json{{"kind", state == RTC_FAILED ? "failed" : "closed"}});
}
static void opened(int channel, void *client) {
    auto *p = static_cast<Peer *>(client);
    if (channel == p->play)
        p->event(json{{"kind", "open"}});
}
static void message(int, const char *data, int size, void *client) {
    auto *p = static_cast<Peer *>(client);
    if (size <= 0 || size > 16384) {
        p->failed = true;
        return;
    }
    std::vector<uint8_t> event{2};
    event.insert(event.end(), reinterpret_cast<const uint8_t *>(data),
                 reinterpret_cast<const uint8_t *>(data) + size);
    p->push(std::move(event));
}
static void configure_channel(Peer *p, int channel, const char *label) {
    if (std::strcmp(label, "playback") != 0 && std::strcmp(label, "prefetch") != 0) {
        rtcClose(channel);
        rtcDeleteDataChannel(channel);
        return;
    }
    if (std::strcmp(label, "playback") == 0)
        p->play = channel;
    else
        p->prefetch = channel;
    rtcSetUserPointer(channel, p);
    rtcSetOpenCallback(channel, opened);
    rtcSetMessageCallback(channel, message);
}
static void channel(int, int dc, void *client) {
    char label[64]{};
    if (rtcGetDataChannelLabel(dc, label, sizeof(label)) < 0) {
        rtcDeleteDataChannel(dc);
        return;
    }
    configure_channel(static_cast<Peer *>(client), dc, label);
}
extern "C" void *sh_peer_open(const char *ice_json, bool offer) {
    try {
        auto ice = json::parse(ice_json);
        require(ice.is_array() && ice.size() <= 8, "INVALID_ICE_SERVERS");
        std::vector<std::string> strings;
        std::vector<const char *> servers;
        for (const auto &value : ice)
            strings.push_back(value.get<std::string>());
        for (const auto &value : strings)
            servers.push_back(value.c_str());
        auto p = std::make_unique<Peer>();
        rtcConfiguration config{};
        config.iceServers = servers.data();
        config.iceServersCount = static_cast<int>(servers.size());
        config.disableAutoNegotiation = true;
        config.maxMessageSize = 16384;
        config.iceTransportPolicy = RTC_TRANSPORT_POLICY_ALL;
        p->pc = rtcCreatePeerConnection(&config);
        require(p->pc >= 0, "PEER_CREATE_FAILED");
        rtcSetUserPointer(p->pc, p.get());
        rtcSetLocalDescriptionCallback(p->pc, description);
        rtcSetLocalCandidateCallback(p->pc, candidate);
        rtcSetStateChangeCallback(p->pc, state);
        rtcSetDataChannelCallback(p->pc, channel);
        if (offer) {
            int dc = rtcCreateDataChannel(p->pc, "playback");
            require(dc >= 0, "DATA_CHANNEL_FAILED");
            configure_channel(p.get(), dc, "playback");
            dc = rtcCreateDataChannel(p->pc, "prefetch");
            require(dc >= 0, "DATA_CHANNEL_FAILED");
            configure_channel(p.get(), dc, "prefetch");
            require(rtcSetLocalDescription(p->pc, "offer") >= 0, "OFFER_FAILED");
        }
        return p.release();
    } catch (const std::exception &e) {
        sh_error(e.what());
        return nullptr;
    }
}
extern "C" int sh_peer_remote(void *handle, const char *text) {
    return guarded([&] {
        require(handle && text, "INVALID_PEER");
        auto *p = static_cast<Peer *>(handle);
        auto value = json::parse(text);
        if (value["kind"] == "description") {
            const auto sdp = value.at("sdp").get<std::string>(),
                       type = value.at("descriptionType").get<std::string>();
            require(sdp.size() <= 24000 && (type == "offer" || type == "answer"),
                    "INVALID_DESCRIPTION");
            require(rtcSetRemoteDescription(p->pc, sdp.c_str(), type.c_str()) >= 0,
                    "REMOTE_DESCRIPTION_FAILED");
            if (type == "offer")
                require(rtcSetLocalDescription(p->pc, "answer") >= 0, "ANSWER_FAILED");
        } else if (value["kind"] == "candidate") {
            const auto candidate = value.at("candidate").get<std::string>(),
                       mid = value.at("mid").get<std::string>();
            require(candidate.size() <= 4096 && mid.size() <= 100, "INVALID_CANDIDATE");
            require(rtcAddRemoteCandidate(p->pc, candidate.c_str(), mid.c_str()) >= 0,
                    "REMOTE_CANDIDATE_FAILED");
        } else
            throw std::runtime_error("INVALID_SIGNAL");
        return 1;
    });
}
extern "C" int sh_peer_poll(void *handle, ShBytes *out) {
    return guarded([&] {
        require(handle, "INVALID_PEER");
        auto *p = static_cast<Peer *>(handle);
        require(!p->failed, "PEER_RECEIVE_BACKPRESSURE");
        std::lock_guard<std::mutex> lock(p->mutex);
        if (p->events.empty())
            return 0;
        auto event = std::move(p->events.front());
        p->events.pop_front();
        p->bytes -= event.size();
        bytes_out(out, event.data(), event.size());
        return 1;
    });
}
extern "C" size_t sh_peer_limit(void *handle) {
    auto *p = static_cast<Peer *>(handle);
    if (!p || p->play < 0)
        return 16384;
    int value = rtcMaxMessageSize(p->play);
    return value > 0 ? std::min(value, 16384) : 16384;
}
extern "C" size_t sh_peer_buffered(void *handle) {
    auto *p = static_cast<Peer *>(handle);
    if (!p)
        return 0;
    int a = p->play >= 0 ? rtcGetBufferedAmount(p->play) : 0,
        b = p->prefetch >= 0 ? rtcGetBufferedAmount(p->prefetch) : 0;
    return std::max(a, 0) + std::max(b, 0);
}
extern "C" int sh_peer_send(void *handle, const uint8_t *data, size_t size, bool prefetch) {
    return guarded([&] {
        require(handle && data && size > 0 && size <= sh_peer_limit(handle),
                "INVALID_PEER_MESSAGE");
        auto *p = static_cast<Peer *>(handle);
        int dc = prefetch && p->prefetch >= 0 && rtcIsOpen(p->prefetch) ? p->prefetch : p->play;
        if (dc < 0 || !rtcIsOpen(dc) || sh_peer_buffered(handle) > 512 * 1024)
            return 0;
        require(rtcSendMessage(dc, reinterpret_cast<const char *>(data), static_cast<int>(size)) >=
                    0,
                "PEER_SEND_FAILED");
        return 1;
    });
}
extern "C" void sh_peer_close(void *handle) {
    delete static_cast<Peer *>(handle);
}
