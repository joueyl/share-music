package com.musicshare.playback

import android.app.Activity
import android.content.Intent
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.util.Log
import androidx.appcompat.app.AppCompatActivity
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Channel
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@InvokeArg
class MediaSessionArgs { var controls: Channel? = null }

@TauriPlugin
class AndroidPlaybackPlugin(private val activity: Activity) : Plugin(activity) {
    private val chatNotifications = RoomChatNotifications(activity)
    // MediaPlayer and its callbacks are confined to the same Looper.
    private val main = Handler(Looper.getMainLooper())
    private var player: MediaPlayer? = null
    private var source: TrackDataSource? = null
    private var prepared = false
    private var playing = false
    private var seeking = false
    private var buffering = false
    private var positionMs = 0
    private var durationMs = 0
    private var code = 0
    private var timeout: Runnable? = null
    private var destroyed = false
    private var foregroundRequested = false
    private val stopForeground = Runnable { endBackgroundPlayback() }
    @Volatile private var startupLogging = false
    private var startupTrace: StartupTrace? = null
    private var firstProgressFrom: Int? = null
    private var startupPlaying = false

    private data class StartupTrace(val id: Long, val startMs: Long)

    private fun logStartup(trace: StartupTrace, stage: String, atMs: Long = System.currentTimeMillis(), detail: String = "") {
        if (startupLogging) Log.i("ToneStartup", "trace=${trace.id}/${trace.startMs} stage=$stage elapsedMs=${atMs - trace.startMs}$detail")
    }

    private fun markStartup(stage: String, detail: String = "") {
        startupTrace?.let { logStartup(it, stage, detail = detail) }
    }

    private var driverTraceId = 0L
    private val roomDriver = RoomDriver(main, ::snapshot,
        load = { url, size, key ->
            TrackDataSource.checkedUrl(url)
            val trace = if (startupLogging) StartupTrace(++driverTraceId, System.currentTimeMillis()) else null
            trace?.let { logStartup(it, "native-room-link-ready") }
            try { load(url, size, key, trace) }
            catch (e: Exception) { fail(MediaPlayer.MEDIA_ERROR_UNKNOWN); throw e }
        },
        play = {
            if (prepared && !playing && !seeking) {
                if (startupTrace != null) firstProgressFrom = positionMs
                player?.start(); playing = true
                markStartup("native-start")
                ensureBackgroundPlayback()
            }
        },
        pause = { if (prepared && playing) { player?.pause(); playing = false } },
        seek = { target -> player?.let { seek(it, target) } },
        clearTrack = ::clear,
        stop = { clear(); endBackgroundPlayback() },
    )

    private fun ensureBackgroundPlayback() {
        main.removeCallbacks(stopForeground)
        if (foregroundRequested) return
        val intent = Intent(activity, RoomPlaybackService::class.java)
        try {
            if (Build.VERSION.SDK_INT >= 26) activity.startForegroundService(intent)
            else activity.startService(intent)
            foregroundRequested = true
        } catch (_: RuntimeException) {
            // In particular, Android may forbid starting an FGS if the screen was
            // locked before the first track was ready. Never fail foreground audio.
            Log.w("TonePlayback", "Background playback service could not start")
        }
    }

    private fun releaseBackgroundAfterTransition(graceMs: Long = 90_000L) {
        main.removeCallbacks(stopForeground)
        if (foregroundRequested) main.postDelayed(stopForeground, graceMs)
    }

    private fun endBackgroundPlayback() {
        main.removeCallbacks(stopForeground)
        if (!foregroundRequested) return
        foregroundRequested = false
        activity.stopService(Intent(activity, RoomPlaybackService::class.java))
    }

    private fun cancelTimeout() {
        timeout?.let { main.removeCallbacks(it) }
        timeout = null
    }

    private fun armTimeout(active: MediaPlayer, ms: Long) {
        cancelTimeout()
        timeout = Runnable { if (player === active) fail(MediaPlayer.MEDIA_ERROR_TIMED_OUT) }
            .also { main.postDelayed(it, ms) }
    }

    private fun clear() {
        cancelTimeout()
        val active = player
        player = null
        startupTrace = null
        firstProgressFrom = null
        startupPlaying = false
        source?.close()
        source = null
        active?.release()
        prepared = false; playing = false; seeking = false; buffering = false
        positionMs = 0; durationMs = 0; code = 0
        releaseBackgroundAfterTransition()
    }

    private fun fail(error: Int) {
        val at = positionMs
        markStartup("native-error", " code=$error")
        clear()
        positionMs = at
        code = if (error == 0) MediaPlayer.MEDIA_ERROR_UNKNOWN else error
    }

