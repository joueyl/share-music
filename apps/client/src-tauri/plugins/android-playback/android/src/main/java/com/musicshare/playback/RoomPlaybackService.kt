package com.musicshare.playback

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

/** Foreground lifetime for the single process-owned MediaPlayer; never restores an old room. */
class RoomPlaybackService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    @Suppress("DEPRECATION")
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
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
        val shown = notification
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentTitle("同频 · TONE")
            .setContentText("房间音乐播放中")
            .setCategory(Notification.CATEGORY_TRANSPORT)
            .setOnlyAlertOnce(true)
            .setOngoing(true)
            .build()
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTIFICATION_ID, shown, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
        } else startForeground(NOTIFICATION_ID, shown)
        return START_NOT_STICKY
    }

    private companion object {
        const val CHANNEL = "tone-room-playback"
        const val NOTIFICATION_ID = 417
    }
}
