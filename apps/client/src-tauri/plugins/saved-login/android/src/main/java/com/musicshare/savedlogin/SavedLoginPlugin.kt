package com.musicshare.savedlogin

import android.app.Activity
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import org.json.JSONObject
import java.io.File
import java.net.URI
import java.security.KeyStore
import java.util.concurrent.Executors
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** No plaintext preferences, WebView storage, exported key or cloud-backup file. */
@TauriPlugin
class SavedLoginPlugin(private val activity: Activity) : Plugin(activity) {
    private val worker = Executors.newSingleThreadExecutor()
    private val alias = "com.musicshare.saved-login.v1"
    private val aad = "${activity.packageName}/saved-login/v1".toByteArray(Charsets.UTF_8)
    private val file get() = AtomicFile(File(activity.noBackupFilesDir, "tone-login.v1.enc"))
    private fun store() = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    private fun key(create: Boolean): SecretKey {
        val store = store()
        val existing = store.getKey(alias, null)
        if (existing is SecretKey) return existing
        check(create) // Never replace a lost key while decrypting an existing file.
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
            init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256).setRandomizedEncryptionRequired(true).build())
            generateKey()
        }
    }
    private fun validate(value: JSONObject) {
        require(value.length() == 3)
        require(listOf("serverUrl", "name", "password").all { value.get(it) is String })
        val server = value.getString("serverUrl")
        val uri = URI(server)
        val local = uri.host in listOf("localhost", "127.0.0.1", "[::1]", "::1")
        require(server.length <= 1000 && uri.host != null &&
            (uri.scheme == "https" || uri.scheme == "http" && local) &&
            uri.rawUserInfo == null && uri.rawQuery == null && uri.rawFragment == null &&
            (uri.rawPath.isNullOrEmpty() || uri.rawPath == "/"))
        val name = value.getString("name")
        val password = value.getString("password")
        require(name.codePointCount(0, name.length) in 2..40)
        require(password.codePointCount(0, password.length) in 10..128)
    }
    private fun clearStorage() {
        store().deleteEntry(alias)
        file.delete()
        check(!file.baseFile.exists())
    }
    private fun execute(invoke: Invoke, code: String, operation: () -> Unit) {
        worker.execute {
            try { operation() } catch (_: Exception) { invoke.reject(code) }
        }
    }
    @Command
    fun available(invoke: Invoke) {
        worker.execute {
            val available = try { store(); Cipher.getInstance("AES/GCM/NoPadding"); true } catch (_: Exception) { false }
            invoke.resolveObject(available)
        }
    }
    @Command
    fun save(invoke: Invoke) = execute(invoke, "SAVED_LOGIN_WRITE_FAILED") {
        require(invoke.getRawArgs().length <= 8192)
        val credentials = invoke.getArgs().getJSONObject("credentials")
        validate(credentials)
        val plain = credentials.toString().toByteArray(Charsets.UTF_8)
        try {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, key(true))
            cipher.updateAAD(aad)
            val encrypted = byteArrayOf(1) + cipher.iv + cipher.doFinal(plain)
            require(cipher.iv.size == 12)
            val atomic = file
            val stream = atomic.startWrite()
            try { stream.write(encrypted); atomic.finishWrite(stream) }
            catch (error: Exception) { atomic.failWrite(stream); throw error }
        } finally { plain.fill(0) }
        invoke.resolve()
    }
    @Command
    fun load(invoke: Invoke) = execute(invoke, "SAVED_LOGIN_READ_FAILED") {
        val atomic = file
        if (!atomic.baseFile.exists() && !File(atomic.baseFile.path + ".bak").exists()) {
            invoke.resolve(); return@execute
        }
        try {
            val encrypted = atomic.openRead().use { stream ->
                require(stream.available() in 30..16384)
                stream.readBytes()
            }
            require(encrypted.size in 30..16384 && encrypted[0] == 1.toByte())
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key(false), GCMParameterSpec(128, encrypted.copyOfRange(1, 13)))
            cipher.updateAAD(aad)
            val plain = cipher.doFinal(encrypted, 13, encrypted.size - 13)
            try {
                val credentials = JSObject(String(plain, Charsets.UTF_8))
                validate(credentials)
                invoke.resolve(credentials)
            } finally { plain.fill(0) }
        } catch (error: Exception) {
            // Corrupt/restored ciphertext or an invalidated key cannot silently auto-login.
            clearStorage()
            throw error
        }
    }
    @Command
    fun clear(invoke: Invoke) = execute(invoke, "SAVED_LOGIN_DELETE_FAILED") {
        clearStorage()
        invoke.resolve()
    }
}
