package expo.modules.songstream

import android.net.Uri
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.io.RandomAccessFile
import java.net.HttpURLConnection
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.MalformedURLException
import java.net.ServerSocket
import java.net.Socket
import java.net.URL
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.thread
import kotlin.concurrent.withLock

/**
 * A bucket song played from one download of it (`src/ports/songStream.ts`).
 *
 * The player asks for a song in ranges — a first look, the range after it, one
 * per seek — and every range it sent to the doorman was a read of the bucket,
 * which counts each against a daily allowance. So the player is handed
 * `http://127.0.0.1:<port>/<name>` instead, and this answers it: the first
 * request for a song starts one download of the whole file into `<name>.part`
 * in the played-songs folder, and every range is read from that file as it
 * arrives. Once all there it is renamed to `<name>` and JavaScript is told,
 * which keeps it under the played-songs budget. A range that starts well past
 * what has arrived is asked of the doorman by itself — one read more, rather
 * than a long wait — as the desktop shell (apps/desktop/src/main/stream.ts)
 * and a tab's service worker do.
 *
 * The iPhone's twin is ios/SongStreamModule.swift, and the two answer alike.
 * A loopback server rather than a cache inside the player: Media3 could cache
 * by itself, but only by changing react-native-track-player's own code, and
 * every player can ask an address for ranges. The app allows cleartext HTTP
 * (plugins/withCleartextTraffic), which this address is.
 */
class SongStreamModule : Module() {
  private val emit: (String, Long) -> Unit = { name, bytes ->
    sendEvent("onArrived", mapOf("name" to name, "bytes" to bytes))
  }

  override fun definition() = ModuleDefinition {
    Name("SongStream")

    Events("onArrived")

    OnCreate { SongProxy.onArrived = emit }

    OnDestroy { if (SongProxy.onArrived === emit) SongProxy.onArrived = null }

    /** Where the player is to ask for the song, or null when nothing can listen. */
    Function("address") { name: String, url: String, headers: Map<String, String>, directory: String ->
      SongProxy.address(name, url, headers, directory)
    }

    /** The whole song in the folder, joining a download already under way: its size, or null when it did not arrive. */
    AsyncFunction("fetch") { name: String, url: String, headers: Map<String, String>, directory: String, promise: Promise ->
      SongProxy.fetch(name, url, headers, directory) { promise.resolve(it) }
    }

    /**
     * The download of that song under way stopped and what came of it deleted,
     * whoever was waiting on it told it did not arrive: the song fetched ahead
     * when the queue moved past it, or one that would not play.
     */
    Function("cancel") { name: String -> SongProxy.cancel(name) }

    /**
     * Every download under way stopped, and every song named so far forgotten:
     * the folder is being emptied, often on signing out, and an address the
     * player still holds must not go on relaying with the bearer it was named with.
     */
    Function("stopAll") { SongProxy.stopAll() }
  }
}

/** How far past what has arrived a range may start and still wait for it: `WAIT_AHEAD_BYTES` in packages/shared/src/doormanWire.ts. */
private const val WAIT_AHEAD_BYTES = 2L * 1024 * 1024
/** How much of a song one read from the disk hands the player. */
private const val READ_CHUNK = 256 * 1024
/** The most of a range asked of the doorman by itself that is kept for the ranges inside it. */
private const val KEEP_RELAYED = 1024 * 1024
/** A file named by the hash of its bytes, as the bucket names songs: right for as long as it is kept. */
private val hashName = Regex("^[0-9a-f]{64}\\.[a-z0-9]{1,5}$")
private const val UNREACHABLE = "This song is not on this device, and your storage cannot be reached."

private class Source(val url: URL, val headers: Map<String, String>, val directory: File)

private object SongProxy {
  @Volatile var onArrived: ((String, Long) -> Unit)? = null

  private val lock = Any()
  /** Where each song named so far comes from: the address the player holds names only the file. */
  private val sources = HashMap<String, Source>()
  private val arrivals = HashMap<String, Arrival>()
  private var listener: ServerSocket? = null
  /** Kept across a restart of the listener, so the addresses the player holds still answer. */
  private var port = 0

