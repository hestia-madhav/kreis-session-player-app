package org.cmca.player

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.zip.ZipInputStream

class SessionManager(private val context: Context) {

    companion object {
        const val MANIFEST_URL = "https://github.com/hestia-madhav/kreis-session-player-app/releases/latest/download/manifest.json"
    }

    val sessionsDir: File = File(context.getExternalFilesDir(null), "sessions")
    private val localManifestFile = File(sessionsDir, "manifest.json")
    private val downloadProgress = mutableMapOf<String, Int>()

    init {
        sessionsDir.mkdirs()
        if (!localManifestFile.exists()) {
            localManifestFile.writeText(JSONObject().put("sessions", JSONArray()).toString())
        }
    }

    fun getManifestJson(): String {
        val local = getLocalManifest()
        val localMap = mutableMapOf<String, JSONObject>()
        val localArr = local.optJSONArray("sessions") ?: JSONArray()
        for (i in 0 until localArr.length()) {
            val s = localArr.getJSONObject(i)
            localMap[s.getString("id")] = s
        }

        val remote = getRemoteManifest()
        if (remote != null) {
            val remoteArr = remote.optJSONArray("sessions") ?: JSONArray()
            for (i in 0 until remoteArr.length()) {
                val rs = remoteArr.getJSONObject(i)
                val id = rs.getString("id")
                val existing = localMap[id]
                if (existing != null) {
                    val localVer = existing.optInt("version", 0)
                    val remoteVer = rs.optInt("version", 0)
                    existing.put("remoteVersion", remoteVer)
                    existing.put("hasUpdate", remoteVer > localVer)
                    existing.put("downloadUrl", rs.optString("downloadUrl", ""))
                    existing.put("sizeBytes", rs.optLong("sizeBytes", 0))
                    existing.put("title", rs.optString("title", id))
                    existing.put("subtitle", rs.optString("subtitle", ""))
                    existing.put("programme", rs.optString("programme", "kreis"))
                    existing.put("num", rs.optInt("num", 0))
                    existing.put("durationMin", rs.optInt("durationMin", 60))
                } else {
                    val newEntry = JSONObject()
                    newEntry.put("id", id)
                    newEntry.put("title", rs.optString("title", id))
                    newEntry.put("subtitle", rs.optString("subtitle", ""))
                    newEntry.put("programme", rs.optString("programme", "kreis"))
                    newEntry.put("num", rs.optInt("num", 0))
                    newEntry.put("durationMin", rs.optInt("durationMin", 60))
                    newEntry.put("version", 0)
                    newEntry.put("remoteVersion", rs.optInt("version", 1))
                    newEntry.put("downloaded", false)
                    newEntry.put("hasUpdate", true)
                    newEntry.put("downloadUrl", rs.optString("downloadUrl", ""))
                    newEntry.put("sizeBytes", rs.optLong("sizeBytes", 0))
                    localMap[id] = newEntry
                }
            }
        }

        val result = JSONObject()
        val arr = JSONArray()
        localMap.values.forEach { arr.put(it) }
        result.put("sessions", arr)
        result.put("remoteAvailable", remote != null)
        return result.toString()
    }

    fun downloadSession(id: String, url: String): Boolean {
        return try {
            downloadProgress[id] = 0
            val conn = followRedirects(url)
            val totalBytes = conn.contentLength.toLong()

            val tempFile = File(sessionsDir, "$id.zip.tmp")
            val input = BufferedInputStream(conn.inputStream)
            val output = FileOutputStream(tempFile)

            val buffer = ByteArray(8192)
            var bytesRead: Long = 0
            var n: Int

            while (input.read(buffer).also { n = it } != -1) {
                output.write(buffer, 0, n)
                bytesRead += n
                if (totalBytes > 0) {
                    downloadProgress[id] = ((bytesRead * 100) / totalBytes).toInt()
                }
            }

            output.close()
            input.close()
            conn.disconnect()

            val sessionDir = File(sessionsDir, id)
            sessionDir.mkdirs()
            extractZip(tempFile, sessionDir)
            tempFile.delete()

            updateLocalManifest(id)
            downloadProgress[id] = 100
            true
        } catch (e: Exception) {
            downloadProgress.remove(id)
            false
        }
    }

    fun getDownloadProgress(id: String): Int = downloadProgress[id] ?: -1

