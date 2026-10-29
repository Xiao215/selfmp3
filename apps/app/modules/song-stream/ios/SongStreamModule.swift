import ExpoModulesCore
import Foundation

/// A bucket song played from one download of it (`src/ports/songStream.ts`).
///
/// The player asks for a song in ranges — a two-byte first look, the range
/// after it, one per seek — and every range it sent to the doorman was a read
/// of the bucket, which counts each against a daily allowance. So the player
/// is handed `http://127.0.0.1:<port>/<name>` instead, and this answers it: the
/// first request for a song starts one download of the whole file into
/// `<name>.part` in the played-songs folder, and every range is read from that
/// file as it arrives. Once all there it is renamed to `<name>` and JavaScript
/// is told, which keeps it under the played-songs budget. A range that starts
/// well past what has arrived is asked of the doorman by itself — one read
/// more, rather than a long wait — as the desktop shell
/// (apps/desktop/src/main/stream.ts) and a tab's service worker do.
///
/// A loopback server rather than a file the player reads as it grows: AVPlayer
/// takes a file's length when it opens it and ends the song there, and a
/// resource-loader delegate would mean changing the player's own code. Every
/// player can ask an address for ranges.
public class SongStreamModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SongStream")

    Events("onArrived")

    OnCreate {
      SongProxy.shared.onArrived = { [weak self] name, bytes in
        self?.sendEvent("onArrived", ["name": name, "bytes": bytes] as [String: Any])
      }
    }

    /// Where the player is to ask for the song, or nil when nothing can listen.
    Function("address") {
      (name: String, url: String, headers: [String: String], directory: String) -> String? in
      SongProxy.shared.address(name: name, url: url, headers: headers, directory: directory)
    }

    /// The whole song in the folder, joining a download already under way:
    /// its size, or nil when it did not arrive.
    AsyncFunction("fetch") {
      (name: String, url: String, headers: [String: String], directory: String, promise: Promise) in
      SongProxy.shared.fetch(name: name, url: url, headers: headers, directory: directory) {
        promise.resolve($0)
      }
    }

    /// The download of that song under way stopped and what came of it
    /// deleted, whoever was waiting on it told it did not arrive: the song
    /// fetched ahead when the queue moved past it, or one that would not play.
    Function("cancel") { (name: String) in
      SongProxy.shared.cancel(name: name)
    }

    /// Every download under way stopped, and every song named so far
    /// forgotten: the folder is being emptied, often on signing out, and an
    /// address the player still holds must not go on relaying with the bearer
    /// it was named with.
    Function("stopAll") {
      SongProxy.shared.stopAll()
    }
  }
}

/// How far past what has arrived a range may start and still wait for it:
/// `WAIT_AHEAD_BYTES` in packages/shared/src/doormanWire.ts.
private let waitAheadBytes = 2 * 1024 * 1024
/// How much of a song one read from the disk hands the player.
private let readChunk = 256 * 1024
/// A file named by the hash of its bytes, as the bucket names songs: right for as long as it is kept.
private let hashName = try! NSRegularExpression(pattern: "^[0-9a-f]{64}\\.[a-z0-9]{1,5}$")

private struct Source {
  let url: URL
  let headers: [String: String]
  let directory: URL
}

final class SongProxy {
  static let shared = SongProxy()

  var onArrived: ((String, Int) -> Void)?

  private let lock = NSLock()
  /// Where each song named so far comes from: the address the player holds names only the file.
  private var sources: [String: Source] = [:]
  private var arrivals: [String: Arrival] = [:]
  private var listener: Int32 = -1
  /// Kept across a restart of the listener, so the addresses the player holds still answer.
  private var port: UInt16 = 0

  func address(name: String, url: String, headers: [String: String], directory: String) -> String? {
    guard register(name: name, url: url, headers: headers, directory: directory) != nil,
      let port = listening()
    else { return nil }
    return "http://127.0.0.1:\(port)/\(name)"
  }

  func fetch(
    name: String, url: String, headers: [String: String], directory: String,
    done: @escaping (Int?) -> Void
  ) {
    guard let source = register(name: name, url: url, headers: headers, directory: directory) else {
      return done(nil)
    }
    guard let arrival = arrival(name: name, source: source) else {
      return done(fileSize(source.directory.appendingPathComponent(name)))
    }
    arrival.whenSettled(done)
  }