  fun address(name: String, url: String, headers: Map<String, String>, directory: String): String? {
    if (register(name, url, headers, directory) == null) return null
    val port = listening() ?: return null
    return "http://127.0.0.1:$port/$name"
  }

  fun fetch(name: String, url: String, headers: Map<String, String>, directory: String, done: (Long?) -> Unit) {
    val source = register(name, url, headers, directory) ?: return done(null)
    val arrival = arrival(name, source) ?: return done(fileSize(File(source.directory, name)))
    arrival.whenSettled(done)
  }

  fun cancel(name: String) {
    // Left in `arrivals` until it settles, so a request meanwhile hears it end
    // rather than starting a second download into the same `.part`.
    synchronized(lock) { arrivals[name] }?.cancel()
  }

  fun stopAll() {
    val stopping = synchronized(lock) {
      sources.clear()
      arrivals.values.toList().also { arrivals.clear() }
    }
    stopping.forEach { it.cancel() }
  }

  private fun register(name: String, url: String, headers: Map<String, String>, directory: String): Source? {
    if (!hashName.matches(name)) return null
    val remote = try {
      URL(url)
    } catch (e: MalformedURLException) {
      return null
    }
    val folder = if (directory.startsWith("file:")) Uri.parse(directory).path?.let(::File) else File(directory)
    if (folder == null) return null
    val source = Source(remote, headers, folder)
    synchronized(lock) { sources[name] = source }
    return source
  }

  /** The download of `name` under way, started if need be — or null when the whole file is here already. */
  private fun arrival(name: String, source: Source): Arrival? = synchronized(lock) {
    arrivals[name]?.let { return it }
    if (fileSize(File(source.directory, name)) != null) return null
    val started = Arrival(name, source) { settled, bytes ->
      synchronized(lock) { if (arrivals[name] === settled) arrivals.remove(name) }
      if (bytes != null) onArrived?.invoke(name, bytes)
    }
    arrivals[name] = started
    started
  }

  // Listening

  private fun listening(): Int? = synchronized(lock) {
    if (listener != null) return port
    // The same port first: a song paused and resumed after the socket was lost is still at its old address.
    val socket = (if (port != 0) bindLoopback(port) else null) ?: bindLoopback(0) ?: return null
    listener = socket
    port = socket.localPort
    thread(name = "SongStream", isDaemon = true) { accepting(socket) }
    port
  }

  private fun accepting(socket: ServerSocket) {
    while (true) {
      val client = try {
        socket.accept()
      } catch (e: IOException) {
        // Closed under us: listen again.
        val current = synchronized(lock) {
          if (listener !== socket) return@synchronized false
          listener = null
          true
        }
        closeQuietly(socket)
        if (current) listening()
        return
      }
      client.soTimeout = 30_000
      thread(isDaemon = true) {
        try {
          serve(client)
        } catch (e: IOException) {
          // The player hung up mid-song.
        } finally {
          closeQuietly(client)
        }
      }
    }
  }

  // Answering

