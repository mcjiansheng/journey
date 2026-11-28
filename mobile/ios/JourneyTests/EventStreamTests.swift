import XCTest

@testable import Journey

/// N2 实时同步 (docs/设计文档/11-原生端功能对齐.md). The web client relies on the browser's
/// EventSource and keeps its stream logic inside app/src/sync.js, which cannot be imported in
/// Node, so these are native tests of the same rules rather than shared fixtures.
final class EventStreamParserTests: XCTestCase {
  /// What app/server/index.mjs writes: the `change` sent on connect, a heartbeat, presence,
  /// another change, and the revocation that ends the stream.
  private let serverStream =
    "event: change\ndata: {\"cursor\":12,\"epoch\":3}\n\n: heartbeat\n\n"
    + "event: presence\ndata: {\"boardId\":\"default-board\",\"userId\":\"u2\",\"leave\":true}\n\n"
    + "event: change\ndata: {\"cursor\":13,\"epoch\":3}\n\nevent: revoked\ndata: {}\n\n"

  private func parse(_ text: String) -> [ServerSentEvent] {
    var parser = EventStreamParser()
    return parser.feed(Array(text.utf8))
  }

  func testReadsTheEventsTheServerSends() {
    let events = parse(serverStream)
    XCTAssertEqual(events.map(\.type), ["change", "presence", "change", "revoked"])
    XCTAssertEqual(events[0].data, "{\"cursor\":12,\"epoch\":3}")
    XCTAssertEqual(events[3].data, "{}")
  }

  func testChunksSplitAnywhereGiveTheSameEvents() {
    // CR LF, lone CR and LF line breaks, a byte-order mark, and Chinese text whose UTF-8
    // bytes end up in different chunks.
    let bytes = Array(
      ("\u{FEFF}event: change\r\ndata: {\"name\":\"南京周末\"}\r\n\r\n: heartbeat\r\r"
        + "data: 第一行\rdata: 第二行\r\n\n").utf8)
    var whole = EventStreamParser()
    let expected = whole.feed(bytes)
    XCTAssertEqual(
      expected,
      [
        ServerSentEvent(type: "change", data: "{\"name\":\"南京周末\"}"),
        ServerSentEvent(type: "message", data: "第一行\n第二行"),
      ])
    // Every way of cutting the stream into three chunks, and one byte at a time.
    for first in 0...bytes.count {
      for second in first...bytes.count {
        var parser = EventStreamParser()
        let events =
          parser.feed(bytes[..<first]) + parser.feed(bytes[first..<second])
          + parser.feed(bytes[second...])
        XCTAssertEqual(events, expected, "cut at \(first) and \(second)")
      }
    }
    var parser = EventStreamParser()
    XCTAssertEqual(bytes.flatMap { parser.feed([$0]) }, expected)
  }

  func testMultiLineDataIsJoinedWithLineFeeds() {
    // One leading space is removed from a value; an empty `data` line adds an empty line.
    XCTAssertEqual(parse("data: a\ndata:b\ndata:  c\ndata\n\n").map(\.data), ["a\nb\n c\n"])
    XCTAssertEqual(
      parse("event: change\ndata: {\"cursor\":\ndata: 5}\n\n"),
      [ServerSentEvent(type: "change", data: "{\"cursor\":\n5}")])
  }

  func testCommentsAndUnknownFieldsAreIgnored() {
    XCTAssertEqual(
      parse(": heartbeat\n\n:\nfoo: bar\ndata: x\n: between data lines\ndata: y\nevent\n\n"),
      [ServerSentEvent(type: "message", data: "x\ny")])
    XCTAssertEqual(parse(": heartbeat\n\n: heartbeat\n\n"), [])
  }

  func testAnEventWithoutDataIsNotDispatchedAndItsTypeDoesNotCarryOver() {
    XCTAssertEqual(
      parse("event: change\n\ndata: later\n\n"), [ServerSentEvent(type: "message", data: "later")])
  }

  func testAnUnfinishedEventIsDroppedWhenTheConnectionEnds() {
    var parser = EventStreamParser()
    XCTAssertEqual(parser.feed(Array("event: change\ndata: {\"cursor\":1}\n".utf8)), [])
    parser.finish()
    XCTAssertEqual(
      parser.feed(Array("data: next\n\n".utf8)), [ServerSentEvent(type: "message", data: "next")])
  }