  func cancel(name: String) {
    // Left in `arrivals` until it settles, so a request meanwhile hears it end
    // rather than starting a second download into the same `.part`.
    lock.withLock { arrivals[name] }?.cancel()
  }

  func stopAll() {
    let stopping = lock.withLock { () -> [Arrival] in
      let all = Array(arrivals.values)
      arrivals.removeAll()
      sources.removeAll()
      return all
    }
    stopping.forEach { $0.cancel() }
  }

  private func register(
    name: String, url: String, headers: [String: String], directory: String
  ) -> Source? {
    let range = NSRange(name.startIndex..., in: name)
    guard hashName.firstMatch(in: name, range: range) != nil, let remote = URL(string: url) else {
      return nil
    }
    let folder = URL(string: directory).flatMap { $0.isFileURL ? $0 : nil }
      ?? URL(fileURLWithPath: directory)
    let source = Source(url: remote, headers: headers, directory: folder)
    lock.withLock { sources[name] = source }
    return source
  }

  /// The download of `name` under way, started if need be — or nil when the whole file is here already.
  private func arrival(name: String, source: Source) -> Arrival? {
    lock.withLock { () -> Arrival? in
      if let arriving = arrivals[name] { return arriving }
      if fileSize(source.directory.appendingPathComponent(name)) != nil { return nil }
      let started = Arrival(name: name, source: source) { [weak self] settled, bytes in
        guard let self else { return }
        self.lock.withLock {
          if self.arrivals[name] === settled { self.arrivals[name] = nil }
        }
        if let bytes { self.onArrived?(name, bytes) }
      }
      arrivals[name] = started
      return started
    }
  }

  // MARK: - Listening

  private func listening() -> UInt16? {
    lock.lock()
    defer { lock.unlock() }
    if listener >= 0 { return port }
    // The same port first: a song paused and resumed after the system took the socket back is still at its old address.
    guard let found = (port != 0 ? bindLoopback(port: port) : nil) ?? bindLoopback(port: 0)
    else { return nil }
    let (fd, bound) = found
    listener = fd
    port = bound
    Thread.detachNewThread { [weak self] in self?.accepting(fd) }
    return bound
  }

  private func accepting(_ fd: Int32) {
    while true {
      let client = accept(fd, nil, nil)
      if client < 0 {
        if errno == EINTR { continue }
        // Taken back by the system while the app was suspended, or closed: listen again.
        let current = lock.withLock { () -> Bool in
          guard listener == fd else { return false }
          listener = -1
          return true
        }
        close(fd)
        if current { _ = listening() }
        return
      }
      var on: Int32 = 1
      // A player that hangs up mid-song must not take the app down with it.
      setsockopt(client, SOL_SOCKET, SO_NOSIGPIPE, &on, socklen_t(MemoryLayout<Int32>.size))
      var wait = timeval(tv_sec: 30, tv_usec: 0)
      setsockopt(client, SOL_SOCKET, SO_RCVTIMEO, &wait, socklen_t(MemoryLayout<timeval>.size))
      Thread.detachNewThread { [weak self] in
        self?.serve(client)
        close(client)
      }
    }
  }

  // MARK: - Answering

  private func serve(_ client: Int32) {
    guard let request = readRequest(client) else { return }
    guard request.method == "GET" || request.method == "HEAD" else {
      return respond(client, status: 405, headers: ["Allow": "GET, HEAD"], body: Data())
    }
    let name = String(request.path.dropFirst().prefix { $0 != "?" })
    guard let source = lock.withLock({ sources[name] }) else {
      return respond(client, status: 404, headers: [:], body: Data("not found".utf8))
    }
    let whole = source.directory.appendingPathComponent(name)
    let range = request.headers["range"]
    if let size = fileSize(whole) {
      return fromFile(client, path: whole, size: size, range: range, name: name, head: request.method == "HEAD")
    }
    if request.method == "HEAD" {
      Relay.run(client, source: source, method: "HEAD", range: range)
      return
    }
    guard let arrival = arrival(name: name, source: source) else {
      // Arrived whole between the two looks.
      guard let size = fileSize(whole) else {
        return respond(client, status: 503, headers: [:], body: Data())
      }
      return fromFile(client, path: whole, size: size, range: range, name: name, head: false)
    }
    switch arrival.waitForHead() {
    case let .refused(status, type, body):
      respond(client, status: status, headers: ["Content-Type": type], body: body)
    case let .ok(size, type):
      switch parseRange(range, size: size) {
      case .unsatisfiable:
        respond(client, status: 416, headers: ["Content-Range": "bytes */\(size)"], body: Data())
      case .whole:
        arrival.stream(to: client, start: 0, end: size - 1, size: size, type: type, partial: false)
      case let .bytes(start, end):
        if start > arrival.arrived + waitAheadBytes {
          // A player's look at the end of a file whose index is there asks
          // two or three times, each inside the first: answered from what
          // that one brought.
          if let kept = arrival.relayed(start: start, end: end) {
            return respond(client, status: 206, headers: [
              "Content-Type": type,
              "Content-Range": "bytes \(start)-\(end)/\(size)",
              "Accept-Ranges": "bytes",
            ], body: kept)
          }
          let mine = arrival.relaying(start: start, end: end)
          let kept = Relay.run(client, source: source, method: "GET", range: range)
          if mine { arrival.relayed(kept) }
        } else {
          arrival.stream(to: client, start: start, end: end, size: size, type: type, partial: true)
        }
      }
    }
  }