  private fun serve(client: Socket) {
    val out = client.getOutputStream()
    val request = readRequest(client.getInputStream()) ?: return
    if (request.method != "GET" && request.method != "HEAD") {
      return respond(out, 405, mapOf("Allow" to "GET, HEAD"), ByteArray(0))
    }
    val name = request.path.drop(1).substringBefore('?')
    val source = synchronized(lock) { sources[name] }
      ?: return respond(out, 404, emptyMap(), "not found".toByteArray())
    val whole = File(source.directory, name)
    val range = request.headers["range"]
    fileSize(whole)?.let { return fromFile(out, whole, it, range, name, request.method == "HEAD") }
    if (request.method == "HEAD") {
      Relay.run(out, source, "HEAD", range)
      return
    }
    val arrival = arrival(name, source) ?: run {
      // Arrived whole between the two looks.
      val size = fileSize(whole) ?: return respond(out, 503, emptyMap(), ByteArray(0))
      return fromFile(out, whole, size, range, name, false)
    }
    when (val head = arrival.waitForHead()) {
      is Head.Refused -> respond(out, head.status, mapOf("Content-Type" to head.type), head.body)
      is Head.Ok -> when (val wanted = parseRange(range, head.size)) {
        Wanted.Unsatisfiable -> respond(out, 416, mapOf("Content-Range" to "bytes */${head.size}"), ByteArray(0))
        Wanted.Whole -> arrival.stream(out, 0, head.size - 1, head.size, head.type, partial = false)
        is Wanted.Bytes -> {
          val (start, end) = wanted
          if (start > arrival.arrived + WAIT_AHEAD_BYTES) {
            // A player's look at the end of a file whose index is there asks
            // two or three times, each inside the first: answered from what
            // that one brought.
            val kept = arrival.relayed(start, end)
            if (kept != null) {
              return respond(out, 206, mapOf(
                "Content-Type" to head.type,
                "Content-Range" to "bytes $start-$end/${head.size}",
                "Accept-Ranges" to "bytes",
              ), kept)
            }
            val mine = arrival.relaying(start, end)
            val brought = Relay.run(out, source, "GET", range)
            if (mine) arrival.relayed(brought)
          } else {
            arrival.stream(out, start, end, head.size, head.type, partial = true)
          }
        }
      }
    }
  }

  private fun fromFile(out: OutputStream, path: File, size: Long, range: String?, name: String, head: Boolean) {
    val type = contentType(name)
    var start = 0L
    var end = size - 1
    val headers = linkedMapOf("Content-Type" to type, "Accept-Ranges" to "bytes")
    var status = 200
    when (val wanted = parseRange(range, size)) {
      Wanted.Unsatisfiable -> return respond(out, 416, mapOf("Content-Range" to "bytes */$size"), ByteArray(0))
      Wanted.Whole -> {}
      is Wanted.Bytes -> {
        start = wanted.start
        end = wanted.end
        status = 206
        headers["Content-Range"] = "bytes $start-$end/$size"
      }
    }
    headers["Content-Length"] = (end - start + 1).toString()
    if (!writeHead(out, status, headers) || head) return
    val reader = openReader(path) ?: return
    reader.use {
      val buffer = ByteArray(READ_CHUNK)
      var at = start
      while (at <= end) {
        reader.seek(at)
        val count = reader.read(buffer, 0, minOf(READ_CHUNK.toLong(), end + 1 - at).toInt())
        if (count <= 0 || !sendAll(out, buffer, count)) return
        at += count
      }
    }
  }
}

// One song arriving

private sealed class Head {
  class Ok(val size: Long, val type: String) : Head()
  class Refused(val status: Int, val type: String, val body: ByteArray) : Head()
}

/** A range asked of the doorman by itself: where it starts, and its bytes. */
private class Kept(val start: Long, val bytes: ByteArray)

/**
 * One song arriving from the doorman, whole, into `<name>.part`, and readable
 * from anywhere in it while it does. Renamed to its name once all there: a
 * file under its real name is a whole song.
 */