  func testIDAndRetryFields() {
    var parser = EventStreamParser()
    let events = parser.feed(
      Array("id: 7\nretry: 2500\ndata: a\n\nretry: soon\nid: bad\u{0}id\ndata: b\n\n".utf8))
    XCTAssertEqual(events.map(\.lastEventID), ["7", "7"])
    XCTAssertEqual(parser.retry, 2500)
  }

  func testOnlyALeadingByteOrderMarkIsRemoved() {
    XCTAssertEqual(parse("\u{FEFF}data: a\n\ndata: \u{FEFF}b\n\n").map(\.data), ["a", "\u{FEFF}b"])
  }

  @MainActor func testBackoffDoublesUpToTheMaximum() {
    let backoff = EventStream.Backoff(initial: 1, maximum: 30, jitter: 0)
    XCTAssertEqual((1...7).map { backoff.delay(after: $0) }, [1, 2, 4, 8, 16, 30, 30])
    XCTAssertEqual(backoff.delay(after: 1, atLeast: 5), 5)  // A `retry:` field from the server.
    XCTAssertEqual(backoff.longest, 30)
    let spread = EventStream.Backoff(initial: 1, maximum: 30, jitter: 0.2)
    for failures in 1...8 {
      let plain = backoff.delay(after: failures)
      XCTAssertTrue((plain * 0.8...plain * 1.2).contains(spread.delay(after: failures)))
    }
  }

  func testChangeNoticesAreComparedLikeTheWebClient() {
    // sync.js subscribeTrip skips a notice when (epoch ?? 0) < local epoch, or the epochs are
    // equal and cursor <= (local cursor ?? -1); everything else re-reads the snapshot.
    let local: JSON = .object(["epoch": .integer(3), "cursor": .integer(12)])
    func notice(_ epoch: Int, _ cursor: Int) -> JSON {
      .object(["epoch": .integer(epoch), "cursor": .integer(cursor)])
    }
    XCTAssertFalse(LiveUpdates.isNewer(notice(3, 12), than: local))
    XCTAssertFalse(LiveUpdates.isNewer(notice(3, 11), than: local))
    XCTAssertTrue(LiveUpdates.isNewer(notice(3, 13), than: local))
    XCTAssertTrue(LiveUpdates.isNewer(notice(4, 1), than: local))  // The server restarted.
    XCTAssertFalse(LiveUpdates.isNewer(notice(2, 99), than: local))
    XCTAssertTrue(LiveUpdates.isNewer(notice(0, 0), than: nil))  // Nothing read yet.
    XCTAssertTrue(LiveUpdates.isNewer(notice(1, 0), than: .object(["epoch": .integer(1)])))
    XCTAssertTrue(LiveUpdates.isNewer(.object(["epoch": .integer(3)]), than: local))
    XCTAssertFalse(LiveUpdates.isNewer(.object(["cursor": .integer(50)]), than: local))
  }
}

// MARK: - A server for URLSession

/// Answers JSON requests and scripted `text/event-stream` responses, and pushes events into
/// open streams the way the server's `notify` does. Client callbacks run on the thread that
/// started loading, as URLProtocol requires.
final class LiveMockProtocol: URLProtocol {
  struct Stream {
    var status = 200
    var contentType = "text/event-stream"
    /// Sent right after the headers, like the server's first `change`.
    var initial: [Data] = []
    /// End the response after `initial`, as if the server closed the connection.
    var close = false
    /// No answer at all, as without a network.
    var fail = false
  }
  struct Answer {
    var status: Int
    var body: JSON
    var delay: TimeInterval = 0
  }

  private static let lock = NSLock()
  private static var answer: ((URLRequest) -> Answer)?
  private static var script: ((URLRequest, Int) -> Stream)?
  private static var attempts = 0
  private static var open: [LiveMockProtocol] = []
  private static var cancelled = 0
  private static var mostOpen = 0

  static func serve(
    answer: @escaping (URLRequest) -> Answer, stream: @escaping (URLRequest, Int) -> Stream
  ) {
    locked {
      self.answer = answer
      script = stream
      attempts = 0
      open = []
      cancelled = 0
      mostOpen = 0
    }
  }
  static func clear() {
    locked {
      answer = nil
      script = nil
    }
  }
  static var streamAttempts: Int { locked { attempts } }
  static var openStreams: Int { locked { open.count } }
  static var openPaths: [String] { locked { open.compactMap { $0.request.url?.path } } }
  static var mostOpenStreams: Int { locked { mostOpen } }
  /// Streams the client closed (cancelled), as opposed to ones the server ended.
  static var cancelledStreams: Int { locked { cancelled } }

