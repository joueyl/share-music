package com.musicshare.playback

import android.Manifest
import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import app.tauri.plugin.JSObject

/** Called only on the main looper, from the native, authenticated room connection. */
internal class RoomChatNotifications(private val activity: Activity) {
    private data class Scope(val socket: String, val room: String, val user: String)

    private val manager = activity.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    private var scope: Scope? = null
    private var foreground = true
    private var resumed = false
    private var unread = 0
    private val seen = LinkedHashSet<String>()

    fun resumed() {
        foreground = true
        clear()
        resumed = true
        maybeRequestPermission()
    }

    fun paused() { resumed = false }
    fun stopped() { foreground = false }

    fun updateScope(args: JSObject) {
        val next = readScope(args)
        if (next == scope) return
        scope = next
        seen.clear()
        clear()
        maybeRequestPermission()
    }

    private fun readScope(args: JSObject): Scope? {
        val socket = args.optString("socketId")
        val room = args.optString("roomId")
        val user = args.optString("userId")
        if (args.isNull("roomId") || args.isNull("userId") || socket.isBlank() || room.isBlank() || user.isBlank()) return null
        return Scope(socket, room, user)
    }

    private fun maybeRequestPermission() {
        if (!resumed || scope == null || Build.VERSION.SDK_INT < 33 ||
            activity.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) return
        val preferences = activity.getSharedPreferences("tone-room-chat", Context.MODE_PRIVATE)
        if (preferences.getBoolean("permission-requested", false)) return
        activity.requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), PERMISSION_REQUEST)
        preferences.edit().putBoolean("permission-requested", true).apply()
    }

    @Suppress("DEPRECATION")
    fun receive(args: JSObject) {
        if (scope == null || scope != readScope(args)) return
        val id = args.optString("id")
        val text = args.optString("body")
        if (id.isBlank() || text.isBlank() || !seen.add(id)) return
        if (seen.size > 64) seen.remove(seen.first())
        if (foreground || !manager.areNotificationsEnabled() ||
            (Build.VERSION.SDK_INT >= 33 &&
                activity.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)) return

        fun builder(): Notification.Builder = if (Build.VERSION.SDK_INT >= 26)
            Notification.Builder(activity, CHANNEL) else Notification.Builder(activity).setPriority(Notification.PRIORITY_HIGH)

        if (Build.VERSION.SDK_INT >= 26) {
            manager.createNotificationChannel(NotificationChannel(CHANNEL, "房间聊天", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "应用在后台时提醒当前房间的新消息"
                lockscreenVisibility = Notification.VISIBILITY_PRIVATE
            })
            if (manager.getNotificationChannel(CHANNEL)?.importance == NotificationManager.IMPORTANCE_NONE) return
        }

        val hidden = builder().setSmallIcon(android.R.drawable.ic_dialog_email)
            .setContentTitle("同频 · TONE").setContentText("收到新房间消息").build()
        val notice = builder()
            .setSmallIcon(android.R.drawable.ic_dialog_email)
            .setCategory(Notification.CATEGORY_MESSAGE)
            .setContentTitle("${args.optString("roomName")} · ${args.optString("sender")}")
            .setContentText(text)
            .setStyle(Notification.BigTextStyle().bigText(text))
            .setNumber((unread + 1).coerceAtMost(99))
            .setAutoCancel(true)
            .setVisibility(Notification.VISIBILITY_PRIVATE)
            .setPublicVersion(hidden)
        if (Build.VERSION.SDK_INT < 26) notice.setDefaults(Notification.DEFAULT_ALL)
        activity.packageManager.getLaunchIntentForPackage(activity.packageName)?.let { intent ->
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            notice.setContentIntent(PendingIntent.getActivity(activity, NOTIFICATION_ID, intent, PendingIntent.FLAG_IMMUTABLE))
        }
        manager.notify(NOTIFICATION_ID, notice.build())
        unread = (unread + 1).coerceAtMost(99)
    }

    fun clear() { unread = 0; manager.cancel(NOTIFICATION_ID) }

    private companion object {
        const val CHANNEL = "tone-room-chat"
        const val NOTIFICATION_ID = 418
        const val PERMISSION_REQUEST = 0x5443
    }
}