private class Arrival(
  private val name: String,
  source: Source,
  private val settled: (Arrival, Long?) -> Unit,
) {
  private val part = File(source.directory, "$name.part")
  private val whole = File(source.directory, name)
  private val lock = ReentrantLock()
  private val changed = lock.newCondition()
  private var head: Head? = null
  private var received = 0L
  private var size = 0L
  private var over = false
  private var bytes: Long? = null
  private val waiting = mutableListOf<(Long?) -> Unit>()
  /** A range asked of the doorman by itself, kept while the song arrives. */
  private var aside: Kept? = null
  /** The range being asked of the doorman now, which the ranges inside it wait for. */
  private var asking: Pair<Long, Long>? = null
  @Volatile private var cancelled = false
  @Volatile private var connection: HttpURLConnection? = null

  init {
    thread(name = "SongStream $name", isDaemon = true) { download(source) }
  }

  /** Bytes on the disk so far. */
  val arrived: Long
    get() = lock.withLock { received }

  fun cancel() {
    cancelled = true
    connection?.disconnect()
  }

  fun whenSettled(done: (Long?) -> Unit) {
    val result = lock.withLock {
      if (!over) {
        waiting.add(done)
        return
      }
      bytes
    }
    done(result)
  }

  /** Whether this range is now the one being asked of the doorman: false while another is. */
  fun relaying(start: Long, end: Long): Boolean = lock.withLock {
    if (asking != null) return false
    asking = start to end
    true
  }

  /** What the range being asked brought, if it was small enough to keep; the ranges waiting on it are woken. */
  fun relayed(kept: Kept?) = lock.withLock {
    if (kept != null) aside = kept
    asking = null
    changed.signalAll()
  }

  /** Bytes `start` to `end` out of the range kept aside, when it holds them all — waiting first for a range being asked that would hold them. */
  fun relayed(start: Long, end: Long): ByteArray? = lock.withLock {
    while (true) {
      val (from, to) = asking ?: break
      if (start < from || end > to) break
      changed.await()
    }
    val kept = aside ?: return null
    if (start < kept.start || end >= kept.start + kept.bytes.size) return null
    val from = (start - kept.start).toInt()
    kept.bytes.copyOfRange(from, from + (end - start + 1).toInt())
  }

  fun waitForHead(): Head = lock.withLock {
    while (head == null) changed.await()
    head!!
  }

  /** Bytes `start` to `end`, inclusive, written to the player as they arrive. */
  fun stream(out: OutputStream, start: Long, end: Long, size: Long, type: String, partial: Boolean) {
    val headers = linkedMapOf(
      "Content-Type" to type,
      "Content-Length" to (end - start + 1).toString(),
      "Accept-Ranges" to "bytes",
    )
    if (partial) headers["Content-Range"] = "bytes $start-$end/$size"
    if (!writeHead(out, if (partial) 206 else 200, headers)) return
    val reader = openReader(part) ?: openReader(whole) ?: return
    reader.use {
      val buffer = ByteArray(READ_CHUNK)
      var at = start
      while (at <= end) {
        val available = lock.withLock {
          while (received <= at && !over) changed.await()
          received
        }
        // Stopped short: the player sees the song end early and asks again.
        if (available <= at) return
        reader.seek(at)
        val count = reader.read(buffer, 0, minOf(READ_CHUNK.toLong(), end + 1 - at, available - at).toInt())
        if (count <= 0 || !sendAll(out, buffer, count)) return
        at += count
      }
    }
  }

  private fun open(next: Head) = lock.withLock {
    head = next
    changed.signalAll()
  }

  private fun download(source: Source) {
    var failed = false
    var writer: FileOutputStream? = null
    var refusal = Head.Refused(502, "text/plain", ByteArray(0))
    try {
      val connection = request(source, "GET", null)
      this.connection = connection
      if (cancelled) throw IOException("stopped")
      val status = connection.responseCode
      val length = connection.contentLengthLong
      val type = connection.contentType ?: contentType(name)
      if (status != 200 || length <= 0) {
        // The doorman's refusal, read whole so each request waiting on it hears it: a cap's 502, a 401.
        val code = if (status == 200 || status <= 0) 502 else status
        refusal = Head.Refused(code, type, ByteArray(0))
        val stream = if (status >= 400) connection.errorStream else connection.inputStream
        refusal = Head.Refused(code, type, stream?.use { readUpTo(it, 64 * 1024) } ?: ByteArray(0))
      } else {
        try {
          part.parentFile?.mkdirs()
          part.delete()
          writer = FileOutputStream(part)
        } catch (e: IOException) {
          refusal = Head.Refused(503, "text/plain", "There is no room for the song on this device.".toByteArray())
          throw e
        }
        lock.withLock { size = length }
        open(Head.Ok(length, type))
        connection.inputStream.use { input ->
          val chunk = ByteArray(64 * 1024)
          while (true) {
            val count = input.read(chunk)
            if (count < 0) break
            if (cancelled) throw IOException("stopped")
            writer.write(chunk, 0, count)
            lock.withLock {
              received += count
              changed.signalAll()
            }
          }
        }
      }
    } catch (e: IOException) {
      failed = true
    } finally {
      connection?.disconnect()
    }

    var result: Long? = null
    if (writer != null) {
      try {
        writer.close()
      } catch (e: IOException) {
        failed = true
      }
      if (!failed && received == size) {
        whole.delete()
        if (part.renameTo(whole)) result = size
      }
      if (result == null) part.delete()
    } else if (lock.withLock { head == null }) {
      if (failed && refusal.body.isEmpty() && refusal.status == 502) {
        refusal = Head.Refused(503, "text/plain", UNREACHABLE.toByteArray())
      }
      open(refusal)
    }
    val callbacks = lock.withLock {
      over = true
      bytes = result
      changed.signalAll()
      waiting.toList().also { waiting.clear() }
    }
    callbacks.forEach { it(result) }
    settled(this, result)
  }
}