  private func fromFile(
    _ client: Int32, path: URL, size: Int, range: String?, name: String, head: Bool
  ) {
    let type = contentType(for: name)
    var start = 0
    var end = size - 1
    var headers = ["Content-Type": type, "Accept-Ranges": "bytes"]
    var status = 200
    switch parseRange(range, size: size) {
    case .unsatisfiable:
      return respond(client, status: 416, headers: ["Content-Range": "bytes */\(size)"], body: Data())
    case .whole:
      break
    case let .bytes(from, to):
      start = from
      end = to
      status = 206
      headers["Content-Range"] = "bytes \(start)-\(end)/\(size)"
    }
    headers["Content-Length"] = String(end - start + 1)
    guard writeHead(client, status: status, headers: headers), !head,
      let reader = FileHandle(forReadingAtPath: path.path)
    else { return }
    defer { try? reader.close() }
    var at = start
    while at <= end {
      guard (try? reader.seek(toOffset: UInt64(at))) != nil,
        let data = try? reader.read(upToCount: min(readChunk, end + 1 - at)), !data.isEmpty,
        sendAll(client, data)
      else { return }
      at += data.count
    }
  }
}

// MARK: - One song arriving

private enum Head {
  case ok(size: Int, type: String)
  case refused(status: Int, type: String, body: Data)
}

/// One song arriving from the doorman, whole, into `<name>.part`, and readable
/// from anywhere in it while it does. Renamed to its name once all there: a
/// file under its real name is a whole song.
private final class Arrival: NSObject, URLSessionDataDelegate {
  private let name: String
  private let part: URL
  private let whole: URL
  private let condition = NSCondition()
  private var head: Head?
  private var received = 0
  private var size = 0
  private var over = false
  private var bytes: Int?
  private var waiting: [(Int?) -> Void] = []
  /// A range asked of the doorman by itself, kept while the song arrives: where it starts, and its bytes.
  private var aside: (start: Int, bytes: Data)?
  /// The range being asked of the doorman now, which the ranges inside it wait for.
  private var asking: (start: Int, end: Int)?
  private var writer: FileHandle?
  private var refusal: (status: Int, type: String, body: Data) = (502, "text/plain", Data())
  private var session: URLSession?
  private let settled: (Arrival, Int?) -> Void

  init(name: String, source: Source, settled: @escaping (Arrival, Int?) -> Void) {
    self.name = name
    self.part = source.directory.appendingPathComponent("\(name).part")
    self.whole = source.directory.appendingPathComponent(name)
    self.settled = settled
    super.init()
    let configuration = URLSessionConfiguration.ephemeral
    // The song goes to the folder, not to a second copy in a URL cache.
    configuration.urlCache = nil
    configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
    let queue = OperationQueue()
    queue.maxConcurrentOperationCount = 1
    let session = URLSession(configuration: configuration, delegate: self, delegateQueue: queue)
    self.session = session
    var request = URLRequest(url: source.url)
    for (field, value) in source.headers { request.setValue(value, forHTTPHeaderField: field) }
    session.dataTask(with: request).resume()
  }

  /// Bytes on the disk so far.
  var arrived: Int {
    condition.lock()
    defer { condition.unlock() }
    return received
  }

  func cancel() {
    session?.invalidateAndCancel()
  }

  func whenSettled(_ done: @escaping (Int?) -> Void) {
    condition.lock()
    if over {
      let result = bytes
      condition.unlock()
      return done(result)
    }
    waiting.append(done)
    condition.unlock()
  }