  /// Writes `text` to every open stream; `thenClose` ends them afterwards.
  static func push(_ text: String, thenClose: Bool = false) {
    let targets = locked { () -> [LiveMockProtocol] in
      let targets = open
      if thenClose { open.removeAll() }
      return targets
    }
    for target in targets {
      target.onClientThread { stream in
        if !text.isEmpty { stream.client?.urlProtocol(stream, didLoad: Data(text.utf8)) }
        if thenClose { stream.client?.urlProtocolDidFinishLoading(stream) }
      }
    }
  }

  @discardableResult private static func locked<T>(_ body: () -> T) -> T {
    lock.lock()
    defer { lock.unlock() }
    return body()
  }

  private var thread: Thread?
  private var modes = [RunLoop.Mode.default.rawValue]
  private var stopped = false

  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

  override func startLoading() {
    thread = Thread.current
    if let mode = RunLoop.current.currentMode { modes = [mode.rawValue] }
    if request.url?.path.hasSuffix("/events") == true { startStream() } else { startAnswer() }
  }

  override func stopLoading() {
    Self.locked {
      stopped = true
      if let index = Self.open.firstIndex(where: { $0 === self }) {
        Self.open.remove(at: index)
        Self.cancelled += 1
      }
    }
  }

  private func startAnswer() {
    guard let answer = Self.locked({ Self.answer })?(request) else {
      client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet))
      return
    }
    guard answer.delay > 0 else { return send(answer) }
    DispatchQueue.global().asyncAfter(deadline: .now() + answer.delay) {
      self.onClientThread { mock in
        if !Self.locked({ mock.stopped }) { mock.send(answer) }
      }
    }
  }

  private func send(_ answer: Answer) {
    let response = HTTPURLResponse(
      url: request.url!, statusCode: answer.status, httpVersion: "HTTP/1.1",
      headerFields: ["Content-Type": "application/json"])!
    client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
    client?.urlProtocol(self, didLoad: (try? JSONEncoder().encode(answer.body)) ?? Data())
    client?.urlProtocolDidFinishLoading(self)
  }

  private func startStream() {
    let (script, attempt) = Self.locked { () -> (((URLRequest, Int) -> Stream)?, Int) in
      Self.attempts += 1
      return (Self.script, Self.attempts)
    }
    guard let stream = script?(request, attempt), !stream.fail else {
      client?.urlProtocol(self, didFailWithError: URLError(.cannotConnectToHost))
      return
    }
    let response = HTTPURLResponse(
      url: request.url!, statusCode: stream.status, httpVersion: "HTTP/1.1",
      headerFields: ["Content-Type": stream.contentType])!
    client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
    guard stream.status == 200, stream.contentType.hasPrefix("text/event-stream") else {
      client?.urlProtocol(self, didLoad: Data("{}".utf8))
      client?.urlProtocolDidFinishLoading(self)
      return
    }
    for chunk in stream.initial { client?.urlProtocol(self, didLoad: chunk) }
    if stream.close {
      client?.urlProtocolDidFinishLoading(self)
      return
    }
    Self.locked {
      Self.open.append(self)
      Self.mostOpen = max(Self.mostOpen, Self.open.count)
    }
  }

  private final class Work: NSObject {
    let run: (LiveMockProtocol) -> Void
    init(_ run: @escaping (LiveMockProtocol) -> Void) { self.run = run }
  }
  private func onClientThread(_ run: @escaping (LiveMockProtocol) -> Void) {
    guard let thread else { return }
    perform(#selector(runWork(_:)), on: thread, with: Work(run), waitUntilDone: false, modes: modes)
  }
  @objc private func runWork(_ work: Work) { work.run(self) }
}

