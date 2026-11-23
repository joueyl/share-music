package com.musicshare.playback

import android.media.MediaDataSource
import android.os.SystemClock
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.io.RandomAccessFile
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL

/** Seekable, fixed-size audio from the same HTTPS providers accepted by the room server. */
internal class TrackDataSource(url: String, private val length: Long, private val cacheDir: File) : MediaDataSource() {
    private val initial = checkedUrl(url)
    private var resolved = initial
    private val chunks = LinkedHashMap<Long, ByteArray>(8, 0.75f, true)
    private var strongETag: String? = null
    @Volatile private var closed = false
    @Volatile private var connection: HttpURLConnection? = null
    @Volatile private var fallback: File? = null

    init { require(length in 1L..(100L * 1024 * 1024)) }

    override fun getSize(): Long = length

    @Synchronized
    override fun readAt(position: Long, buffer: ByteArray, offset: Int, size: Int): Int {
        if (closed) throw IOException("SOURCE_CLOSED")
        if (size == 0) return 0
        if (position < 0 || position >= length) return -1
        val requested = minOf(size.toLong(), length - position).toInt()
        var written = 0
        while (written < requested) {
            val at = position + written
            fallback?.let { file ->
                RandomAccessFile(file, "r").use {
                    it.seek(at)
                    it.readFully(buffer, offset + written, requested - written)
                }
                return requested
            }
            val start = at / CHUNK * CHUNK
            val bytes = chunks[start] ?: fetchChunk(start).also {
                chunks[start] = it
                if (chunks.size > 4) chunks.remove(chunks.keys.first())
            }
            val from = (at - start).toInt()
            val count = minOf(requested - written, bytes.size - from)
            bytes.copyInto(buffer, offset + written, from, from + count)
            written += count
        }
        return requested
    }

    private fun fetchChunk(start: Long): ByteArray {
        val end = minOf(length, start + CHUNK) - 1
        var url = resolved
        repeat(4) {
            if (closed) throw IOException("SOURCE_CLOSED")
            val response = url.openConnection() as HttpURLConnection
            connection = response
            var reusable = false
            try {
                if (closed) throw IOException("SOURCE_CLOSED")
                response.instanceFollowRedirects = false
                response.useCaches = false
                response.connectTimeout = 8000
                response.readTimeout = 8000
                response.setRequestProperty("Range", "bytes=$start-$end")
                response.setRequestProperty("Accept-Encoding", "identity")
                strongETag?.let { response.setRequestProperty("If-Range", it) }
                val status = response.responseCode
                if (status in REDIRECTS) {
                    val location = response.getHeaderField("Location") ?: throw IOException("SOURCE_REDIRECT")
                    url = checkedUrl(url.toURI().resolve(location).toString())
                } else if (status == 206 || status == 200) {
                    if (response.contentEncoding?.equals("identity", true) == false) throw IOException("SOURCE_ENCODING")
                    val bytes = ByteArray((end - start + 1).toInt())
                    response.inputStream.use { input ->
                        if (status == 206) {
                            val tag = response.getHeaderField("ETag")?.takeIf { it.startsWith('"') && it.endsWith('"') }
                            if (strongETag != null && strongETag != tag) throw IOException("SOURCE_CHANGED")
                            strongETag = tag
                            if (response.getHeaderField("Content-Range") != "bytes $start-$end/$length") throw IOException("SOURCE_RANGE")
                            readExact(input, bytes)
                            if (input.read() != -1) throw IOException("SOURCE_SIZE")
                        } else {
                            if (chunks.isNotEmpty()) throw IOException("SOURCE_CHANGED")
                            if (response.contentLengthLong >= 0 && response.contentLengthLong != length) throw IOException("SOURCE_SIZE")
                            storeFallback(input)
                            RandomAccessFile(fallback ?: throw IOException("SOURCE_CLOSED"), "r").use {
                                it.seek(start)
                                it.readFully(bytes)
                            }
                        }
                    }
                    resolved = url
                    reusable = true
                    return bytes
                } else throw IOException("SOURCE_HTTP")
            } finally {
                if (!reusable || closed) response.disconnect()
                connection = null
            }
        }
        throw IOException("SOURCE_REDIRECT")
    }

    private fun readExact(input: InputStream, bytes: ByteArray) {
        val deadline = SystemClock.elapsedRealtime() + 12000
        var count = 0
        while (count < bytes.size) {
            if (closed || SystemClock.elapsedRealtime() > deadline) throw IOException("SOURCE_TIMEOUT")
            val read = input.read(bytes, count, bytes.size - count)
            if (read < 0) throw IOException("SOURCE_SIZE")
            count += read
        }
    }

    private fun storeFallback(input: InputStream) {
        val file = File.createTempFile("tone-native-", ".audio", cacheDir)
        val deadline = SystemClock.elapsedRealtime() + 60000
        try {
            file.outputStream().buffered().use { output ->
                val buffer = ByteArray(65536)
                var remaining = length
                while (remaining > 0) {
                    if (closed || SystemClock.elapsedRealtime() > deadline) throw IOException("SOURCE_TIMEOUT")
                    val read = input.read(buffer, 0, minOf(remaining, buffer.size.toLong()).toInt())
                    if (read < 0) throw IOException("SOURCE_SIZE")
                    output.write(buffer, 0, read)
                    remaining -= read
                }
                if (input.read() != -1) throw IOException("SOURCE_SIZE")
            }
            fallback = file
            if (closed) throw IOException("SOURCE_CLOSED")
        } finally {
            if (closed || fallback !== file) file.delete()
        }
    }

    override fun close() {
        closed = true
        connection?.disconnect()
        fallback?.delete()
    }

    private companion object {
        const val CHUNK = 128L * 1024
        val REDIRECTS = setOf(301, 302, 303, 307, 308)
        val HOST = Regex("[a-z0-9-]+(?:\\.music\\.126\\.net|\\.stream\\.qqmusic\\.qq\\.com)", RegexOption.IGNORE_CASE)
        fun checkedUrl(value: String): URL {
            require(value.length <= 8192)
            val uri = URI(value)
            require(uri.scheme.equals("https", true) && HOST.matches(uri.host ?: "") &&
                uri.port in listOf(-1, 443) && uri.rawUserInfo == null && uri.rawFragment == null)
            return uri.toURL()
        }
    }
}