    private fun load(url: String, sizeBytes: Long, cacheKey: String, trace: StartupTrace?) {
        clear()
        // Promote during preparation, before the user can lock the screen.
        ensureBackgroundPlayback()
        releaseBackgroundAfterTransition()
        startupTrace = trace
        markStartup("native-load")
        val track = TrackDataSource(url, sizeBytes, activity.cacheDir, cacheKey,
            trace?.let { session -> { stage -> logStartup(session, stage) } })
        source = track
        val active = MediaPlayer()
        player = active
        active.setWakeMode(activity.applicationContext, PowerManager.PARTIAL_WAKE_LOCK)
        active.setAudioAttributes(
            AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build()
        )
        active.setOnPreparedListener {
            if (it === player) {
                cancelTimeout()
                prepared = true
                markStartup("native-prepared")
                durationMs = it.duration.coerceAtLeast(0)
                // No side-effecting commands until the Preparing state has ended.
                it.setVolume(this.volume, this.volume)

            }
        }
        active.setOnSeekCompleteListener {
            if (it === player) {
                cancelTimeout()
                seeking = false
                positionMs = it.currentPosition
                if (!startupPlaying) markStartup("seek-complete")
                if (firstProgressFrom != null) firstProgressFrom = positionMs
            }
        }
        active.setOnCompletionListener {
            if (it === player) {
                playing = false; buffering = false
                positionMs = durationMs
                Log.d("TonePlayback", "Track completed; waiting for room transition")
                releaseBackgroundAfterTransition()
            }
        }
        active.setOnErrorListener { owner, what, extra ->
            if (owner === player) {
                track.invalidateCache()
                fail(if (extra != 0) extra else what)
            }
            true
        }
        active.setOnInfoListener { owner, what, _ ->
            if (owner === player) when (what) {
                MediaPlayer.MEDIA_INFO_BUFFERING_START -> buffering = true
                MediaPlayer.MEDIA_INFO_BUFFERING_END -> buffering = false
                else -> Unit
            }
            false
        }
        active.setDataSource(track)
        active.prepareAsync()
        // The rare full-file fallback retains the old path's bounded transfer window.
        armTimeout(active, 75000)
    }

    private var volume = 1f

    private fun seek(active: MediaPlayer, positionMs: Long) {
        val target = positionMs.coerceIn(0L, durationMs.toLong())
        seeking = true
        if (!startupPlaying) markStartup("seek-start")
        if (Build.VERSION.SDK_INT >= 26) active.seekTo(target, MediaPlayer.SEEK_CLOSEST)
        else {
            @Suppress("DEPRECATION")
            active.seekTo(target.toInt())
        }
        armTimeout(active, 15000)
    }

    private fun snapshot(): JSObject {
        if (prepared && !seeking) player?.let { positionMs = it.currentPosition }
        val initial = firstProgressFrom
        if (playing && !seeking && initial != null && positionMs > initial + 20) {
            markStartup("position-advancing")
            firstProgressFrom = null
            startupPlaying = true
        }
        // Timestamp the decoder read here, not when the WebView receives the IPC response.
        val sampledAtMs = System.currentTimeMillis()
        return JSObject().apply {
            put("prepared", prepared); put("playing", playing); put("seeking", seeking)
            put("buffering", buffering); put("positionMs", positionMs); put("durationMs", durationMs); put("errorCode", code)
            put("sampledAtMs", sampledAtMs)
        }
    }

    @Command
    fun operate(invoke: Invoke) {
        main.post {
            if (destroyed) { invoke.reject("ANDROID_PLAYBACK_UNAVAILABLE"); return@post }
            val args = invoke.getArgs()
            val action = args.optString("action")
            try {
                when (action) {
                    "chat-scope", "chat-notify" -> {
                        if (action == "chat-scope") chatNotifications.updateScope(args)
                        else chatNotifications.receive(args)
                        invoke.resolve(JSObject()); return@post
                    }
                    "room-driver" -> {
                        roomDriver.update(args, invoke.parseArgs(MediaSessionArgs::class.java).controls)
                        invoke.resolve(JSObject()); return@post
                    }
                    "startup-logging" -> {
                        startupLogging = args.optBoolean("enabled", false)
                        if (!startupLogging) {
                            startupTrace = null
                            firstProgressFrom = null
                        }
                        invoke.resolve(JSObject()); return@post
                    }
                    "state" -> Unit
                    "volume" -> {
                        volume = args.getDouble("volume").toFloat().coerceIn(0f, 1f)
                        if (prepared) player?.setVolume(volume, volume)
                    }
                    else -> { invoke.reject("ANDROID_PLAYBACK_INVALID_COMMAND"); return@post }
                }
                invoke.resolve(if (action == "state") roomDriver.annotate(snapshot()) else snapshot())
            } catch (_: Exception) {
                if (action == "room-driver" || action.startsWith("chat-")) {
                    invoke.reject("ANDROID_MEDIA_SESSION_UNAVAILABLE"); return@post
                }
                fail(MediaPlayer.MEDIA_ERROR_UNKNOWN)
                invoke.resolve(snapshot())
            }
        }
    }

    private fun logVisibility(stage: String) {
        if (activity.applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE != 0) {
            Log.i("ToneRoomSocket", "stage=$stage")
        }
    }

    override fun onPause(activity: AppCompatActivity) {
        chatNotifications.paused()
        logVisibility("activity-paused")
    }

    override fun onResume(activity: AppCompatActivity) {
        chatNotifications.resumed()
        logVisibility("activity-resumed")
    }

    override fun onStop(activity: AppCompatActivity) { chatNotifications.stopped() }

    override fun onDestroy(activity: AppCompatActivity) {
        logVisibility("activity-destroyed")
        destroyed = true
        chatNotifications.clear()
        roomDriver.destroy()
    }
}