private enum Live {
  static func session() -> URLSession {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [LiveMockProtocol.self]
    return URLSession(configuration: configuration)
  }
  static let fast = EventStream.Backoff(initial: 0.05, maximum: 0.2, jitter: 0)
  static func change(_ cursor: Int, epoch: Int = 1) -> Data {
    Data("event: change\ndata: {\"cursor\":\(cursor),\"epoch\":\(epoch)}\n\n".utf8)
  }
  /// Waits until `condition` holds, for at most `timeout` seconds.
  @MainActor static func eventually(_ timeout: TimeInterval = 5, _ condition: () -> Bool) async
    -> Bool
  {
    let deadline = ProcessInfo.processInfo.systemUptime + timeout
    while !condition() {
      if ProcessInfo.processInfo.systemUptime > deadline { return false }
      try? await Task.sleep(for: .milliseconds(10))
    }
    return true
  }
  static func pause(_ seconds: Double = 0.3) async {
    try? await Task.sleep(for: .milliseconds(Int(seconds * 1000)))
  }
}

// MARK: - The connection

final class EventStreamConnectionTests: XCTestCase {
  @MainActor private func makeStream(_ session: URLSession) -> EventStream {
    let stream = EventStream(
      url: URL(string: "https://journey-live.invalid/api/trips/trip/events")!, session: session)
    stream.backoff = Live.fast
    return stream
  }

  @MainActor func testReconnectsAfterTheServerClosesTheStream() async throws {
    LiveMockProtocol.serve(answer: { _ in .init(status: 404, body: .null) }) { _, attempt in
      .init(initial: [Live.change(attempt)], close: attempt == 1)
    }
    defer { LiveMockProtocol.clear() }
    let stream = makeStream(Live.session())
    defer { stream.stop() }
    var received: [String] = []
    stream.onEvent = { received.append($0.data) }
    stream.start()
    let both = await Live.eventually { received.count == 2 }
    XCTAssertTrue(both)
    XCTAssertEqual(received, ["{\"cursor\":1,\"epoch\":1}", "{\"cursor\":2,\"epoch\":1}"])
    XCTAssertEqual(stream.connections, 2)
    XCTAssertTrue(stream.isOpen)
    XCTAssertTrue(stream.isLive(within: 5))
  }

  @MainActor func testKeepsTryingWhileTheServerIsUnreachable() async throws {
    LiveMockProtocol.serve(answer: { _ in .init(status: 404, body: .null) }) { _, attempt in
      attempt <= 3 ? .init(fail: true) : .init(initial: [Live.change(9)])
    }
    defer { LiveMockProtocol.clear() }
    let stream = makeStream(Live.session())
    defer { stream.stop() }
    var received: [ServerSentEvent] = []
    stream.onEvent = { received.append($0) }
    stream.start()
    let connected = await Live.eventually { !received.isEmpty }
    XCTAssertTrue(connected)
    XCTAssertEqual(LiveMockProtocol.streamAttempts, 4)
    XCTAssertEqual(stream.connections, 1)
  }

  @MainActor func testEventsSplitAcrossNetworkChunks() async throws {
    let name = Array("南京".utf8)
    let chunks: [Data] = [
      Data("event: cha".utf8), Data("nge\r\ndata: {\"name\":\"".utf8), Data(name[..<1]),
      Data(name[1...]), Data("\"}\r".utf8), Data("\n\r\n: heartbeat\n\ndata: 一\ndata: 二".utf8),
      Data("\n\n".utf8),
    ]
    LiveMockProtocol.serve(answer: { _ in .init(status: 404, body: .null) }) { _, _ in
      .init(initial: chunks)
    }
    defer { LiveMockProtocol.clear() }
    let stream = makeStream(Live.session())
    defer { stream.stop() }
    var received: [ServerSentEvent] = []
    stream.onEvent = { received.append($0) }
    stream.start()
    let both = await Live.eventually { received.count == 2 }
    XCTAssertTrue(both)
    XCTAssertEqual(
      received,
      [
        ServerSentEvent(type: "change", data: "{\"name\":\"南京\"}"),
        ServerSentEvent(type: "message", data: "一\n二"),
      ])
  }

  @MainActor func testRevokedEndsTheStreamWithoutReconnecting() async throws {
    LiveMockProtocol.serve(answer: { _ in .init(status: 404, body: .null) }) { _, _ in
      .init(initial: [Live.change(1)])
    }
    defer { LiveMockProtocol.clear() }
    let stream = makeStream(Live.session())
    defer { stream.stop() }
    var ends: [EventStream.End] = []
    stream.onEnd = { ends.append($0) }
    stream.start()
    let open = await Live.eventually { LiveMockProtocol.openStreams == 1 }
    XCTAssertTrue(open)
    LiveMockProtocol.push("event: revoked\ndata: {}\n\n", thenClose: true)
    let ended = await Live.eventually { ends == [.revoked] }
    XCTAssertTrue(ended)
    await Live.pause()
    XCTAssertEqual(LiveMockProtocol.streamAttempts, 1)
    XCTAssertFalse(stream.isRunning)
    XCTAssertFalse(stream.isOpen)
  }

