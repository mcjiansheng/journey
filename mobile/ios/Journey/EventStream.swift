import Foundation

// Live updates (docs/设计文档/11-原生端功能对齐.md, N2).
//
// `GET /api/trips/:id/events` (app/CONTRACT.md) is a server-sent event stream: `change`
// ({cursor,epoch}) when the trip changed, `presence` (白板在线提示) and `revoked` when this
// session may no longer read the trip, plus a `: heartbeat` comment every 15 seconds. The
// web client listens with the browser's EventSource (app/src/sync.js, `subscribeTrip`).
// This file is the native counterpart: the stream parser, one connection that reconnects
// with back-off, and the store wiring (which trip, scene phase, re-reads, leaving).

/// One dispatched server-sent event. `type` is "message" when the server sent no `event:`.
struct ServerSentEvent: Equatable {
  var type: String
  var data: String
  var lastEventID = ""
}

/// Incremental `text/event-stream` parser (WHATWG HTML, "Server-sent events"). Bytes may
/// arrive split anywhere — inside a line, between CR and LF, inside a UTF-8 character — and
/// give the same events as the whole stream at once.
struct EventStreamParser {
  /// Reconnection time in milliseconds from the last valid `retry:` field.
  private(set) var retry: Int?
  private var line: [UInt8] = []
  private var afterCR = false
  private var atStart = true
  private var eventType: [UInt8] = []
  private var data: [UInt8] = []
  private var lastEventID = ""

  mutating func feed<Bytes: Sequence>(_ bytes: Bytes) -> [ServerSentEvent]
  where Bytes.Element == UInt8 {
    var events: [ServerSentEvent] = []
    for byte in bytes {
      if afterCR {
        afterCR = false
        if byte == 0x0A { continue }  // CR LF is one line break.
      }
      if byte == 0x0D || byte == 0x0A {
        afterCR = byte == 0x0D
        if let event = endLine() { events.append(event) }
      } else {
        line.append(byte)
      }
    }
    return events
  }

  /// The connection ended. An event without its closing blank line is dropped.
  mutating func finish() {
    line.removeAll()
    afterCR = false
    eventType.removeAll()
    data.removeAll()
  }

  private mutating func endLine() -> ServerSentEvent? {
    defer { line.removeAll(keepingCapacity: true) }
    var text = line[...]
    if atStart {
      atStart = false
      if text.starts(with: [0xEF, 0xBB, 0xBF]) { text = text.dropFirst(3) }  // One leading BOM.
    }
    guard let first = text.first else { return dispatch() }
    if first == 0x3A { return nil }  // ":" starts a comment, such as the server's heartbeat.
    var field = text
    var value: ArraySlice<UInt8> = []
    if let colon = text.firstIndex(of: 0x3A) {
      field = text[..<colon]
      value = text[(colon + 1)...]
      if value.first == 0x20 { value = value.dropFirst() }
    }
    if field.elementsEqual("event".utf8) {
      eventType = Array(value)
    } else if field.elementsEqual("data".utf8) {
      data += value
      data.append(0x0A)
    } else if field.elementsEqual("id".utf8) {
      if !value.contains(0) { lastEventID = String(decoding: value, as: UTF8.self) }
    } else if field.elementsEqual("retry".utf8) {
      if !value.isEmpty, value.allSatisfy({ (0x30...0x39).contains($0) }),
        let milliseconds = Int(String(decoding: value, as: UTF8.self))
      {
        retry = milliseconds
      }
    }
    return nil
  }

  private mutating func dispatch() -> ServerSentEvent? {
    defer {
      eventType.removeAll()
      data.removeAll()
    }
    guard !data.isEmpty else { return nil }
    if data.last == 0x0A { data.removeLast() }
    return ServerSentEvent(
      type: eventType.isEmpty ? "message" : String(decoding: eventType, as: UTF8.self),
      data: String(decoding: data, as: UTF8.self), lastEventID: lastEventID)
  }
}

/// One `text/event-stream` connection that reconnects with exponential back-off until it is
/// stopped, the server revokes it, or the server refuses it for good (401/403/404/410).
/// Reading runs off the main actor; events and state changes arrive on it.
@MainActor final class EventStream {
  struct Backoff {
    var initial: TimeInterval = 1
    var maximum: TimeInterval = 30
    /// Random spread, so clients do not all come back at once after a server restart.
    var jitter = 0.2

