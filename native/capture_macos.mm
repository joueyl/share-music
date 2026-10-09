#include "internal.h"
#import <AppKit/AppKit.h>
#import <CoreMedia/CoreMedia.h>
#import <Foundation/Foundation.h>
#import <ScreenCaptureKit/ScreenCaptureKit.h>
@interface MusicCaptureDelegate : NSObject <SCStreamOutput, SCStreamDelegate>
@property(nonatomic, assign) CaptureQueue *owner;
@end
@implementation MusicCaptureDelegate
- (void)stream:(SCStream *)stream didStopWithError:(NSError *)error {
    if (self.owner) {
        std::lock_guard<std::mutex> lock(self.owner->mutex);
        self.owner->failed = true;
        self.owner->error = error.localizedDescription.UTF8String;
    }
}
- (void)stream:(SCStream *)stream
    didOutputSampleBuffer:(CMSampleBufferRef)sample
                   ofType:(SCStreamOutputType)type {
    if (type != SCStreamOutputTypeAudio || !self.owner || !CMSampleBufferIsValid(sample))
        return;
    auto *owner = self.owner;
    auto desc = CMSampleBufferGetFormatDescription(sample);
    auto format = CMAudioFormatDescriptionGetStreamBasicDescription(desc);
    if (!format || format->mChannelsPerFrame != 2 || format->mSampleRate != owner->rate ||
        !(format->mFormatFlags & kAudioFormatFlagIsFloat) || format->mBitsPerChannel != 32) {
        std::lock_guard<std::mutex> lock(owner->mutex);
        owner->failed = true;
        owner->error = "CAPTURE_FORMAT_MISMATCH";
        return;
    }
    size_t required = 0;
    CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(sample, &required, nullptr, 0, nullptr,
                                                            nullptr, 0, nullptr);
    std::vector<uint8_t> memory(required);
    auto *buffers = reinterpret_cast<AudioBufferList *>(memory.data());
    CMBlockBufferRef block = nullptr;
    if (CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
            sample, nullptr, buffers, required, nullptr, nullptr,
            kCMSampleBufferFlag_AudioBufferList_Assure16ByteAlignment, &block) != noErr)
        return;
    const size_t frames = CMSampleBufferGetNumSamples(sample);
    std::vector<int32_t> pcm(frames * 2);
    double scale = std::ldexp(1.0, owner->bits - 1);
    for (size_t frame = 0; frame < frames; frame++)
        for (size_t channel = 0; channel < 2; channel++) {
            float value = 0;
            if (buffers->mNumberBuffers == 1)
                value = static_cast<const float *>(buffers->mBuffers[0].mData)[frame * 2 + channel];
            else if (buffers->mNumberBuffers == 2)
                value = static_cast<const float *>(buffers->mBuffers[channel].mData)[frame];
            pcm[frame * 2 + channel] =
                std::isfinite(value)
                    ? static_cast<int32_t>(std::clamp<double>(value * scale, -scale, scale - 1))
                    : 0;
        }
    if (block)
        CFRelease(block);
    owner->push(std::move(pcm));
}
@end
struct MacCapture {
    CaptureQueue queue;
    SCStream *__strong stream = nil;
    MusicCaptureDelegate *__strong delegate = nil;
    dispatch_queue_t handler;
    ~MacCapture() {
        if (handler && delegate) {
            auto *object = delegate;
            dispatch_sync(handler, ^{
              object.owner = nullptr;
            });
        }
        if (stream) {
            dispatch_semaphore_t stopped = dispatch_semaphore_create(0);
            [stream stopCaptureWithCompletionHandler:^(NSError *) {
              dispatch_semaphore_signal(stopped);
            }];
            dispatch_semaphore_wait(stopped, dispatch_time(DISPATCH_TIME_NOW, 3 * NSEC_PER_SEC));
        }
    }
};
extern "C" int sh_capture_devices(ShBytes *out) {
    return guarded([&] {
        json_out(out,
                 json::array({json{{"id", "default"}, {"name", "系统音频（ScreenCaptureKit）"}}}));
        return 1;
    });
}
extern "C" void *sh_capture_open(const char *id, uint32_t rate, uint8_t bits, ShBytes *out) {
    @autoreleasepool {
        try {
            validate(rate, bits, 2);
            require(std::strcmp(id, "default") == 0, "UNKNOWN_CAPTURE_DEVICE");
            auto capture = std::make_unique<MacCapture>();
            capture->queue.rate = rate;
            capture->queue.bits = bits;
            __block SCShareableContent *content = nil;
            __block NSError *failure = nil;
            dispatch_semaphore_t ready = dispatch_semaphore_create(0);
            [SCShareableContent
                getShareableContentExcludingDesktopWindows:YES
                                       onScreenWindowsOnly:YES
                                         completionHandler:^(SCShareableContent *value,
                                                             NSError *error) {
                                           content = value;
                                           failure = error;
                                           dispatch_semaphore_signal(ready);
                                         }];
            require(dispatch_semaphore_wait(
                        ready, dispatch_time(DISPATCH_TIME_NOW, 15 * NSEC_PER_SEC)) == 0,
                    "CAPTURE_PERMISSION_TIMEOUT");
            if (failure)
                throw std::runtime_error(failure.localizedDescription.UTF8String);
            require(content.displays.count > 0, "NO_CAPTURE_DISPLAY");
            SCContentFilter *filter =
                [[SCContentFilter alloc] initWithDisplay:content.displays.firstObject
                                        excludingWindows:@[]];
            SCStreamConfiguration *config = [SCStreamConfiguration new];
            config.width = 2;
            config.height = 2;
            config.minimumFrameInterval = CMTimeMake(1, 1);
            config.capturesAudio = YES;
            config.excludesCurrentProcessAudio = YES;
            config.sampleRate = rate;
            config.channelCount = 2;
            capture->delegate = [MusicCaptureDelegate new];
            capture->delegate.owner = &capture->queue;
            capture->handler = dispatch_queue_create("music-share.capture", DISPATCH_QUEUE_SERIAL);
            capture->stream = [[SCStream alloc] initWithFilter:filter
                                                 configuration:config
                                                      delegate:capture->delegate];
            NSError *error = nil;
            require([capture->stream addStreamOutput:capture->delegate
                                                type:SCStreamOutputTypeAudio
                                  sampleHandlerQueue:capture->handler
                                               error:&error],
                    "CAPTURE_OUTPUT_FAILED");
            dispatch_semaphore_t started = dispatch_semaphore_create(0);
            __block NSError *startError = nil;
            [capture->stream startCaptureWithCompletionHandler:^(NSError *e) {
              startError = e;
              dispatch_semaphore_signal(started);
            }];
            require(dispatch_semaphore_wait(
                        started, dispatch_time(DISPATCH_TIME_NOW, 10 * NSEC_PER_SEC)) == 0,
                    "CAPTURE_START_TIMEOUT");
            if (startError)
                throw std::runtime_error(startError.localizedDescription.UTF8String);
            json_out(out, json{{"sampleRate", rate},
                               {"bits", bits},
                               {"channels", 2},
                               {"integerConversion", true}});
            return capture.release();
        } catch (const std::exception &e) {
            sh_error(e.what());
            return nullptr;
        }
    }
}
extern "C" int sh_capture_read(void *handle, ShPcm *out) {
    return guarded([&] {
        require(handle, "INVALID_CAPTURE");
        return static_cast<MacCapture *>(handle)->queue.read(out);
    });
}
extern "C" void sh_capture_close(void *handle) {
    delete static_cast<MacCapture *>(handle);
}