  /// Whether this range is now the one being asked of the doorman: false while another is.
  func relaying(start: Int, end: Int) -> Bool {
    condition.lock()
    defer { condition.unlock() }
    guard asking == nil else { return false }
    asking = (start, end)
    return true
  }

  /// What the range being asked brought, if it was small enough to keep; the ranges waiting on it are woken.
  func relayed(_ kept: (start: Int, bytes: Data)?) {
    condition.lock()
    if let kept { aside = kept }
    asking = nil
    condition.broadcast()
    condition.unlock()
  }

  /// Bytes `start` to `end` out of the range kept aside, when it holds them all —
  /// waiting first for a range being asked that would hold them.
  func relayed(start: Int, end: Int) -> Data? {
    condition.lock()
    defer { condition.unlock() }
    while let asking, start >= asking.start, end <= asking.end { condition.wait() }
    guard let aside, start >= aside.start, end < aside.start + aside.bytes.count else { return nil }
    let from = aside.bytes.startIndex + (start - aside.start)
    return aside.bytes.subdata(in: from..<(from + end - start + 1))
  }

  func waitForHead() -> Head {
    condition.lock()
    defer { condition.unlock() }
    while head == nil { condition.wait() }
    return head!
  }

  /// Bytes `start` to `end`, inclusive, written to the player as they arrive.
  func stream(to client: Int32, start: Int, end: Int, size: Int, type: String, partial: Bool) {
    var headers = [
      "Content-Type": type,
      "Content-Length": String(end - start + 1),
      "Accept-Ranges": "bytes",
    ]
    if partial { headers["Content-Range"] = "bytes \(start)-\(end)/\(size)" }
    guard writeHead(client, status: partial ? 206 : 200, headers: headers),
      let reader = FileHandle(forReadingAtPath: part.path) ?? FileHandle(forReadingAtPath: whole.path)
    else { return }
    defer { try? reader.close() }
    var at = start
    while at <= end {
      condition.lock()
      while received <= at && !over { condition.wait() }
      let available = received
      condition.unlock()
      // Stopped short: the player sees the song end early and asks again.
      if available <= at { return }
      guard (try? reader.seek(toOffset: UInt64(at))) != nil,
        let data = try? reader.read(upToCount: min(readChunk, end + 1 - at, available - at)),
        !data.isEmpty, sendAll(client, data)
      else { return }
      at += data.count
    }
  }

  private func open(_ next: Head) {
    condition.lock()
    head = next
    condition.broadcast()
    condition.unlock()
  }

  func urlSession(
    _ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void
  ) {
    let http = response as? HTTPURLResponse
    let status = http?.statusCode ?? 0
    let length = Int(response.expectedContentLength)
    let type = http?.value(forHTTPHeaderField: "Content-Type") ?? contentType(for: name)
    guard status == 200, length > 0 else {
      // The doorman's refusal, read whole so each request waiting on it hears it: a cap's 502, a 401.
      refusal = (status == 200 || status == 0 ? 502 : status, type, Data())
      return completionHandler(.allow)
    }
    do {
      try FileManager.default.createDirectory(
        at: part.deletingLastPathComponent(), withIntermediateDirectories: true)
      try? FileManager.default.removeItem(at: part)
      guard FileManager.default.createFile(atPath: part.path, contents: nil) else {
        throw CocoaError(.fileWriteUnknown)
      }
      writer = try FileHandle(forWritingTo: part)
    } catch {
      refusal = (503, "text/plain", Data("There is no room for the song on this device.".utf8))
      return completionHandler(.cancel)
    }
    size = length
    open(.ok(size: length, type: type))
    completionHandler(.allow)
  }

  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
    guard let writer else {
      if refusal.body.count < 64 * 1024 { refusal.body.append(data) }
      return
    }
    do {
      try writer.write(contentsOf: data)
    } catch {
      return dataTask.cancel()
    }
    condition.lock()
    received += data.count
    condition.broadcast()
    condition.unlock()
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    var result: Int?
    if let writer {
      try? writer.close()
      self.writer = nil
      if error == nil && received == size {
        do {
          try? FileManager.default.removeItem(at: whole)
          try FileManager.default.moveItem(at: part, to: whole)
          result = size
        } catch {
          result = nil
        }
      }
      if result == nil { try? FileManager.default.removeItem(at: part) }
    } else {
      condition.lock()
      let opened = head != nil
      condition.unlock()
      if !opened {
        if error != nil && refusal.body.isEmpty && refusal.status == 502 {
          refusal = (503, "text/plain", Data("This song is not on this device, and your storage cannot be reached.".utf8))
        }
        open(.refused(status: refusal.status, type: refusal.type, body: refusal.body))
      }
    }
    session.finishTasksAndInvalidate()
    self.session = nil
    condition.lock()
    over = true
    bytes = result
    let callbacks = waiting
    waiting = []
    condition.broadcast()
    condition.unlock()
    callbacks.forEach { $0(result) }
    settled(self, result)
  }
}