    /// Wait after `failures` consecutive failed attempts (1 → `initial`, doubling up to
    /// `maximum`). `atLeast` raises the first step, e.g. to a `retry:` field from the server.
    func delay(after failures: Int, atLeast minimum: TimeInterval = 0) -> TimeInterval {
      let base = max(initial, minimum)
      let steps = Double(min(max(failures, 1) - 1, 30))
      return spread(min(max(maximum, base), base * pow(2, steps)))
    }
    /// The longest wait, used when the server says too many streams are open.
    var longest: TimeInterval { spread(maximum) }
    private func spread(_ wait: TimeInterval) -> TimeInterval {
      jitter > 0 ? wait * (1 + jitter * Double.random(in: -1...1)) : wait
    }
  }
  /// Why the stream stopped by itself. Network failures never stop it.
  enum End: Equatable {
    /// The server sent `revoked` (removed from the team, signed out, session expired).
    case revoked
    /// 401, 403, 404 or 410 when connecting: trying again cannot help.
    case rejected(Int)
  }
  fileprivate enum Signal {
    case opened, bytes, event(ServerSentEvent)
  }
  fileprivate enum Outcome: Equatable {
    /// The server accepted the connection and it ended later.
    case closed(events: Int, retry: Int?)
    /// No connection, or the answer was not an event stream.
    case failed
    /// The server answered with another status.
    case status(Int)
    case revoked
  }

  let url: URL
  var backoff = Backoff()
  /// Every event, in order, on the main actor.
  var onEvent: (ServerSentEvent) -> Void = { _ in }
  /// Once, when the stream stops by itself.
  var onEnd: (End) -> Void = { _ in }
  /// The server accepted the current connection as an event stream.
  private(set) var isOpen = false
  /// System uptime when bytes (an event or a heartbeat) last arrived.
  private(set) var lastActivity: TimeInterval?
  /// Connections the server accepted so far.
  private(set) var connections = 0
  var isRunning: Bool { task != nil }
  private let session: URLSession
  private var task: Task<Void, Never>?
  private var generation = 0
  private var failures = 0

  init(url: URL, session: URLSession) {
    self.url = url
    self.session = session
  }

  func start() {
    guard task == nil else { return }
    generation += 1
    failures = 0
    let generation = generation
    let url = url
    let session = session
    task = Task.detached(priority: .utility) { [weak self] in
      while !Task.isCancelled {
        let outcome = await EventStream.read(url: url, session: session) { signal in
          await self?.receive(signal, generation: generation) ?? false
        }
        guard !Task.isCancelled, let wait = await self?.ended(outcome, generation: generation)
        else { return }
        try? await Task.sleep(nanoseconds: UInt64(wait * 1_000_000_000))
      }
    }
  }

  /// Closes the connection; nothing more is delivered.
  func stop() {
    task?.cancel()
    task = nil
    isOpen = false
  }

  /// Open, and bytes arrived within the last `window` seconds.
  func isLive(within window: TimeInterval) -> Bool {
    guard isOpen, let lastActivity else { return false }
    return ProcessInfo.processInfo.systemUptime - lastActivity <= window
  }

  private func receive(_ signal: Signal, generation: Int) -> Bool {
    guard generation == self.generation, task != nil else { return false }
    lastActivity = ProcessInfo.processInfo.systemUptime
    switch signal {
    case .opened:
      isOpen = true
      connections += 1
    case .bytes: break
    case .event(let event):
      failures = 0  // The server answers: back-off starts again from the first step.
      onEvent(event)
    }
    return generation == self.generation && task != nil  // `onEvent` may have stopped us.
  }

  /// Wait before the next attempt, or nil when the stream is over.
  private func ended(_ outcome: Outcome, generation: Int) -> TimeInterval? {
    guard generation == self.generation, task != nil else { return nil }
    isOpen = false
    switch outcome {
    case .revoked:
      task = nil
      onEnd(.revoked)
      return nil
    case .status(let code) where [401, 403, 404, 410].contains(code):
      task = nil
      onEnd(.rejected(code))
      return nil
    case .status(429):
      // Each user may hold 4 streams per trip, web tabs included: wait the longest step.
      failures += 1
      return backoff.longest
    case .closed(let events, let retry):
      failures = events > 0 ? 1 : failures + 1
      return backoff.delay(after: failures, atLeast: Double(retry ?? 0) / 1000)
    case .failed, .status:
      failures += 1
      return backoff.delay(after: failures)
    }
  }