    fun deleteSession(id: String): Boolean {
        val dir = File(sessionsDir, id)
        if (dir.exists()) {
            dir.deleteRecursively()
        }
        removeFromLocalManifest(id)
        return true
    }

    fun isSessionDownloaded(id: String): Boolean {
        val dataDir = File(sessionsDir, "$id/data")
        return dataDir.exists() && (dataDir.listFiles()?.isNotEmpty() == true)
    }

    fun getStorageInfo(): JSONObject {
        val total = sessionsDir.totalSpace
        val free = sessionsDir.freeSpace
        val used = totalDirSize(sessionsDir)
        return JSONObject()
            .put("totalDevice", total)
            .put("freeDevice", free)
            .put("usedBySessions", used)
    }

    private fun getLocalManifest(): JSONObject {
        return try {
            JSONObject(localManifestFile.readText())
        } catch (e: Exception) {
            JSONObject().put("sessions", JSONArray())
        }
    }

    private fun getRemoteManifest(): JSONObject? {
        return try {
            JSONObject(fetchWithRedirects(MANIFEST_URL))
        } catch (e: Exception) {
            null
        }
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
            conn.readTimeout = 10000
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

    private fun updateLocalManifest(id: String) {
        val manifest = getLocalManifest()
        val arr = manifest.optJSONArray("sessions") ?: JSONArray()

        val remote = getRemoteManifest()
        var remoteEntry: JSONObject? = null
        if (remote != null) {
            val remoteArr = remote.optJSONArray("sessions") ?: JSONArray()
            for (i in 0 until remoteArr.length()) {
                val rs = remoteArr.getJSONObject(i)
                if (rs.getString("id") == id) { remoteEntry = rs; break }
            }
        }

        var found = false
        for (i in 0 until arr.length()) {
            val s = arr.getJSONObject(i)
            if (s.getString("id") == id) {
                s.put("downloaded", true)
                s.put("version", s.optInt("remoteVersion", s.optInt("version", 0) + 1))
                s.put("hasUpdate", false)
                if (remoteEntry != null) {
                    s.put("title", remoteEntry.optString("title", id))
                    s.put("subtitle", remoteEntry.optString("subtitle", ""))
                    s.put("programme", remoteEntry.optString("programme", "kreis"))
                    s.put("num", remoteEntry.optInt("num", 0))
                    s.put("durationMin", remoteEntry.optInt("durationMin", 60))
                }
                found = true
                break
            }
        }
        if (!found) {
            val entry = JSONObject()
            entry.put("id", id)
            entry.put("downloaded", true)
            entry.put("version", remoteEntry?.optInt("version", 1) ?: 1)
            entry.put("title", remoteEntry?.optString("title", id) ?: id)
            entry.put("subtitle", remoteEntry?.optString("subtitle", "") ?: "")
            entry.put("programme", remoteEntry?.optString("programme", "kreis") ?: "kreis")
            entry.put("num", remoteEntry?.optInt("num", 0) ?: 0)
            entry.put("durationMin", remoteEntry?.optInt("durationMin", 60) ?: 60)
            arr.put(entry)
        }
        manifest.put("sessions", arr)
        localManifestFile.writeText(manifest.toString(2))
    }

    private fun removeFromLocalManifest(id: String) {
        val manifest = getLocalManifest()
        val arr = manifest.optJSONArray("sessions") ?: JSONArray()
        val newArr = JSONArray()
        for (i in 0 until arr.length()) {
            val s = arr.getJSONObject(i)
            if (s.getString("id") != id) newArr.put(s)
        }
        manifest.put("sessions", newArr)
        localManifestFile.writeText(manifest.toString(2))
    }

    private fun extractZip(zipFile: File, destDir: File) {
        val zis = ZipInputStream(zipFile.inputStream().buffered())
        var entry = zis.nextEntry
        while (entry != null) {
            val outFile = File(destDir, entry.name)
            if (entry.isDirectory) {
                outFile.mkdirs()
            } else {
                outFile.parentFile?.mkdirs()
                FileOutputStream(outFile).use { fos ->
                    zis.copyTo(fos)
                }
            }
            zis.closeEntry()
            entry = zis.nextEntry
        }
        zis.close()
    }

    private fun totalDirSize(dir: File): Long {
        var size = 0L
        dir.walkTopDown().forEach { if (it.isFile) size += it.length() }
        return size
    }
}
