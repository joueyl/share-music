package com.musicshare.playback

import java.io.File
import java.io.IOException
import java.io.RandomAccessFile
import java.util.BitSet

/** Keeps only complete origin responses; incomplete sparse files belong to one data source. */
internal class TrackFileCache(cacheDir: File, key: String, private val length: Long, private val chunkSize: Long) {
    private val directory = File(cacheDir, "tone-audio-v1")
    private val target = key.takeIf { KEY.matches(it) }?.let { File(directory, "$it-$length.audio") }
    private val chunkCount = ((length + chunkSize - 1) / chunkSize).toInt()
    private val present = BitSet()
    private var partial: File? = null
    private var partialEnd = 0L
    private var reader: RandomAccessFile? = null
    private var lookedUp = false
    private var closed = false
    private var writeFailed = false

    @Synchronized
    fun readComplete(position: Long, buffer: ByteArray, offset: Int, size: Int): Boolean {
        if (closed || target == null) return false
        return try {
            if (!lookedUp) {
                lookedUp = true
                if (target.isFile && target.length() == length) {
                    reader = RandomAccessFile(target, "r")
                    optional(Unit) { target.setLastModified(System.currentTimeMillis()); Unit }
                } else if (target.isFile) target.delete()
            }
            val input = reader ?: return false
            input.seek(position)
            input.readFully(buffer, offset, size)
            true
        } catch (_: IOException) {
            lookedUp = false
            invalidate()
            false
        } catch (_: SecurityException) {
            invalidate()
            false
        }
    }

    @Synchronized
    fun readChunk(start: Long, size: Int): ByteArray? {
        val file = partial ?: return null
        if (closed || !present.get((start / chunkSize).toInt())) return null
        return optional<ByteArray?>(null) {
            RandomAccessFile(file, "r").use { input ->
                input.seek(start)
                ByteArray(size).also { input.readFully(it) }
            }
        } ?: run { clearPartial(); null }
    }

    @Synchronized
    fun storeChunk(start: Long, bytes: ByteArray) {
        if (closed || target == null || writeFailed || reader != null) return
        if (!optional(false) {
            partial?.let { if (!it.isFile || it.length() != partialEnd) clearPartial() }
            val file = partial ?: newPartial().also { partial = it }
            RandomAccessFile(file, "rw").use { output ->
                if (output.length() != partialEnd) throw IOException("CACHE_PARTIAL_CHANGED")
                output.seek(start)
                output.write(bytes)
            }
            partialEnd = maxOf(partialEnd, start + bytes.size)
            present.set((start / chunkSize).toInt())
            if (present.cardinality() == chunkCount) {
                if (!retainComplete(file)) throw IOException("CACHE_SAVE")
                partial = null
            }
            true
        }) {
            writeFailed = true
            clearPartial()
        }
    }

    // Also adopts a verified full-body response when the origin ignores Range.
    @Synchronized
    fun retainComplete(file: File): Boolean {
        if (closed || target == null) return false
        return optional(false) {
            if (!directory.isDirectory && !directory.mkdirs()) return@optional false
            if (file.length() != length) return@optional false
            val input = RandomAccessFile(file, "r")
            try {
                if (!file.renameTo(target)) return@optional false
                closeReader()
                reader = input
                lookedUp = true
            } finally {
                if (reader !== input) optional(Unit) { input.close() }
            }
            optional(Unit) {
                target.setLastModified(System.currentTimeMillis())
                trim(target)
            }
            true
        }
    }

    @Synchronized
    fun invalidate() {
        if (reader != null || !lookedUp) optional(Unit) { target?.delete(); Unit }
        closeReader()
        lookedUp = true
    }

    @Synchronized
    fun close() {
        closed = true
        closeReader()
        clearPartial()
    }

    private fun newPartial(): File {
        if (!directory.isDirectory && !directory.mkdirs()) throw IOException("CACHE_DIRECTORY")
        val staleBefore = System.currentTimeMillis() - STALE_MS
        directory.listFiles()?.filter { it.name.endsWith(".part") && it.lastModified() < staleBefore }
            ?.forEach { it.delete() }
        return File.createTempFile("track-", ".part", directory)
    }

    private fun clearPartial() {
        optional(Unit) { partial?.delete(); Unit }
        partial = null
        partialEnd = 0
        present.clear()
    }

    private fun closeReader() {
        optional(Unit) { reader?.close(); Unit }
        reader = null
    }

    private fun trim(current: File) {
        val files = directory.listFiles()?.filter { it.isFile && it.name.endsWith(".audio") } ?: return
        var bytes = files.sumOf { it.length() }
        var count = files.size
        for (file in files.sortedBy { it.lastModified() }) {
            if (bytes <= MAX_BYTES && count <= MAX_FILES) break
            if (file == current) continue
            val size = file.length()
            if (file.delete()) { bytes -= size; count-- }
        }
    }

    private inline fun <T> optional(default: T, action: () -> T): T = try { action() }
        catch (_: IOException) { default }
        catch (_: SecurityException) { default }

    private companion object {
        val KEY = Regex("(?:[a-f0-9]{32}|[a-f0-9]{64})")
        const val MAX_BYTES = 512L * 1024 * 1024
        const val MAX_FILES = 200
        const val STALE_MS = 24L * 60 * 60 * 1000
    }
}
