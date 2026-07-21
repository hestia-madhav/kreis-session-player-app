package org.cmca.player

import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import android.webkit.JavascriptInterface
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

class PlayerBridge(
    private val context: Context,
    private val sessionManager: SessionManager,
    private val onNavigate: (String) -> Unit
) {
    private val prefs = context.getSharedPreferences("cmca_player", Context.MODE_PRIVATE)
    private val pendingCompletions = mutableListOf<Pair<String, Boolean>>()

    @JavascriptInterface
    fun login(userId: String, password: String): Boolean {
        val storedHash = getCredentials()[userId] ?: return false
        val inputHash = sha256(password)
        if (storedHash == inputHash) {
            prefs.edit()
                .putString("logged_in_user", userId)
                .putBoolean("is_logged_in", true)
                .apply()
            return true
        }
        return false
    }

    @JavascriptInterface
    fun logout() {
        prefs.edit()
            .remove("logged_in_user")
            .putBoolean("is_logged_in", false)
            .apply()
    }

    @JavascriptInterface
    fun isLoggedIn(): Boolean = prefs.getBoolean("is_logged_in", false)

    @JavascriptInterface
    fun getLoggedInUser(): String = prefs.getString("logged_in_user", "") ?: ""

    @JavascriptInterface
    fun getSessionManifest(): String = sessionManager.getManifestJson()

    @JavascriptInterface
    fun downloadSession(id: String, url: String, sizeBytes: Long) {
        Thread {
            val success = sessionManager.downloadSession(id, url, sizeBytes)
            val js = "window.onDownloadComplete && window.onDownloadComplete('$id', $success)"
            try {
                onNavigate("javascript:$js")
            } catch (_: Exception) {
                synchronized(pendingCompletions) { pendingCompletions.add(Pair(id, success)) }
            }
        }.start()
    }

    @JavascriptInterface
    fun getPendingDownloads(): String {
        synchronized(pendingCompletions) {
            val arr = org.json.JSONArray()
            pendingCompletions.forEach { (id, ok) ->
                arr.put(JSONObject().put("id", id).put("success", ok))
            }
            pendingCompletions.clear()
            return arr.toString()
        }
    }

    @JavascriptInterface
    fun deleteSession(id: String): Boolean = sessionManager.deleteSession(id)

    @JavascriptInterface
    fun getDownloadProgress(id: String): Int = sessionManager.getDownloadProgress(id)

    @JavascriptInterface
    fun isSessionDownloaded(id: String): Boolean = sessionManager.isSessionDownloaded(id)

    @JavascriptInterface
    fun isOnline(): Boolean {
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val network = cm.activeNetwork ?: return false
            val caps = cm.getNetworkCapabilities(network) ?: return false
            return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
        } else {
            @Suppress("DEPRECATION")
            return cm.activeNetworkInfo?.isConnected == true
        }
    }

    @JavascriptInterface
    fun getStorageInfo(): String = sessionManager.getStorageInfo().toString()

    @JavascriptInterface
    fun navigate(path: String) {
        onNavigate(path)
    }

    @JavascriptInterface
    fun getAppVersion(): String {
        return try {
            context.packageManager.getPackageInfo(context.packageName, 0).versionName ?: "0.0.0"
        } catch (e: Exception) {
            "0.0.0"
        }
    }

    @JavascriptInterface
    fun checkAppUpdate(): String {
        return try {
            val text = fetchWithRedirects(APP_VERSION_URL)
            val remote = JSONObject(text)
            val remoteVersion = remote.optString("version", "0.0.0")
            val currentVersion = getAppVersion()
            val result = JSONObject()
            result.put("currentVersion", currentVersion)
            result.put("remoteVersion", remoteVersion)
            result.put("hasUpdate", compareVersions(remoteVersion, currentVersion) > 0)
            result.put("downloadUrl", remote.optString("downloadUrl", ""))
            result.put("changelog", remote.optString("changelog", ""))
            result.toString()
        } catch (e: Exception) {
            val result = JSONObject()
            result.put("currentVersion", getAppVersion())
            result.put("hasUpdate", false)
            result.put("error", e.message ?: "Update check failed")
            result.toString()
        }
    }

    @JavascriptInterface
    fun downloadAndInstallUpdate(url: String) {
        Thread {
            try {
                val conn = followRedirects(url)
                val apkFile = File(context.getExternalFilesDir(null), "update.apk")
                val input = BufferedInputStream(conn.inputStream)
                val output = FileOutputStream(apkFile)
                val buffer = ByteArray(8192)
                var n: Int
                while (input.read(buffer).also { n = it } != -1) {
                    output.write(buffer, 0, n)
                }
                output.close()
                input.close()
                conn.disconnect()

                val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", apkFile)
                val intent = Intent(Intent.ACTION_VIEW).apply {
                    setDataAndType(uri, "application/vnd.android.package-archive")
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                context.startActivity(intent)
            } catch (e: Exception) {
                val js = "window.onAppUpdateError && window.onAppUpdateError('${e.message?.replace("'", "\\'")}')"
                onNavigate("javascript:$js")
            }
        }.start()
    }

    private fun followRedirects(urlStr: String, maxRedirects: Int = 5): HttpURLConnection {
        var url = urlStr
        for (i in 0 until maxRedirects) {
            val conn = URL(url).openConnection() as HttpURLConnection
            conn.connectTimeout = 15000
            conn.readTimeout = 60000
            conn.instanceFollowRedirects = false
            val code = conn.responseCode
            if (code in 301..302 || code == 307 || code == 308) {
                url = conn.getHeaderField("Location") ?: throw Exception("Redirect with no Location")
                conn.disconnect()
                continue
            }
            return conn
        }
        throw Exception("Too many redirects")
    }

    private fun fetchWithRedirects(urlStr: String, maxRedirects: Int = 5): String {
        var url = urlStr
        for (i in 0 until maxRedirects) {
            val conn = URL(url).openConnection() as HttpURLConnection
            conn.connectTimeout = 5000
            conn.readTimeout = 5000
            conn.instanceFollowRedirects = false
            val code = conn.responseCode
            if (code in 301..302 || code == 307 || code == 308) {
                url = conn.getHeaderField("Location") ?: throw Exception("Redirect with no Location")
                conn.disconnect()
                continue
            }
            val text = conn.inputStream.bufferedReader().readText()
            conn.disconnect()
            return text
        }
        throw Exception("Too many redirects")
    }

    private fun compareVersions(a: String, b: String): Int {
        val pa = a.split(".").map { it.toIntOrNull() ?: 0 }
        val pb = b.split(".").map { it.toIntOrNull() ?: 0 }
        for (i in 0 until maxOf(pa.size, pb.size)) {
            val va = pa.getOrElse(i) { 0 }
            val vb = pb.getOrElse(i) { 0 }
            if (va != vb) return va.compareTo(vb)
        }
        return 0
    }

    companion object {
        const val APP_VERSION_URL = "https://github.com/hestia-madhav/kreis-session-player-app/releases/latest/download/app-version.json"
    }

    private fun getCredentials(): Map<String, String> {
        return try {
            val json = context.assets.open("credentials.json").bufferedReader().readText()
            val obj = JSONObject(json)
            val users = obj.optJSONObject("users") ?: return emptyMap()
            val map = mutableMapOf<String, String>()
            users.keys().forEach { key ->
                map[key] = users.getString(key)
            }
            map
        } catch (e: Exception) {
            emptyMap()
        }
    }

    private fun sha256(input: String): String {
        val bytes = MessageDigest.getInstance("SHA-256").digest(input.toByteArray())
        return bytes.joinToString("") { "%02x".format(it) }
    }
}