  /// One connection, read to its end.
  nonisolated private static func read(
    url: URL, session: URLSession, signal: (Signal) async -> Bool
  ) async -> Outcome {
    var request = URLRequest(url: url)
    request.cachePolicy = .reloadIgnoringLocalCacheData
    request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
    request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
    let bytes: URLSession.AsyncBytes
    let response: URLResponse
    do { (bytes, response) = try await session.bytes(for: request) } catch { return .failed }
    let connection = bytes.task
    defer { connection.cancel() }  // Closing the socket frees this user's slot on the server.
    guard let http = response as? HTTPURLResponse else { return .failed }
    guard http.statusCode == 200 else { return .status(http.statusCode) }
    guard
      (http.value(forHTTPHeaderField: "Content-Type") ?? "").lowercased()
        .hasPrefix("text/event-stream")
    else { return .failed }
    guard await signal(.opened) else { return .failed }
    var parser = EventStreamParser()
    var line: [UInt8] = []
    var events = 0
    let early: Outcome? = try? await withTaskCancellationHandler {
      for try await byte in bytes {
        line.append(byte)
        guard byte == 0x0A || byte == 0x0D else { continue }
        let parsed = parser.feed(line)
        line.removeAll(keepingCapacity: true)
        guard await signal(.bytes) else { return .failed }
        for event in parsed {
          events += 1
          guard await signal(.event(event)) else { return .failed }
          if event.type == "revoked" { return .revoked }  // The server closes it anyway.
        }
      }
      return nil
    } onCancel: {
      connection.cancel()
    }
    return early ?? .closed(events: events, retry: parser.retry)
  }
}

// MARK: - Store wiring

/// Live-update state of one store: at most one event stream, for the open trip, while the
/// app is in the foreground and signed in (the server allows 4 per user and trip, web tabs
/// included).
@MainActor final class LiveUpdates {
  /// Event streams get their own session: the same cookies, but an idle timeout longer than
  /// the server's 15-second heartbeat instead of the 20-second timeout of API requests.
  let session: URLSession
  var backoff = EventStream.Backoff()
  /// A stream quiet for longer than this (heartbeat 15 s) no longer replaces the poll's read.
  var liveWindow: TimeInterval = 25
  fileprivate(set) var stream: EventStream?
  fileprivate(set) var streamTrip: String?
  fileprivate(set) var foreground = true
  fileprivate var leaving: Set<String> = []
  fileprivate var reads: [String: Task<Void, Error>] = [:]
  fileprivate var notices: [String: JSON] = [:]
  fileprivate var subscribers: [UUID: (String, ServerSentEvent) -> Void] = [:]

  init(session: URLSession) {
    let configuration = session.configuration
    configuration.timeoutIntervalForRequest = 40
    self.session = URLSession(configuration: configuration)
  }

  /// Whether a `change` notice is ahead of the local snapshot. Same test as the web client
  /// (`subscribeTrip` in sync.js): an older epoch, or the same epoch with a cursor not past
  /// ours, needs no read.
  nonisolated static func isNewer(_ notice: JSON, than snapshot: JSON?) -> Bool {
    func epoch(_ value: JSON?) -> Double { value.map { $0.isNull ? 0 : $0.number } ?? 0 }
    let noticeEpoch = epoch(notice["epoch"])
    let localEpoch = epoch(snapshot?["epoch"])
    if noticeEpoch != localEpoch { return noticeEpoch > localEpoch }
    guard case .number(let cursor) = notice["cursor"] else { return true }
    guard case .number(let local)? = snapshot?["cursor"] else { return cursor > -1 }
    return cursor > local
  }
}

extension JourneyStore {
  /// Opens, swaps or closes the event stream to match the open trip, the account and the
  /// scene phase. Called whenever one of them changes.
  func updateLiveUpdates() {
    let wanted =
      ready && live.foreground && !user.isNull && !sessionExpired ? selectedTrip : nil
    if live.stream != nil, live.streamTrip == wanted { return }
    live.stream?.stop()
    live.stream = nil
    live.streamTrip = nil
    guard let id = wanted,
      let url = URL(
        string: baseURL.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
          + "/api/trips/\(id)/events")
    else { return }
    let stream = EventStream(url: url, session: live.session)
    stream.backoff = live.backoff
    stream.onEvent = { [weak self] event in self?.receiveLiveEvent(event, trip: id) }
    stream.onEnd = { [weak self] end in self?.liveStreamEnded(end, trip: id) }
    live.stream = stream
    live.streamTrip = id
    stream.start()
  }

  /// The scene went to the background (false) or came back (true). In the background the
  /// stream closes, so the server frees the slot; coming back reconnects, and the server's
  /// first `change` brings the snapshot up to date.
  func setForeground(_ foreground: Bool) {
    guard live.foreground != foreground else { return }
    live.foreground = foreground
    updateLiveUpdates()
  }