// MARK: - A range asked of the doorman by itself

/// The doorman's answer to this very request, passed on: a HEAD, or a far seek.
private final class Relay: NSObject, URLSessionDataDelegate {
  private let client: Int32
  private let finished = DispatchSemaphore(value: 0)
  private var answered = false
  /// Where the range starts and its bytes, while it is small enough to keep.
  private var start: Int?
  private var body = Data()
  private var complete = false

  private init(client: Int32) {
    self.client = client
  }

  /// The range as it came, kept when it was a whole range of at most a mebibyte.
  @discardableResult
  static func run(
    _ client: Int32, source: Source, method: String, range: String?
  ) -> (start: Int, bytes: Data)? {
    let relay = Relay(client: client)
    let configuration = URLSessionConfiguration.ephemeral
    configuration.urlCache = nil
    let queue = OperationQueue()
    queue.maxConcurrentOperationCount = 1
    let session = URLSession(configuration: configuration, delegate: relay, delegateQueue: queue)
    var request = URLRequest(url: source.url)
    request.httpMethod = method
    for (field, value) in source.headers { request.setValue(value, forHTTPHeaderField: field) }
    if let range { request.setValue(range, forHTTPHeaderField: "Range") }
    session.dataTask(with: request).resume()
    relay.finished.wait()
    session.finishTasksAndInvalidate()
    guard relay.complete, let start = relay.start, !relay.body.isEmpty else { return nil }
    return (start, relay.body)
  }

  func urlSession(
    _ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void
  ) {
    let http = response as? HTTPURLResponse
    var headers: [String: String] = [:]
    for field in ["Content-Type", "Content-Length", "Content-Range", "Accept-Ranges"] {
      if let value = http?.value(forHTTPHeaderField: field) { headers[field] = value }
    }
    answered = true
    // `bytes 3031040-3074842/3074843`: where the range starts, to keep it by.
    if http?.statusCode == 206, let range = http?.value(forHTTPHeaderField: "Content-Range"),
      let digits = range.split(separator: " ").last?.split(separator: "-").first
    {
      start = Int(digits)
    }
    completionHandler(writeHead(client, status: http?.statusCode ?? 502, headers: headers) ? .allow : .cancel)
  }

  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
    if !sendAll(client, data) { return dataTask.cancel() }
    if start != nil, body.count + data.count <= 1024 * 1024 { body.append(data) } else { start = nil }
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    if !answered {
      respond(client, status: 503, headers: ["Content-Type": "text/plain"],
              body: Data("This song is not on this device, and your storage cannot be reached.".utf8))
    }
    complete = error == nil
    finished.signal()
  }
}

// MARK: - HTTP, as little of it as a player needs

private struct Request {
  let method: String
  let path: String
  /// Lowercased names.
  let headers: [String: String]
}

private func readRequest(_ client: Int32) -> Request? {
  var buffer = Data()
  var chunk = [UInt8](repeating: 0, count: 4096)
  let end = Data("\r\n\r\n".utf8)
  while buffer.range(of: end) == nil {
    let count = recv(client, &chunk, chunk.count, 0)
    if count <= 0 || buffer.count > 32 * 1024 { return nil }
    buffer.append(chunk, count: count)
  }
  guard let text = String(data: buffer, encoding: .utf8) else { return nil }
  let lines = text.components(separatedBy: "\r\n")
  let first = lines[0].split(separator: " ")
  guard first.count >= 2 else { return nil }
  var headers: [String: String] = [:]
  for line in lines.dropFirst() {
    guard let colon = line.firstIndex(of: ":") else { continue }
    let field = line[..<colon].trimmingCharacters(in: .whitespaces).lowercased()
    headers[field] = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
  }
  return Request(method: String(first[0]), path: String(first[1]), headers: headers)
}