// A range asked of the doorman by itself

/** The doorman's answer to this very request, passed on: a HEAD, or a far seek. */
private object Relay {
  /** The range as it came, kept when it was a whole range of at most a mebibyte. */
  fun run(out: OutputStream, source: Source, method: String, range: String?): Kept? {
    var answered = false
    var start: Long? = null
    val body = ByteArrayOutputStream()
    var connection: HttpURLConnection? = null
    try {
      connection = request(source, method, range)
      val status = connection.responseCode
      val headers = linkedMapOf<String, String>()
      for (field in listOf("Content-Type", "Content-Length", "Content-Range", "Accept-Ranges")) {
        connection.getHeaderField(field)?.let { headers[field] = it }
      }
      answered = true
      // `bytes 3031040-3074842/3074843`: where the range starts, to keep it by.
      if (status == 206) {
        start = connection.getHeaderField("Content-Range")
          ?.split(" ")?.lastOrNull()?.split("-")?.firstOrNull()?.toLongOrNull()
      }
      if (!writeHead(out, if (status > 0) status else 502, headers)) return null
      val stream = if (method == "HEAD") null else if (status >= 400) connection.errorStream else connection.inputStream
      stream?.use { input ->
        val chunk = ByteArray(64 * 1024)
        while (true) {
          val count = input.read(chunk)
          if (count < 0) break
          if (!sendAll(out, chunk, count)) return null
          if (start != null && body.size() + count <= KEEP_RELAYED) body.write(chunk, 0, count) else start = null
        }
      }
    } catch (e: IOException) {
      if (!answered) respond(out, 503, mapOf("Content-Type" to "text/plain"), UNREACHABLE.toByteArray())
      return null
    } finally {
      connection?.disconnect()
    }
    val from = start ?: return null
    return if (body.size() > 0) Kept(from, body.toByteArray()) else null
  }
}

private fun request(source: Source, method: String, range: String?): HttpURLConnection =
  (source.url.openConnection() as HttpURLConnection).apply {
    requestMethod = method
    // The song goes to the folder, not to a second copy in a cache.
    useCaches = false
    connectTimeout = 60_000
    readTimeout = 60_000
    // The bytes as stored: a compressed answer would hide the song's length.
    setRequestProperty("Accept-Encoding", "identity")
    for ((field, value) in source.headers) setRequestProperty(field, value)
    if (range != null) setRequestProperty("Range", range)
  }

// HTTP, as little of it as a player needs

private class Request(
  val method: String,
  val path: String,
  /** Lowercased names. */
  val headers: Map<String, String>,
)

private fun readRequest(input: InputStream): Request? {
  val buffer = ByteArrayOutputStream()
  val chunk = ByteArray(4096)
  var text = ""
  while (!text.contains("\r\n\r\n")) {
    val count = input.read(chunk)
    if (count <= 0 || buffer.size() > 32 * 1024) return null
    buffer.write(chunk, 0, count)
    text = buffer.toString(Charsets.UTF_8.name())
  }
  val lines = text.split("\r\n")
  val first = lines[0].split(" ").filter { it.isNotEmpty() }
  if (first.size < 2) return null
  val headers = HashMap<String, String>()
  for (line in lines.drop(1)) {
    val colon = line.indexOf(':')
    if (colon < 0) continue
    headers[line.substring(0, colon).trim().lowercase()] = line.substring(colon + 1).trim()
  }
  return Request(first[0], first[1], headers)
}