  @MainActor func testTooManyStreamsWaitsButRefusalStops() async throws {
    LiveMockProtocol.serve(answer: { _ in .init(status: 404, body: .null) }) { request, attempt in
      if request.url!.path.contains("/gone/") { return .init(status: 403, contentType: "application/json") }
      return attempt == 1
        ? .init(status: 429, contentType: "application/json") : .init(initial: [Live.change(1)])
    }
    defer { LiveMockProtocol.clear() }
    let session = Live.session()
    let busy = makeStream(session)
    defer { busy.stop() }
    busy.start()
    let retried = await Live.eventually { busy.connections == 1 }
    XCTAssertTrue(retried)
    XCTAssertEqual(LiveMockProtocol.streamAttempts, 2)

    let gone = EventStream(
      url: URL(string: "https://journey-live.invalid/api/trips/gone/events")!, session: session)
    gone.backoff = Live.fast
    var ends: [EventStream.End] = []
    gone.onEnd = { ends.append($0) }
    gone.start()
    let refused = await Live.eventually { ends == [.rejected(403)] }
    XCTAssertTrue(refused)
    await Live.pause()
    XCTAssertEqual(LiveMockProtocol.streamAttempts, 3)
    XCTAssertFalse(gone.isRunning)
  }

  @MainActor func testAnAnswerThatIsNotAnEventStreamIsRetried() async throws {
    LiveMockProtocol.serve(answer: { _ in .init(status: 404, body: .null) }) { _, attempt in
      attempt == 1 ? .init(contentType: "text/html") : .init(initial: [Live.change(1)])
    }
    defer { LiveMockProtocol.clear() }
    let stream = makeStream(Live.session())
    defer { stream.stop() }
    stream.start()
    let connected = await Live.eventually { stream.connections == 1 }
    XCTAssertTrue(connected)
    XCTAssertEqual(LiveMockProtocol.streamAttempts, 2)
  }

  @MainActor func testStopClosesTheConnection() async throws {
    LiveMockProtocol.serve(answer: { _ in .init(status: 404, body: .null) }) { _, _ in
      .init(initial: [Live.change(1)])
    }
    defer { LiveMockProtocol.clear() }
    let stream = makeStream(Live.session())
    var received = 0
    stream.onEvent = { _ in received += 1 }
    stream.start()
    let open = await Live.eventually { received == 1 && LiveMockProtocol.openStreams == 1 }
    XCTAssertTrue(open)
    stream.stop()
    let closed = await Live.eventually {
      LiveMockProtocol.openStreams == 0 && LiveMockProtocol.cancelledStreams == 1
    }
    XCTAssertTrue(closed)
    LiveMockProtocol.push("event: change\ndata: {\"cursor\":2,\"epoch\":1}\n\n")
    await Live.pause()
    XCTAssertEqual(received, 1)
    XCTAssertEqual(LiveMockProtocol.streamAttempts, 1)
  }
}

// MARK: - The store

/// The server side of the store tests: trips with a cursor, and whether the user is a member.
private final class TripServer: @unchecked Sendable {
  private let lock = NSLock()
  private var names = ["trip": "南京周末", "other": "苏州一日"]
  private var cursors = ["trip": 1, "other": 1]
  private var members: Set<String> = ["trip", "other"]
  private var readCount = 0
  private var boardReadCount = 0
  private var delay: TimeInterval = 0
  private var epoch = 1

  var reads: Int { locked { readCount } }
  var boardReads: Int { locked { boardReadCount } }
  /// Snapshot reads answer after `seconds`.
  func slowReads(_ seconds: TimeInterval) { locked { delay = seconds } }
  /// A restart ends every stream and starts a higher epoch.
  func restart() {
    locked { epoch += 1 }
    LiveMockProtocol.push("", thenClose: true)
  }

  private func locked<T>(_ body: () -> T) -> T {
    lock.lock()
    defer { lock.unlock() }
    return body()
  }

