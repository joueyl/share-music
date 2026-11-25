package com.musicshare.playback

import app.tauri.plugin.Channel
import app.tauri.plugin.JSObject
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Handler
import android.os.SystemClock
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.Future
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit

/** Main-looper room state machine. The server, not the local queue, selects the source. */
internal class RoomDriver(
    private val main: Handler,
    private val read: () -> JSObject,
    private val load: (String, Long, String) -> Unit,
    private val play: () -> Unit,
    private val pause: () -> Unit,
    private val seek: (Long) -> Unit,
    private val clearTrack: () -> Unit,
    private val stop: () -> Unit,
) {
    private val io = ThreadPoolExecutor(2, 2, 0L, TimeUnit.MILLISECONDS, ArrayBlockingQueue(2))
    private var link: Future<*>? = null
    private var cover: Future<*>? = null
    private var socket = ""
    private var state: JSObject? = null
    private var controls: Channel? = null
    private var identity = ""
    private var epoch = -1L
    private var generation = 0L
    private var loaded = false
    private var linkFailed = false
    private var retried = false
    private var positioned = false
    private var started = false
    private var ready = ""
    private var lastReport = 0L
    private var lastSample = 0L
    private var lastPosition = 0L
    private var listened = 0L
    private var driftSince = 0L
    private var driftDirection = 0
    private var correctionAfter = 0L
    private var artworkKey = ""
    private var coverAttempts = 0
    private var retryCoverAt = 0L
    private var mediaSignature = ""
    private var waitingSince = 0L
    private var lastAdvance = 0L
    private val tick = Runnable { drive() }
    private val expire = Runnable { reset() }
    private val id = Regex("[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}")

    fun update(args: JSObject, channel: Channel?) {
        val incoming = args.optString("socketId")
        when (args.optString("driverState")) {
            "reset" -> { reset(); socket = incoming; return }
            "closed", "clear" -> { if (incoming == socket) reset(); return }
            "disconnected" -> {
                if (incoming != socket) return
                state = null
                controls = null
                generation++
                if (!loaded) { link?.cancel(true); link = null }
                cover?.cancel(true)
                cover = null
                io.purge()
                artworkKey = ""
                coverAttempts = 0
                retryCoverAt = 0L
                lastSample = 0
                ready = ""
                main.removeCallbacks(tick)
                main.removeCallbacks(expire)
                main.postDelayed(expire, 25_000)
                RoomPlaybackService.update(null, null)
                mediaSignature = ""
                return
            }
            "snapshot" -> Unit
            else -> return
        }
        if (socket != incoming) { reset(); socket = incoming }
        val room = args.optString("roomId")
        val track = args.optJSONObject("track") ?: return
        val trackId = track.optString("id")
        val p = args.optJSONObject("playback") ?: return
        if (!id.matches(room) || !id.matches(trackId)) return
        if (p.optString("playState") == "stopped") { reset(); return }
        main.removeCallbacks(expire)
        state = args
        controls = channel
        val next = "$room/$trackId/${track.optString("contentHash")}"
        val nextEpoch = p.optLong("sourceEpoch", -1)
        if (identity != next) {
            link?.cancel(true); cover?.cancel(true); cover = null; io.purge()
            generation++
            identity = next
            loaded = false
            linkFailed = false
            retried = false
            artworkKey = ""
            coverAttempts = 0
            retryCoverAt = 0L
            clearTrack()
            fetchLink(args, false)
        } else if (link == null && !loaded && !linkFailed) {
            fetchLink(args, retried)
        }
        if (epoch != nextEpoch) {
            epoch = nextEpoch
            positioned = false; started = false; ready = ""
            lastReport = 0; lastSample = 0; listened = 0; driftSince = 0; lastAdvance = 0; waitingSince = 0
            pause()
            if (linkFailed || (loaded && read().optInt("errorCode") != 0)) {
                loaded = false
                linkFailed = false
                retried = false
                fetchLink(args, false)
            }
        }
        main.removeCallbacks(tick)
        drive()
    }

    fun reset() {
        generation++
        link?.cancel(true); cover?.cancel(true); io.purge()
        link = null; cover = null
        main.removeCallbacks(tick); main.removeCallbacks(expire)
        state = null; controls = null; identity = ""; epoch = -1; loaded = false; linkFailed = false
        artworkKey = ""; mediaSignature = ""; coverAttempts = 0; retryCoverAt = 0L
        RoomPlaybackService.update(null, null)
        stop()
    }

    fun destroy() { reset(); io.shutdownNow() }

    private fun pending(s: JSObject) = !s.isNull("pending") && !s.optString("pending").isBlank()

    private fun target(s: JSObject, p: JSONObject, now: Long): Long {
        val elapsed = if (p.optString("playState") == "playing" && (!pending(s) || s.optBoolean("committed")))
            (now + s.optLong("offsetMs") - p.optLong("effectiveAtServerMs")).coerceAtLeast(0L) else 0L
        return p.optLong("positionMs") + elapsed
    }

    private fun fetchLink(s: JSObject, refresh: Boolean) {
        val rev = generation
        try {
            link = io.submit {
                val bytes = request(s, if (refresh) "?refresh=1" else "", 64 * 1024)
                val data = bytes?.let { runCatching { JSONObject(it.toString(Charsets.UTF_8)) }.getOrNull() }
                main.post {
                    if (rev != generation) return@post
                    val current = state ?: return@post
                    val url = data?.optString("url").orEmpty()
                    val size = data?.optLong("sizeBytes") ?: 0L
                    if (size in 1L..104_857_600L && url.length in 1..8192) {
                        loaded = runCatching {
                            load(url, size, data?.optString("contentHash").orEmpty())
                        }.isSuccess
                    }
                    if (!loaded && !retried) { retried = true; fetchLink(current, true) }
                    else if (!loaded) linkFailed = true
                }
            }
        } catch (_: RuntimeException) { linkFailed = true }
    }

    private fun request(s: JSObject, suffix: String, limit: Int): ByteArray? {
        val room = s.optString("roomId")
        val track = s.optJSONObject("track")?.optString("id").orEmpty()
        if (!id.matches(room) || !id.matches(track)) return null
        val uri = Uri.parse(s.optString("base"))
        if (!((uri.scheme == "https") || (uri.scheme == "http" && uri.host in listOf("localhost", "127.0.0.1", "::1", "[::1]")))) return null
        return fetch("${s.optString("base")}/api/rooms/$room/music/$track$suffix", limit, s.optString("token"))
    }

    private fun fetch(url: String, limit: Int, token: String? = null): ByteArray? = runCatching {
        val connection = URL(url).openConnection() as HttpURLConnection
        try {
            connection.instanceFollowRedirects = false
            connection.connectTimeout = 6_000; connection.readTimeout = 8_000
            if (token != null) connection.setRequestProperty("Authorization", "Bearer $token")
            val deadline = SystemClock.elapsedRealtime() + 15_000L
            if (connection.responseCode != 200) return null
            if (connection.contentLengthLong > limit) return null
            connection.inputStream.use { input ->
                val chunks = java.io.ByteArrayOutputStream()
                val buffer = ByteArray(8192)
                while (true) {
                    val n = input.read(buffer)
                    if (n < 0) break
                    if (chunks.size() + n > limit || Thread.currentThread().isInterrupted || SystemClock.elapsedRealtime() >= deadline) return null
                    chunks.write(buffer, 0, n)
                }
                chunks.toByteArray()
            }
        } finally { connection.disconnect() }
    }.getOrNull()

    private fun publicCover(value: String): ByteArray? = runCatching {
        val u = java.net.URI(value)
        val host = u.host.orEmpty().lowercase(java.util.Locale.ROOT)
        if (u.scheme != "https" || u.port != -1 || u.rawUserInfo != null || u.rawFragment != null ||
            !(host == "y.gtimg.cn" || host.endsWith(".music.126.net") || host.endsWith(".music.163.com"))) return null
        // Provider fallback is anonymous and does not follow redirects.
        fetch(value, 10 * 1024 * 1024)
    }.getOrNull()

    private fun decodeCover(bytes: ByteArray?): Bitmap? {
        if (bytes == null) return null
        val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
        if (options.outWidth !in 1..8192 || options.outHeight !in 1..8192) return null
        var sample = 1
        while (maxOf(options.outWidth, options.outHeight) / sample > 256) sample *= 2
        return BitmapFactory.decodeByteArray(bytes, 0, bytes.size,
            BitmapFactory.Options().apply { inSampleSize = sample })
    }

    private fun emit(s: JSObject, kind: String, fill: JSObject.() -> Unit) {
        controls?.send(JSObject().apply {
            put("socketId", socket); put("roomId", s.optString("roomId"))
            put("sourceEpoch", epoch); put("action", kind)
            fill()
        })
    }

    private fun drive() {
        val s = state ?: return
        val p = s.optJSONObject("playback") ?: return
        val a = runCatching(read).getOrNull()
        val now = System.currentTimeMillis()
        val desired = target(s, p, now)
        val playing = p.optString("playState") == "playing"
        val waiting = pending(s) && !s.optBoolean("committed")
        val upcoming = pending(s) && now + s.optLong("offsetMs") < p.optLong("effectiveAtServerMs")
        try {
            if (loaded && a != null) {
                if (a.optInt("errorCode") != 0 && !retried) { retried = true; loaded = false; positioned = false; fetchLink(s, true) }
                val duration = a.optLong("durationMs")
                val position = a.optLong("positionMs")
                val goal = desired.coerceIn(0L, (duration - 1L).coerceAtLeast(0L))
                if (started && playing && !upcoming && !waiting && a.optBoolean("playing")) {
                    if (waitingSince == 0L || position > lastAdvance) {
                        lastAdvance = position
                        waitingSince = now
                    } else if (!a.optBoolean("seeking") && now - waitingSince >= 8000 && !retried) {
                        // One bounded reload for a decoder that stopped advancing mid-track.
                        retried = true
                        loaded = false; positioned = false; started = false; lastSample = 0; lastAdvance = 0
                        clearTrack()
                        fetchLink(s, true)
                        updateMedia(s, null)
                        main.postDelayed(tick, 100)
                        return
                    }
                }
                if (a.optBoolean("prepared") && !a.optBoolean("seeking")) {
                    if (!positioned && !a.optBoolean("buffering")) {
                        positioned = true
                        if (kotlin.math.abs(goal - position) > 250) seek(goal)
                    } else if (positioned && !a.optBoolean("buffering")) {
                        if (waiting) {
                            val transition = s.optString("pending")
                            if (transition != ready) {
                                ready = transition
                                emit(s, "ready") { put("transitionId", transition) }
                            }
                        } else if (playing && !upcoming && !started && desired < duration) {
                            started = true
                            play()
                            correctionAfter = now + 3000L
                        }
                    }
                }
                if (!waiting && !pending(s) && playing && a.optBoolean("playing") && !a.optBoolean("seeking") && !a.optBoolean("buffering")) {
                    val elapsed = now - lastSample
                    val advanced = position - lastPosition
                    if (elapsed in 1L..2500L && advanced in 1L..(elapsed + 250L)) listened += minOf(elapsed, advanced)
                    lastSample = now; lastPosition = position
                    val follower = !p.isNull("leaderId") && p.optString("leaderId") != s.optString("userId")
                    val drift = position - goal
                    if (follower && now >= correctionAfter && kotlin.math.abs(drift) > 600 && duration > desired) {
                        val direction = if (drift > 0) 1 else -1
                        if (driftSince == 0L || direction != driftDirection) {
                            driftSince = now; driftDirection = direction
                        } else if (now - driftSince >= 500 && advanced > 0) {
                            seek(goal); correctionAfter = now + 3000L; driftSince = 0
                            lastSample = 0
                        }
                    } else driftSince = 0
                    if (lastSample != 0L && !follower && now - lastReport >= 1000) {
                        lastReport = now
                        emit(s, "progress") {
                            put("positionMs", position); put("sampledAtServerMs", a.optLong("sampledAtMs", now) + s.optLong("offsetMs"))
                            put("listenedMs", listened)
                        }
                    }
                } else lastSample = 0
            }
            updateMedia(s, a)
        } catch (_: RuntimeException) { /* do not terminate the native room task */ }
        main.postDelayed(tick, 100)
    }

    fun annotate(result: JSObject): JSObject = result.apply {
        put("roomId", state?.optString("roomId").orEmpty())
        put("sourceEpoch", epoch)
        if (linkFailed) put("errorCode", 1)
    }

    private fun updateMedia(s: JSObject, a: JSObject?) {
        val track = s.optJSONObject("track") ?: return
        val key = identity
        val canControl = s.optBoolean("canControl") && !pending(s)
        val duration = track.optLong("durationMs")
        val canSeek = s.optBoolean("canSeek") && !pending(s) && duration > 0
        val active = a?.optBoolean("playing") == true
        val signature = "$key/$epoch/$canControl/$canSeek/$active/${(a?.optLong("positionMs") ?: 0L) / 1000}"
        if (signature != mediaSignature) {
            mediaSignature = signature
            RoomPlaybackService.update(JSObject().apply {
                put("socketId", socket); put("roomId", s.optString("roomId"))
                put("trackId", track.optString("id")); put("artworkKey", key); put("sourceEpoch", epoch)
                put("title", track.optString("name")); put("artist", track.optString("artists")); put("album", track.optString("album"))
                put("positionMs", a?.optLong("positionMs") ?: 0L); put("durationMs", duration)
                put("canControl", canControl); put("canSeek", canSeek); put("playback", if (active) "playing" else "paused")
            }, controls)
        }
        val now = SystemClock.elapsedRealtime()
        if (key != artworkKey && coverAttempts < 2 && now >= retryCoverAt && cover?.isDone != false) {
            coverAttempts++
            retryCoverAt = now + 2500L
            val revision = generation
            val publicUrl = track.optString("coverUrl")
            try {
                cover = io.submit {
                    val image = runCatching {
                        decodeCover(request(s, "/cover/image", 10 * 1024 * 1024))
                            ?: if (Thread.currentThread().isInterrupted) null else decodeCover(publicCover(publicUrl))
                    }.getOrNull() ?: return@submit
                    main.post {
                        if (revision == generation && state != null) {
                            artworkKey = key
                            RoomPlaybackService.updateArtwork(key, image)
                        }
                    }
                }
            } catch (_: RuntimeException) { /* artwork is optional */ }
        }
    }
}
