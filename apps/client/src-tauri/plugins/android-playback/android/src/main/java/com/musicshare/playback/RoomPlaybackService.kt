package com.musicshare.playback

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.media.MediaMetadata
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.net.Uri
import android.net.wifi.WifiManager
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import app.tauri.plugin.Channel
import app.tauri.plugin.JSObject
import java.util.UUID

/** Foreground lifetime for the single process-owned MediaPlayer; never restores an old room. */
class RoomPlaybackService : Service() {
    private lateinit var session: MediaSession
    private var cpuLock: PowerManager.WakeLock? = null
    private var wifiLock: WifiManager.WifiLock? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        running = this
        session = MediaSession(this, "ToneRoom").apply {
            setCallback(object : MediaSession.Callback() {
                override fun onSkipToPrevious() = control("previous")
                override fun onSkipToNext() = control("next")
                override fun onPlay() = control("play")
                override fun onPause() = control("pause")
                override fun onSeekTo(pos: Long) = control("seek", pos)
            })
        }
    }

    private fun control(action: String, positionMs: Long? = null) {
        val state = media ?: return
        if (!state.optBoolean(if (action == "seek") "canSeek" else "canControl")) return
        controls?.send(JSObject().apply {
            for (key in listOf("socketId", "roomId", "trackId")) put(key, state.optString(key))
            put("sourceEpoch", state.optLong("sourceEpoch"))
            put("commandId", UUID.randomUUID().toString())
            put("action", action)
            if (positionMs != null) put("positionMs", positionMs)
        })
    }

    @Suppress("DEPRECATION")
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val action = intent?.action
        if (action == "next" || action == "previous" || action == "play" || action == "pause") {
            if (intent?.data == media?.let { actionUri(it) }) control(action)
        }
        publish()
        acquirePlaybackLocks()
        return START_NOT_STICKY
    }

    @Suppress("DEPRECATION")
    private fun publish() {
        val state = media
        val playing = state?.optString("playback") == "playing"
        val canControl = state?.optBoolean("canControl") == true
        val title = state?.optString("title").orEmpty().ifBlank { "同频 · TONE" }
        val artist = state?.optString("artist").orEmpty()
        session.setMetadata(MediaMetadata.Builder().apply {
            putString(MediaMetadata.METADATA_KEY_TITLE, title)
            putString(MediaMetadata.METADATA_KEY_ARTIST, artist)
            putString(MediaMetadata.METADATA_KEY_ALBUM, state?.optString("album").orEmpty())
            putLong(MediaMetadata.METADATA_KEY_DURATION, state?.optLong("durationMs") ?: 0L)
            artwork?.let {
                putBitmap(MediaMetadata.METADATA_KEY_DISPLAY_ICON, it)
                putBitmap(MediaMetadata.METADATA_KEY_ART, it)
                putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, it)
            }
        }.build())
        val playAction = if (playing) PlaybackState.ACTION_PAUSE else PlaybackState.ACTION_PLAY
        val controls = if (canControl) PlaybackState.ACTION_SKIP_TO_PREVIOUS or PlaybackState.ACTION_SKIP_TO_NEXT or playAction else 0L
        val actions = controls or if (state?.optBoolean("canSeek") == true) PlaybackState.ACTION_SEEK_TO else 0L
        session.setPlaybackState(PlaybackState.Builder().setActions(actions)
            .setState(if (state == null) PlaybackState.STATE_BUFFERING else if (playing) PlaybackState.STATE_PLAYING else PlaybackState.STATE_PAUSED,
                state?.optLong("positionMs") ?: 0L, if (playing) 1f else 0f).build())
        session.isActive = state != null
        val notification = if (Build.VERSION.SDK_INT >= 26) {
            val manager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
            manager.createNotificationChannel(
                NotificationChannel(CHANNEL, "房间音乐", NotificationManager.IMPORTANCE_LOW)
            )
            Notification.Builder(this, CHANNEL)
        } else Notification.Builder(this).setPriority(Notification.PRIORITY_LOW)

        packageManager.getLaunchIntentForPackage(packageName)?.let {
            notification.setContentIntent(PendingIntent.getActivity(
                this, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
            ))
        }
        val style = Notification.MediaStyle().setMediaSession(session.sessionToken)
        if (canControl) {
            fun add(icon: Int, label: String, action: String, request: Int) {
                val intent = Intent(this, RoomPlaybackService::class.java).setAction(action)
                    .setData(state?.let { actionUri(it) })
                val pending = PendingIntent.getService(this, request, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
                notification.addAction(Notification.Action.Builder(icon, label, pending).build())
            }
            add(android.R.drawable.ic_media_previous, "上一曲", "previous", 1)
            if (playing) add(android.R.drawable.ic_media_pause, "暂停", "pause", 2)
            else add(android.R.drawable.ic_media_play, "播放", "play", 3)
            add(android.R.drawable.ic_media_next, "下一曲", "next", 4)
            style.setShowActionsInCompactView(0, 1, 2)
        }
        val shown = notification
            .setStyle(style)
            .setLargeIcon(artwork)
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentTitle(title)
            .setContentText(artist.ifBlank { "房间音乐" })
            .setCategory(Notification.CATEGORY_TRANSPORT)
            .setOnlyAlertOnce(true)
            .setOngoing(true)
            .build()
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTIFICATION_ID, shown, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
        } else startForeground(NOTIFICATION_ID, shown)
    }

    private fun actionUri(state: JSObject): Uri = Uri.Builder().scheme("tone-media")
        .authority("room").appendPath(state.optString("socketId")).appendPath(state.optString("roomId"))
        .appendPath(state.optString("trackId")).appendPath(state.optString("sourceEpoch")).build()

    @Suppress("DEPRECATION")
    private fun acquirePlaybackLocks() {
        // MediaPlayer's own lock drops at completion, before the next room
        // snapshot, URL fetch and decoder prepare. Cover that gap as well.
        if (cpuLock == null) {
            val power = getSystemService(POWER_SERVICE) as PowerManager
            cpuLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "$packageName:RoomPlayback")
                .apply { setReferenceCounted(false); acquire() }
        }
        if (wifiLock == null) {
            try {
                val wifi = applicationContext.getSystemService(WIFI_SERVICE) as? WifiManager
                wifiLock = wifi?.createWifiLock(WifiManager.WIFI_MODE_FULL, "$packageName:RoomPlayback")
                    ?.apply { setReferenceCounted(false); acquire() }
            } catch (_: RuntimeException) {
                Log.w("TonePlayback", "Room playback Wi-Fi lock unavailable")
            }
        }
    }

    override fun onDestroy() {
        if (running === this) running = null
        session.release()
        wifiLock?.let { if (it.isHeld) it.release() }
        cpuLock?.let { if (it.isHeld) it.release() }
        wifiLock = null
        cpuLock = null
        super.onDestroy()
    }

    companion object {
        private const val CHANNEL = "tone-room-playback"
        private const val NOTIFICATION_ID = 417
        private var running: RoomPlaybackService? = null
        private var media: JSObject? = null
        private var artwork: Bitmap? = null
        private var controls: Channel? = null

        fun update(state: JSObject?, channel: Channel?) {
            if (state?.optString("artworkKey") != media?.optString("artworkKey")) artwork = null
            media = state
            controls = if (state == null) null else channel
            running?.publish()
        }

        fun updateArtwork(key: String, bitmap: Bitmap) {
            if (media?.optString("artworkKey") != key) return
            artwork = bitmap
            running?.publish()
        }
    }
}