  private func snapshot(_ id: String) -> JSON {
    .object([
      "trip": .object([
        "id": .string(id), "name": .string(names[id] ?? ""), "teamMode": .string("equal"),
        "startDate": .string("2026-11-07"), "dayCount": .integer(2),
      ]),
      "objects": .array([]), "members": .array([]), "cursor": .integer(cursors[id] ?? 0),
      "epoch": .integer(epoch),
    ])
  }

  func answer(_ request: URLRequest) -> LiveMockProtocol.Answer {
    let path = request.url!.path
    let method = request.httpMethod ?? "GET"
    switch (method, path) {
    case ("POST", "/api/auth/login"):
      return .init(
        status: 200,
        body: .object([
          "user": .object(["id": .string("live-user"), "displayName": .string("原生")]),
          "csrfToken": .string("csrf"),
        ]))
    case ("GET", "/api/trips"):
      let trips = locked { members.sorted().map { snapshot($0)["trip"] } }
      return .init(status: 200, body: .object(["trips": .array(trips)]))
    case ("POST", "/api/clock"):
      let now = Date().timeIntervalSince1970 * 1000
      return .init(
        status: 200,
        body: .object([
          "leaseId": .string("lease"), "serverTime": .number(now),
          "expiresAt": .number(now + 86_400_000),
        ]))
    case ("PUT", "/api/navigation"):
      return .init(status: 200, body: .object(["ok": .bool(true)]))
    case ("POST", let leave) where leave.hasSuffix("/leave"):
      let id = leave.split(separator: "/")[2]
      locked { _ = members.remove(String(id)) }
      // As the server: revoke this user's streams first, then answer.
      LiveMockProtocol.push("event: revoked\ndata: {}\n\n", thenClose: true)
      return .init(status: 200, body: .object(["purged": .bool(false)]), delay: 0.2)
    case ("GET", let items) where items.contains("/boards/") && items.hasSuffix("/items"):
      let id = String(items.split(separator: "/")[2])
      return locked {
        boardReadCount += 1
        return .init(
          status: 200,
          body: .object([
            "items": .array([]), "cursor": .integer(cursors[id] ?? 0), "epoch": .integer(epoch),
          ]))
      }
    case ("GET", let trip) where trip.hasPrefix("/api/trips/"):
      let id = String(trip.dropFirst("/api/trips/".count))
      return locked {
        readCount += 1
        guard members.contains(id) else {
          return .init(
            status: 403,
            body: .object([
              "error": .object(["code": .string("FORBIDDEN"), "message": .string("你已不在此旅程团队")])
            ]), delay: delay)
        }
        return .init(status: 200, body: snapshot(id), delay: delay)
      }
    default:
      return .init(status: 404, body: .object(["error": .object(["code": .string("NOT_FOUND")])]))
    }
  }

  func stream(_ request: URLRequest, _ attempt: Int) -> LiveMockProtocol.Stream {
    let id = String(request.url!.path.split(separator: "/")[2])
    return locked {
      guard members.contains(id) else { return .init(status: 403, contentType: "application/json") }
      return .init(initial: [Live.change(cursors[id] ?? 0, epoch: epoch)])
    }
  }

  /// A member edits the trip on the web: the cursor moves and open streams are told.
  func rename(_ id: String, _ name: String, notify: Bool = true) {
    let (cursor, epoch) = locked { () -> (Int, Int) in
      names[id] = name
      cursors[id, default: 0] += 1
      return (cursors[id]!, self.epoch)
    }
    if notify {
      LiveMockProtocol.push("event: change\ndata: {\"cursor\":\(cursor),\"epoch\":\(epoch)}\n\n")
    }
  }

  /// The owner removes this user: the server revokes the stream and ends it.
  func remove(_ id: String) {
    locked { _ = members.remove(id) }
    LiveMockProtocol.push("event: revoked\ndata: {}\n\n", thenClose: true)
  }
}

final class LiveUpdatesStoreTests: XCTestCase {
  private var directory: URL!

  @MainActor private func signedInStore(_ server: TripServer) async throws -> JourneyStore {
    LiveMockProtocol.serve(answer: server.answer, stream: server.stream)
    directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    let store = JourneyStore(
      urlSession: Live.session(), serverURL: "https://journey-live.invalid",
      storageDirectory: directory)
    store.live.backoff = Live.fast
    try await store.login(identifier: "live", password: "password", name: "", register: false)
    store.stopPolling()  // These tests drive the reads themselves.
    store.ready = true
    return store
  }