  /// Calls `handler` on the main actor with every event of the open trip's stream (`change`,
  /// `presence`, `revoked` …) before the store acts on it — the hook for 白板 B1 (incremental
  /// pull on `change`) and B8 (presence). Returns the call that unsubscribes.
  @discardableResult
  func onTripEvent(_ handler: @escaping (_ tripID: String, _ event: ServerSentEvent) -> Void)
    -> @MainActor () -> Void
  {
    let token = UUID()
    live.subscribers[token] = handler
    return { [weak self] in self?.live.subscribers[token] = nil }
  }

  /// The one way to re-read a trip: opening it, the foreground poll and live `change`
  /// notices all come here, and a read already in flight is shared instead of repeated.
  func rereadTrip(_ id: String) async throws {
    if let running = live.reads[id] { return try await running.value }
    let read = Task { try await self.readTrip(id) }
    live.reads[id] = read
    defer { if live.reads[id] == read { live.reads[id] = nil } }
    try await read.value
  }

  /// The 8-second foreground poll stays as the fallback. It skips the snapshot read only
  /// while the open trip's stream is live and the snapshot has caught up with its notices.
  var pollShouldRefresh: Bool {
    guard let id = selectedTrip, live.streamTrip == id, let stream = live.stream,
      stream.isLive(within: live.liveWindow), let notice = live.notices[id]
    else { return true }
    return LiveUpdates.isNewer(notice, than: cache.snapshots[id])
  }

  /// Leaves the trip on purpose. The server revokes this device's stream before it answers,
  /// so that revocation is not reported as being removed from the team.
  func leaveTrip(_ id: String, confirmPurge: Bool) async throws {
    live.leaving.insert(id)
    defer { live.leaving.remove(id) }
    _ = try await api(
      "/api/trips/\(id)/leave", method: "POST",
      body: .object(["confirmPurge": .bool(confirmPurge)]))
    if selectedTrip == id { selectedTrip = nil }
    try await refreshTrips()
  }

  private func readTrip(_ id: String) async throws {
    do {
      accept(try await api("/api/trips/\(id)"))
      try persist()
      status = cache.queue.isEmpty ? "已同步" : "有修改等待同步"
    } catch let e as APIError where e.status == 403 || e.status == 404 || e.status == 410 {
      leaveInaccessibleTrip(id, because: e)
      throw e
    }
  }

  /// The trip can no longer be read: removed from the team, gone, or purged. As the web
  /// client's `accessFailure`: forget a purged trip's local data, drop the trip from the
  /// list, go back to 我的旅程, and say why if it was open.
  private func leaveInaccessibleTrip(_ id: String, because e: APIError) {
    if e.status == 410 || e.code == "TRIP_PURGED" {
      cache.snapshots[id] = nil
      cache.contexts[id] = nil
      cache.queue.removeAll { $0.tripID == id }
    }
    cache.trips.removeAll { $0.id == id }
    live.notices[id] = nil
    let wasOpen = selectedTrip == id
    if wasOpen { selectedTrip = nil }
    do { try persist() } catch {
      self.error = error.localizedDescription
      return
    }
    if wasOpen && !live.leaving.contains(id) { self.error = e.message }
  }

  private func receiveLiveEvent(_ event: ServerSentEvent, trip id: String) {
    guard selectedTrip == id else { return }
    for subscriber in Array(live.subscribers.values) { subscriber(id, event) }
    guard event.type == "change",
      let notice = try? JSONDecoder().decode(JSON.self, from: Data(event.data.utf8))
    else { return }
    // Every change also refreshes the open board (B1), as useBoard's onTripChange does on
    // the web: board items are not in the snapshot.
    Task { await boards.refresh() }
    live.notices[id] = notice
    guard LiveUpdates.isNewer(notice, than: cache.snapshots[id]) else { return }
    Task { await catchUp(id, to: notice) }
  }

  /// Reads until the snapshot reaches `notice`. A read already in flight may have been
  /// answered before the change, so one more read can follow it.
  private func catchUp(_ id: String, to notice: JSON) async {
    for _ in 0..<2 {
      guard selectedTrip == id, LiveUpdates.isNewer(notice, than: cache.snapshots[id]) else {
        return
      }
      do { try await rereadTrip(id) } catch { return }
    }
  }

  private func liveStreamEnded(_ end: EventStream.End, trip id: String) {
    if live.streamTrip == id {
      live.stream = nil
      live.streamTrip = nil
    }
    guard selectedTrip == id, !live.leaving.contains(id) else { return }
    // As the web client: read again to learn why. 403/404/410 leaves the trip with the
    // server's message; 401 asks to sign in again. The poll covers the trip meanwhile.
    Task { try? await rereadTrip(id) }
  }
}