private sealed class Wanted {
  object Whole : Wanted()
  object Unsatisfiable : Wanted()
  data class Bytes(val start: Long, val end: Long) : Wanted()
}

/** `parseRange` in packages/shared/src/range.ts, for one range: a player never asks for more. */
private fun parseRange(header: String?, size: Long): Wanted {
  val value = header?.trim()
  if (value == null || !value.startsWith("bytes=")) return Wanted.Whole
  val parts = value.removePrefix("bytes=").split("-", limit = 2)
  if (parts.size != 2) return Wanted.Whole
  val rawStart = parts[0].trim()
  val rawEnd = parts[1].trim()
  if (rawStart.isEmpty() && rawEnd.isEmpty()) return Wanted.Whole
  if (rawStart.isEmpty()) {
    val suffix = rawEnd.toLongOrNull()
    if (suffix == null || suffix <= 0) return Wanted.Unsatisfiable
    return Wanted.Bytes(maxOf(0, size - suffix), size - 1)
  }
  val start = rawStart.toLongOrNull() ?: return Wanted.Whole
  val end = if (rawEnd.isEmpty()) size - 1 else rawEnd.toLongOrNull() ?: (size - 1)
  if (start >= size || start > end) return Wanted.Unsatisfiable
  return Wanted.Bytes(start, minOf(end, size - 1))
}

private val reasons = mapOf(
  200 to "OK", 206 to "Partial Content", 401 to "Unauthorized", 403 to "Forbidden", 404 to "Not Found",
  405 to "Method Not Allowed", 416 to "Range Not Satisfiable", 429 to "Too Many Requests",
  502 to "Bad Gateway", 503 to "Service Unavailable",
)

private fun writeHead(out: OutputStream, status: Int, headers: Map<String, String>): Boolean {
  val head = StringBuilder("HTTP/1.1 $status ${reasons[status] ?: "Status"}\r\n")
  for ((field, value) in headers) head.append("$field: $value\r\n")
  head.append("Cache-Control: no-store\r\nConnection: close\r\n\r\n")
  val bytes = head.toString().toByteArray()
  return sendAll(out, bytes, bytes.size)
}

private fun respond(out: OutputStream, status: Int, headers: Map<String, String>, body: ByteArray) {
  val all = headers + ("Content-Length" to body.size.toString())
  if (writeHead(out, status, all) && body.isNotEmpty()) sendAll(out, body, body.size)
}

private fun sendAll(out: OutputStream, data: ByteArray, count: Int): Boolean = try {
  out.write(data, 0, count)
  out.flush()
  true
} catch (e: IOException) {
  false
}

private fun readUpTo(input: InputStream, limit: Int): ByteArray {
  val body = ByteArrayOutputStream()
  val chunk = ByteArray(4096)
  while (body.size() < limit) {
    val count = input.read(chunk)
    if (count < 0) break
    body.write(chunk, 0, minOf(count, limit - body.size()))
  }
  return body.toByteArray()
}

private fun bindLoopback(port: Int): ServerSocket? {
  val socket = ServerSocket()
  return try {
    socket.reuseAddress = true
    socket.bind(InetSocketAddress(InetAddress.getByAddress(byteArrayOf(127, 0, 0, 1)), port), 16)
    socket
  } catch (e: IOException) {
    closeQuietly(socket)
    null
  }
}

private fun openReader(file: File): RandomAccessFile? = try {
  RandomAccessFile(file, "r")
} catch (e: IOException) {
  null
}

private fun closeQuietly(closeable: java.io.Closeable) {
  try {
    closeable.close()
  } catch (e: IOException) {
  }
}

private fun fileSize(file: File): Long? = if (file.isFile) file.length() else null

private fun contentType(name: String): String = when (name.substringAfterLast('.', "").lowercase()) {
  "mp3" -> "audio/mpeg"
  "m4a", "mp4", "aac" -> "audio/mp4"
  "flac" -> "audio/flac"
  "wav" -> "audio/wav"
  "ogg", "opus" -> "audio/ogg"
  "webm" -> "audio/webm"
  else -> "application/octet-stream"
}