  @MainActor private func finish(_ store: JourneyStore) {
    store.selectedTrip = nil
    LiveMockProtocol.clear()
    try? FileManager.default.removeItem(at: directory)
  }

  @MainActor func testWebChangeShowsWithoutRefreshing() async throws {
    let server = TripServer()
    let store = try await signedInStore(server)
    defer { finish(store) }
    try await store.open("trip")
    let open = await Live.eventually { LiveMockProtocol.openStreams == 1 }
    XCTAssertTrue(open)
    // The stream's first `change` carries the cursor just read: no second read.
    await Live.pause()
    XCTAssertEqual(server.reads, 1)
    XCTAssertFalse(store.pollShouldRefresh)

    server.rename("trip", "网页改了名字")
    let shown = await Live.eventually { store.trip["name"].string == "网页改了名字" }
    XCTAssertTrue(shown)
    XCTAssertEqual(server.reads, 2)
    XCTAssertEqual(store.trips.first { $0.id == "trip" }?["name"].string, "网页改了名字")
    XCTAssertEqual(LiveMockProtocol.streamAttempts, 1)
  }

  @MainActor func testRemovalFromTheTeamLeavesTheTripWithTheServerMessage() async throws {
    let server = TripServer()
    let store = try await signedInStore(server)
    defer { finish(store) }
    try await store.open("trip")
    let open = await Live.eventually { LiveMockProtocol.openStreams == 1 }
    XCTAssertTrue(open)
    server.remove("trip")
    let left = await Live.eventually { store.selectedTrip == nil }
    XCTAssertTrue(left)
    XCTAssertEqual(store.error, "你已不在此旅程团队")
    XCTAssertFalse(store.trips.contains { $0.id == "trip" })
    XCTAssertNotNil(store.cache.snapshots["trip"])  // Only a purged trip loses its local copy.
    await Live.pause()
    XCTAssertEqual(LiveMockProtocol.streamAttempts, 1)
    XCTAssertNil(store.live.stream)
  }

  @MainActor func testLeavingOnPurposeIsNotReportedAsRemoval() async throws {
    let server = TripServer()
    let store = try await signedInStore(server)
    defer { finish(store) }
    try await store.open("trip")
    let open = await Live.eventually { LiveMockProtocol.openStreams == 1 }
    XCTAssertTrue(open)
    try await store.leaveTrip("trip", confirmPurge: false)
    XCTAssertNil(store.selectedTrip)
    XCTAssertFalse(store.trips.contains { $0.id == "trip" })
    await Live.pause()
    XCTAssertNil(store.error)
    XCTAssertEqual(server.reads, 1)
  }

  @MainActor func testBackgroundClosesTheStreamAndComingBackCatchesUp() async throws {
    let server = TripServer()
    let store = try await signedInStore(server)
    defer { finish(store) }
    try await store.open("trip")
    let open = await Live.eventually { LiveMockProtocol.openStreams == 1 }
    XCTAssertTrue(open)
    store.setForeground(false)
    let closed = await Live.eventually {
      LiveMockProtocol.openStreams == 0 && LiveMockProtocol.cancelledStreams == 1
    }
    XCTAssertTrue(closed)
    server.rename("trip", "后台期间的修改", notify: false)
    await Live.pause()
    XCTAssertEqual(server.reads, 1)
    XCTAssertEqual(store.trip["name"].string, "南京周末")

    store.setForeground(true)
    let caughtUp = await Live.eventually { store.trip["name"].string == "后台期间的修改" }
    XCTAssertTrue(caughtUp)
    XCTAssertEqual(server.reads, 2)
    XCTAssertEqual(LiveMockProtocol.streamAttempts, 2)
  }

  @MainActor func testServerRestartReconnectsAndRereads() async throws {
    let server = TripServer()
    let store = try await signedInStore(server)
    defer { finish(store) }
    try await store.open("trip")
    let open = await Live.eventually { LiveMockProtocol.openStreams == 1 }
    XCTAssertTrue(open)
    // A restart ends every stream and starts a higher epoch; nothing else changed.
    server.restart()
    let reread = await Live.eventually { store.snapshot["epoch"].number == 2 }
    XCTAssertTrue(reread)
    XCTAssertEqual(LiveMockProtocol.streamAttempts, 2)
    XCTAssertEqual(server.reads, 2)
  }

