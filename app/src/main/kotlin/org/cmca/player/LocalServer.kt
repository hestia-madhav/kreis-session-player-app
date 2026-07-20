package org.cmca.player

import android.content.Context
import android.content.res.AssetManager
import fi.iki.elonen.NanoHTTPD
import java.io.File
import java.io.FileInputStream
import java.io.IOException
import java.io.InputStream

class LocalServer(
    private val context: Context,
    private val sessionsDir: File
) : NanoHTTPD(0) {

    private val assets: AssetManager = context.assets

    private val mimeTypes = mapOf(
        "html" to "text/html",
        "css" to "text/css",
        "js" to "application/javascript",
        "json" to "application/json",
        "png" to "image/png",
        "jpg" to "image/jpeg",
        "jpeg" to "image/jpeg",
        "gif" to "image/gif",
        "svg" to "image/svg+xml",
        "webp" to "image/webp",
        "mp4" to "video/mp4",
        "webm" to "video/webm",
        "mp3" to "audio/mpeg",
        "ogg" to "audio/ogg",
        "wav" to "audio/wav",
        "woff2" to "font/woff2",
        "woff" to "font/woff",
        "ttf" to "font/ttf"
    )

    override fun serve(session: IHTTPSession): Response {
        val uri = session.uri.trimStart('/')

        return when {
            uri.isEmpty() || uri == "player" || uri == "player/" ->
                serveAsset("player/index.html", session)
            uri.startsWith("player/sessions/") ->
                serveSessionFile(uri.removePrefix("player/sessions/"), session)
            uri.startsWith("player/") ->
                serveAsset(uri, session)
            uri.startsWith("sessions/") ->
                serveSessionFile(uri.removePrefix("sessions/"), session)
            else ->
                newFixedLengthResponse(Response.Status.NOT_FOUND, MIME_PLAINTEXT, "Not found")
        }
    }

    private fun serveSessionFile(relativePath: String, session: IHTTPSession): Response {
        val direct = File(sessionsDir, relativePath)
        if (direct.exists() && direct.isFile) {
            return serveFile(direct, session)
        }
        // Asset paths in session data are like "assets/file.mp3" but files live
        // under "<session-id>/assets/file.mp3". Search session subdirectories.
        sessionsDir.listFiles()?.filter { it.isDirectory }?.forEach { subDir ->
            val candidate = File(subDir, relativePath)
            if (candidate.exists() && candidate.isFile) {
                return serveFile(candidate, session)
            }
        }
        return newFixedLengthResponse(Response.Status.NOT_FOUND, MIME_PLAINTEXT, "File not found: $relativePath")
    }

    private fun serveAsset(path: String, session: IHTTPSession): Response {
        return try {
            val input = assets.open(path)
            val mime = getMime(path)
            val bytes = input.readBytes()
            input.close()
            newFixedLengthResponse(Response.Status.OK, mime, bytes.inputStream(), bytes.size.toLong())
        } catch (e: IOException) {
            newFixedLengthResponse(Response.Status.NOT_FOUND, MIME_PLAINTEXT, "Asset not found: $path")
        }
    }

    private fun serveFile(file: File, session: IHTTPSession): Response {
        if (!file.exists() || !file.isFile) {
            return newFixedLengthResponse(Response.Status.NOT_FOUND, MIME_PLAINTEXT, "File not found")
        }

        val mime = getMime(file.name)
        val fileLen = file.length()
        val rangeHeader = session.headers["range"]

        if (rangeHeader != null && rangeHeader.startsWith("bytes=")) {
            return servePartial(file, fileLen, rangeHeader, mime)
        }

        val fis = FileInputStream(file)
        return newFixedLengthResponse(Response.Status.OK, mime, fis, fileLen)
    }

    private fun servePartial(file: File, fileLen: Long, rangeHeader: String, mime: String): Response {
        val rangeSpec = rangeHeader.removePrefix("bytes=").trim()
        val parts = rangeSpec.split("-", limit = 2)
        val start = parts[0].toLongOrNull() ?: 0L
        val end = if (parts.size > 1 && parts[1].isNotEmpty()) {
            parts[1].toLongOrNull() ?: (fileLen - 1)
        } else {
            fileLen - 1
        }

        val contentLen = end - start + 1
        val fis = FileInputStream(file)
        fis.skip(start)

        val response = newFixedLengthResponse(
            Response.Status.PARTIAL_CONTENT, mime, fis, contentLen
        )
        response.addHeader("Content-Range", "bytes $start-$end/$fileLen")
        response.addHeader("Accept-Ranges", "bytes")
        response.addHeader("Content-Length", contentLen.toString())
        return response
    }

    private fun getMime(path: String): String {
        val ext = path.substringAfterLast('.', "").lowercase()
        return mimeTypes[ext] ?: "application/octet-stream"
    }
}