private enum Wanted {
  case whole
  case unsatisfiable
  case bytes(Int, Int)
}

/// `parseRange` in packages/shared/src/range.ts, for one range: a player never asks for more.
private func parseRange(_ header: String?, size: Int) -> Wanted {
  guard let header = header?.trimmingCharacters(in: .whitespaces), header.hasPrefix("bytes=") else {
    return .whole
  }
  let parts = header.dropFirst("bytes=".count).split(separator: "-", maxSplits: 1, omittingEmptySubsequences: false)
  guard parts.count == 2 else { return .whole }
  let rawStart = parts[0].trimmingCharacters(in: .whitespaces)
  let rawEnd = parts[1].trimmingCharacters(in: .whitespaces)
  if rawStart.isEmpty && rawEnd.isEmpty { return .whole }
  if rawStart.isEmpty {
    guard let suffix = Int(rawEnd), suffix > 0 else { return .unsatisfiable }
    return .bytes(max(0, size - suffix), size - 1)
  }
  guard let start = Int(rawStart) else { return .whole }
  let end = rawEnd.isEmpty ? size - 1 : (Int(rawEnd) ?? size - 1)
  if start >= size || start > end { return .unsatisfiable }
  return .bytes(start, min(end, size - 1))
}

private let reasons = [
  200: "OK", 206: "Partial Content", 401: "Unauthorized", 403: "Forbidden", 404: "Not Found",
  405: "Method Not Allowed", 416: "Range Not Satisfiable", 429: "Too Many Requests",
  502: "Bad Gateway", 503: "Service Unavailable",
]

@discardableResult
private func writeHead(_ client: Int32, status: Int, headers: [String: String]) -> Bool {
  var head = "HTTP/1.1 \(status) \(reasons[status] ?? "Status")\r\n"
  for (field, value) in headers { head += "\(field): \(value)\r\n" }
  head += "Cache-Control: no-store\r\nConnection: close\r\n\r\n"
  return sendAll(client, Data(head.utf8))
}

private func respond(_ client: Int32, status: Int, headers: [String: String], body: Data) {
  var all = headers
  all["Content-Length"] = String(body.count)
  if writeHead(client, status: status, headers: all), !body.isEmpty { _ = sendAll(client, body) }
}

private func sendAll(_ client: Int32, _ data: Data) -> Bool {
  data.withUnsafeBytes { (raw: UnsafeRawBufferPointer) -> Bool in
    guard var pointer = raw.baseAddress else { return true }
    var left = raw.count
    while left > 0 {
      let sent = send(client, pointer, left, 0)
      if sent < 0 && errno == EINTR { continue }
      if sent <= 0 { return false }
      pointer += sent
      left -= sent
    }
    return true
  }
}

private func bindLoopback(port: UInt16) -> (Int32, UInt16)? {
  let fd = socket(AF_INET, SOCK_STREAM, 0)
  guard fd >= 0 else { return nil }
  var on: Int32 = 1
  setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &on, socklen_t(MemoryLayout<Int32>.size))
  var address = sockaddr_in()
  address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
  address.sin_family = sa_family_t(AF_INET)
  address.sin_port = port.bigEndian
  address.sin_addr.s_addr = inet_addr("127.0.0.1")
  let length = socklen_t(MemoryLayout<sockaddr_in>.size)
  let bound = withUnsafePointer(to: &address) {
    $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(fd, $0, length) }
  }
  guard bound == 0, listen(fd, 16) == 0 else {
    close(fd)
    return nil
  }
  var actual = sockaddr_in()
  var actualLength = length
  let named = withUnsafeMutablePointer(to: &actual) {
    $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { getsockname(fd, $0, &actualLength) }
  }
  guard named == 0 else {
    close(fd)
    return nil
  }
  return (fd, UInt16(bigEndian: actual.sin_port))
}

private func fileSize(_ url: URL) -> Int? {
  guard let attributes = try? FileManager.default.attributesOfItem(atPath: url.path),
    let size = attributes[.size] as? NSNumber
  else { return nil }
  return size.intValue
}

private func contentType(for name: String) -> String {
  switch (name as NSString).pathExtension.lowercased() {
  case "mp3": return "audio/mpeg"
  case "m4a", "mp4", "aac": return "audio/mp4"
  case "flac": return "audio/flac"
  case "wav": return "audio/wav"
  case "ogg", "opus": return "audio/ogg"
  case "webm": return "audio/webm"
  default: return "application/octet-stream"
  }
}