  @MainActor func testOnlyTheOpenTripHasAStream() async throws {
    let server = TripServer()
    let store = try await signedInStore(server)
    defer { finish(store) }
    XCTAssertEqual(LiveMockProtocol.streamAttempts, 0)  // 我的旅程: no stream.
    try await store.open("trip")
    let first = await Live.eventually { LiveMockProtocol.openPaths == ["/api/trips/trip/events"] }
    XCTAssertTrue(first)
    try await store.open("other")
    let second = await Live.eventually {
      LiveMockProtocol.openPaths == ["/api/trips/other/events"]
    }
    XCTAssertTrue(second)
    store.selectedTrip = nil
    let none = await Live.eventually { LiveMockProtocol.openStreams == 0 }
    XCTAssertTrue(none)
    XCTAssertEqual(LiveMockProtocol.cancelledStreams, 2)
  }

  @MainActor func testOverlappingReadsShareOneRequest() async throws {
    let server = TripServer()
    let store = try await signedInStore(server)
    defer { finish(store) }
    store.ready = false  // No stream, only the reads.
    store.selectedTrip = "trip"
    server.slowReads(0.2)
    async let poll: Void = store.refresh()
    async let again: Void = store.refresh()
    async let direct: Void = store.rereadTrip("trip")
    _ = try await (poll, again, direct)
    XCTAssertEqual(server.reads, 1)
    XCTAssertEqual(store.trip["name"].string, "南京周末")
    try await store.refresh()  // A later read is a new request.
    XCTAssertEqual(server.reads, 2)
  }

  @MainActor func testPollReadsWhenTheStreamCannotStandIn() async throws {
    let server = TripServer()
    let store = try await signedInStore(server)
    defer { finish(store) }
    XCTAssertTrue(store.pollShouldRefresh)  // 我的旅程: the poll refreshes the list.
    try await store.open("trip")
    let current = await Live.eventually { !store.pollShouldRefresh }
    XCTAssertTrue(current)
    store.live.liveWindow = 0  // Quiet for too long: the poll reads again.
    XCTAssertTrue(store.pollShouldRefresh)
    store.live.liveWindow = 25
    store.setForeground(false)
    XCTAssertTrue(store.pollShouldRefresh)
  }

  @MainActor func testSubscribersSeeEveryEventOfTheOpenTrip() async throws {
    let server = TripServer()
    let store = try await signedInStore(server)
    defer { finish(store) }
    var seen: [String] = []
    let unsubscribe = store.onTripEvent { trip, event in seen.append("\(trip):\(event.type)") }
    try await store.open("trip")
    let first = await Live.eventually { seen == ["trip:change"] }
    XCTAssertTrue(first)
    LiveMockProtocol.push("event: presence\ndata: {\"userId\":\"u2\"}\n\n")
    let presence = await Live.eventually { seen.count == 2 }
    XCTAssertTrue(presence)
    XCTAssertEqual(seen.last, "trip:presence")
    unsubscribe()
    server.rename("trip", "再改一次")
    let shown = await Live.eventually { store.trip["name"].string == "再改一次" }
    XCTAssertTrue(shown)
    XCTAssertEqual(seen.count, 2)
  }

  @MainActor func testChangeAlsoRefreshesTheOpenBoard() async throws {
    let server = TripServer()
    let store = try await signedInStore(server)
    defer { finish(store) }
    try await store.open("trip")
    let open = await Live.eventually { LiveMockProtocol.openStreams == 1 }
    XCTAssertTrue(open)
    await store.boards.open("default-board")
    let loaded = server.boardReads
    XCTAssertGreaterThanOrEqual(loaded, 1)
    // Board items are not in the snapshot: a `change` also pulls the open board's items.
    server.rename("trip", "白板之外的修改")
    let refreshed = await Live.eventually { server.boardReads > loaded }
    XCTAssertTrue(refreshed)
  }

  @MainActor func testSignedOutOrExpiredSessionHasNoStream() async throws {
    let server = TripServer()
    let store = try await signedInStore(server)
    defer { finish(store) }
    try await store.open("trip")
    let open = await Live.eventually { LiveMockProtocol.openStreams == 1 }
    XCTAssertTrue(open)
    store.sessionExpired = true
    let closed = await Live.eventually { LiveMockProtocol.openStreams == 0 }
    XCTAssertTrue(closed)
    XCTAssertNil(store.live.stream)
  }
}
