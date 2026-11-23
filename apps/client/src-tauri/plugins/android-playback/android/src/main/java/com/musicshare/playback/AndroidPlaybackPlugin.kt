package com.musicshare.playback

import android.app.Activity
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.appcompat.app.AppCompatActivity
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@TauriPlugin
class AndroidPlaybackPlugin(private val activity: Activity) : Plugin(activity) {
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
        source?.close()
        source = null
        active?.release()
        prepared = false; playing = false; seeking = false; buffering = false
        positionMs = 0; durationMs = 0; code = 0
    }

    private fun fail(error: Int) {
        val at = positionMs
        clear()
        positionMs = at
        code = if (error == 0) MediaPlayer.MEDIA_ERROR_UNKNOWN else error
    }

    private fun load(url: String, sizeBytes: Long, volume: Float) {
        clear()
        val track = TrackDataSource(url, sizeBytes, activity.cacheDir)
        source = track
        val active = MediaPlayer()
        player = active
        active.setAudioAttributes(
            AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build()
        )
        active.setOnPreparedListener {
            if (it === player) {
                cancelTimeout()
                prepared = true
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
            }
        }
        active.setOnCompletionListener {
            if (it === player) {
                playing = false; buffering = false
                positionMs = durationMs
            }
        }
        active.setOnErrorListener { owner, what, extra ->
            if (owner === player) fail(if (extra != 0) extra else what)
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
        this.volume = volume
        active.setDataSource(track)
        active.prepareAsync()
        // The rare full-file fallback retains the old path's bounded transfer window.
        armTimeout(active, 75000)
    }

    private var volume = 1f

    private fun snapshot(): JSObject {
        if (prepared && !seeking) player?.let { positionMs = it.currentPosition }
        return JSObject().apply {
            put("prepared", prepared); put("playing", playing); put("seeking", seeking)
            put("buffering", buffering); put("positionMs", positionMs); put("durationMs", durationMs); put("errorCode", code)
        }
    }

    @Command
    fun operate(invoke: Invoke) {
        main.post {
            if (destroyed) { invoke.reject("ANDROID_PLAYBACK_UNAVAILABLE"); return@post }
            try {
                val args = invoke.getArgs()
                when (args.getString("action")) {
                    "load" -> load(args.getString("url"), args.getLong("sizeBytes"), args.getDouble("volume").toFloat().coerceIn(0f, 1f))
                    "clear" -> clear()
                    "state" -> Unit
                    "play" -> if (prepared && !playing && !seeking) {
                        player?.start(); playing = true
                    } else Unit
                    "pause" -> if (prepared && playing) {
                        player?.pause(); playing = false
                    } else Unit
                    "seek" -> if (prepared && !seeking) {
                        player?.let {
                            val target = args.getLong("positionMs").coerceIn(0L, durationMs.toLong())
                            seeking = true
                            if (Build.VERSION.SDK_INT >= 26) it.seekTo(target, MediaPlayer.SEEK_CLOSEST)
                            else {
                                @Suppress("DEPRECATION")
                                it.seekTo(target.toInt())
                            }
                            armTimeout(it, 15000)
                        }
                    } else Unit
                    "volume" -> {
                        volume = args.getDouble("volume").toFloat().coerceIn(0f, 1f)
                        if (prepared) player?.setVolume(volume, volume)
                    }
                    else -> { invoke.reject("ANDROID_PLAYBACK_INVALID_COMMAND"); return@post }
                }
                invoke.resolve(snapshot())
            } catch (_: Exception) {
                fail(MediaPlayer.MEDIA_ERROR_UNKNOWN)
                invoke.resolve(snapshot())
            }
        }
    }

    override fun onDestroy(activity: AppCompatActivity) {
        destroyed = true
        clear()
    }
}
