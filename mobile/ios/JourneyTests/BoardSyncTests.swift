import XCTest

@testable import Journey

/// B1 board data and sync (docs/设计文档/11-原生端功能对齐.md §5): the rules from
/// app/src/board-pending.js against mobile/fixtures/board-sync.json, the style helpers of
/// app/src/board.js against board-geometry.json, the pure parts of app/src/board-sync.js
/// (which imports React and the browser sync layer, so it has no shared fixture) against
/// outputs of the web functions, and BoardStore against a mock server.
final class BoardSyncTests: XCTestCase {
  // MARK: - Shared fixtures

  func testBoardSyncFixtureIsGeneratedFromTheWebClient() throws {
    let file = try Fixtures.load("board-sync")
    XCTAssertTrue(file["$comment"].string.contains("generate-fixtures.mjs"))
    XCTAssertEqual(file["sources"], .array([.string("app/src/board-pending.js")]))
    XCTAssertEqual(file["constants"]["PENDING_TTL"], .number(BoardPending.ttl))
    for fn in ["mergeExpected", "reconcilePending", "isStaleResponse"] {
      XCTAssertFalse(Fixtures.cases(file, fn).isEmpty, fn)
    }
  }

  func testMergeExpectedMatchesTheWebClient() throws {
    for c in Fixtures.cases(try Fixtures.load("board-sync"), "mergeExpected") {
      let previous = c.args.count > 0 ? c.args[0] : .object([:])
      let next = c.args.count > 1 ? c.args[1] : .object([:])
      let result = BoardPending.mergeExpected(previous, next)
      XCTAssertTrue(Fixtures.same(c.result, result), "\(c.args) → \(result)")
    }
  }

  func testReconcilePendingMatchesTheWebClient() throws {
    let cases = Fixtures.cases(try Fixtures.load("board-sync"), "reconcilePending")
    XCTAssertGreaterThanOrEqual(cases.count, 10)
    for c in cases {
      var pending = BoardPending.Changes(
        c.args[2].array.map { pair in
          (pair.array[0].string, .init(expect: pair.array[1]["expect"], at: pair.array[1]["at"].number))
        })
      let items = BoardPending.reconcile(
        c.args[0].array, local: c.args[1].array, pending: &pending, now: c.args[3].number)
      XCTAssertTrue(Fixtures.same(c.result["items"], .array(items)), "\(c.args[2])")
      let left: JSON = .array(
        pending.pairs.map { .array([.string($0.0), .object(["expect": $0.1.expect, "at": .number($0.1.at)])]) })
      XCTAssertTrue(Fixtures.same(c.result["pending"], left), "\(c.args[2]) → \(left)")
    }
  }

  func testIsStaleResponseMatchesTheWebClient() throws {
    let cases = Fixtures.cases(try Fixtures.load("board-sync"), "isStaleResponse")
    XCTAssertTrue(cases.contains { $0.result == .bool(true) })
    XCTAssertTrue(cases.contains { $0.result == .bool(false) })
    for c in cases {
      XCTAssertEqual(
        BoardPending.isStaleResponse(c.args[0], cursor: c.args[1], epoch: c.args[2]), c.result.bool,
        "\(c.args)")
    }
  }

  func testBoardStyleCleaningMatchesTheWebClient() throws {
    let file = try Fixtures.load("board-geometry")
    let clean = Fixtures.cases(file, "cleanBoardStylePatch", module: "board")
    let next = Fixtures.cases(file, "nextBoardStyle", module: "board")
    XCTAssertFalse(clean.isEmpty)
    XCTAssertFalse(next.isEmpty)
    for c in clean {
      XCTAssertTrue(Fixtures.same(c.result, BoardItems.cleanStylePatch(c.args[0])), "\(c.args)")
    }
    for c in next {
      let replace = c.args.count > 2 && c.args[2]["replace"].bool
      let result = BoardItems.nextStyle(c.args[0], patch: c.args[1], replace: replace) ?? .null
      XCTAssertTrue(Fixtures.same(c.result, result), "\(c.args) → \(result)")
    }
  }

  // MARK: - board-sync.js ports

  /// Inputs and the results of the web client's `normalizeBoardItem`,
  /// `cleanBoardItemPatch` and patchBoardItem's local copy (target = the first normalize
  /// case, now = 1700000000000), produced by running those functions from
  /// app/src/board-sync.js at 3d5a2e4.
  static let web: JSON = try! JSONDecoder().decode(JSON.self, from: Data(webCases.utf8))

  func testNormalizeBoardItemMatchesTheWebClient() {
    let cases = Self.web["normalize"].array
    XCTAssertEqual(cases.count, 12)
    for c in cases {
      let result = BoardItems.normalize(c.array[0])
      XCTAssertTrue(Fixtures.same(c.array[1], result), "\(c.array[0]) → \(result)")
    }
    XCTAssertEqual(BoardItems.normalize(.null), .null)
  }

  func testCleanBoardItemPatchMatchesTheWebClient() {
    let cases = Self.web["clean"].array
    XCTAssertEqual(cases.count, 14)
    for c in cases {
      let result = BoardItems.cleanPatch(c.array[0])
      XCTAssertTrue(Fixtures.same(c.array[1], result), "\(c.array[0]) → \(result)")
    }
    XCTAssertEqual(BoardItems.cleanPatch(nil), .object([:]))
  }

  func testLocalPatchMatchesTheWebClient() {
    let target = BoardItems.normalize(Self.web["normalize"].array[0].array[0])
    for c in Self.web["patch"].array {
      let patch = c.array[0]
      let replace = c.array[1].bool && JSRules.truthy(patch["style"])
      var source = patch.dictionary
      if let style = BoardItems.nextStyle(target["style"], patch: patch, replace: replace) {
        source["style"] = style
      }
      let cleaned = BoardItems.cleanPatch(.object(source))
      XCTAssertTrue(Fixtures.same(c.array[2]["cleaned"], cleaned), "\(patch) → \(cleaned)")
      let updated = BoardItems.applying(cleaned, to: target, replaceStyle: replace, now: 1_700_000_000_000)
      XCTAssertTrue(Fixtures.same(c.array[2]["updatedItem"], updated), "\(patch) → \(updated)")
    }
  }

  // MARK: - Board list (Board.jsx)

  private func board(_ id: String, order: Double?, state: String = "active", title: String = "")
    -> JSON
  {
    var payload: [String: JSON] = ["title": .string(title.isEmpty ? id : title)]
    if let order { payload["order"] = .number(order) }
    return .object([
      "id": .string(id), "kind": .string("board"), "state": .string(state),
      "generation": .number(0), "payload": .object(payload),
    ])
  }

  func testBoardIDsTieBreakLikeLocaleCompare() {
    // Sorted by Node's `localeCompare`, as the web client sorts boards with equal order.
    let expected = [
      "_x", "-x", "0x", "a1", "A1", "ab", "aB", "Ab", "b_1", "b-1", "b1", "B1", "default_board",
      "default-board", "default-boarD", "DEFAULT-BOARD", "e3b0c442-98fc-1c14-9afb-f4c8996fb924",
      "F00D2A6C-1B1E-4C2B-9C1A-2D3E4F5A6B7C",
    ]
    XCTAssertEqual(expected.reversed().sorted(by: JSRules.localeLess), expected)
    XCTAssertEqual(expected.shuffled().sorted(by: JSRules.localeLess), expected)
  }

  func testBoardListSortsActiveBoardsLikeTheWebClient() {
    let objects: [JSON] = [
      board("F00D", order: 0), board("default-board", order: 0), board("b3", order: 2),
      board("gone", order: -1, state: "deleted"), board("b-none", order: nil),
      .object(["id": .string("x"), "kind": .string("activity"), "state": .string("active")]),
    ]
    XCTAssertEqual(
      BoardList.active(objects).map(\.id), ["b-none", "default-board", "F00D", "b3"])
    XCTAssertEqual(BoardList.deleted(objects).map(\.id), ["gone"])
    XCTAssertEqual(BoardList.boards(objects, tripID: "t").map(\.id), ["b-none", "default-board", "F00D", "b3"])
    XCTAssertEqual(BoardList.currentID(objects, selected: "b3"), "b3")
    XCTAssertEqual(BoardList.currentID(objects, selected: "gone"), "b-none")
    XCTAssertEqual(BoardList.currentID(objects, selected: nil), "b-none")
    XCTAssertEqual(BoardList.nextOrder(BoardList.active(objects)), 3)
    XCTAssertEqual(BoardList.newTitle(BoardList.active(objects)), "白板 5")
  }

  func testTripWithoutBoardsShowsTheDefaultBoard() {
    let objects = [board("old", order: 0, state: "deleted")]
    let boards = BoardList.boards(objects, tripID: "trip")
    XCTAssertEqual(boards.map(\.id), ["default-board"])
    XCTAssertEqual(boards[0]["payload"]["title"], .string("主白板"))
    XCTAssertEqual(boards[0]["tripId"], .string("trip"))
    XCTAssertEqual(BoardList.currentID(objects, selected: nil), "default-board")
    XCTAssertEqual(BoardList.currentID(objects, selected: "old"), "old")
    XCTAssertEqual(BoardList.nextOrder([]), 1)
    XCTAssertEqual(BoardList.newTitle([]), "白板 1")
  }

  func testBoardPermissionsFollowTheServer() {
    func snapshot(_ mode: String, admin: Bool) -> JSON {
      .object([
        "trip": .object(["ownerId": .string("owner"), "teamMode": .string(mode)]),
        "members": .array([
          .object(["userId": .string("owner"), "isAdmin": .bool(true)]),
          .object(["userId": .string("me"), "isAdmin": .bool(admin)]),
        ]),
      ])
    }
    XCTAssertTrue(BoardList.canDelete(snapshot("equal", admin: false), userID: "owner"))
    XCTAssertFalse(BoardList.canDelete(snapshot("equal", admin: true), userID: "me"))
    XCTAssertTrue(BoardList.canDelete(snapshot("admin", admin: true), userID: "me"))
    XCTAssertFalse(BoardList.canDelete(snapshot("admin", admin: false), userID: "me"))
    XCTAssertTrue(BoardList.canRestore(snapshot("equal", admin: true), userID: "me"))
    XCTAssertFalse(BoardList.canRestore(snapshot("equal", admin: false), userID: "me"))
  }

  func testQueuedBoardItemOperationsStayOutOfTheMainSnapshot() {
    let snapshot: JSON = .object([
      "trip": .object(["id": .string("t")]), "objects": .array([]), "members": .array([]),
    ])
    let queue = [
      QueuedOperation(
        tripID: "t",
        body: .object([
          "id": .string("op1"), "objectId": .string("item"), "kind": .string("create"),
          "objectType": .string("boardItem"), "patch": .object(["boardId": .string("default-board")]),
        ])),
      QueuedOperation(
        tripID: "t",
        body: .object([
          "id": .string("op2"), "objectId": .string("board-2"), "kind": .string("create"),
          "objectType": .string("board"), "patch": .object(["title": .string("白板 2")]),
        ])),
    ]
    let objects = SnapshotProjection.apply(queue, to: snapshot, userID: "u")["objects"].array
    XCTAssertEqual(objects.map(\.id), ["board-2"])
  }
}

// MARK: - BoardStore against a mock server

private final class BoardMockProtocol: URLProtocol {
  static var handler: ((URLRequest, JSON) throws -> (Int, JSON))?
  static let lock = NSLock()
  static var log: [(method: String, path: String, body: JSON)] = []

  static func body(of request: URLRequest) -> JSON {
    var data = request.httpBody ?? Data()
    if data.isEmpty, let stream = request.httpBodyStream {
      stream.open()
      defer { stream.close() }
      var buffer = [UInt8](repeating: 0, count: 4096)
      while stream.hasBytesAvailable {
        let n = stream.read(&buffer, maxLength: buffer.count)
        if n <= 0 { break }
        data.append(buffer, count: n)
      }
    }
    return (try? JSONDecoder().decode(JSON.self, from: data)) ?? .null
  }
  static var requests: [(method: String, path: String, body: JSON)] {
    lock.lock()
    defer { lock.unlock() }
    return log
  }

  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func startLoading() {
    let body = Self.body(of: request)
    var path = request.url!.path
    if let query = request.url!.query { path += "?" + query }
    Self.lock.lock()
    Self.log.append((request.httpMethod ?? "GET", path, body))
    Self.lock.unlock()
    do {
      // A request still running from an earlier test finds no handler and fails.
      guard let handler = Self.handler else { throw URLError(.cancelled) }
      let (status, json) = try handler(request, body)
      let response = HTTPURLResponse(
        url: request.url!, statusCode: status, httpVersion: nil,
        headerFields: ["Content-Type": "application/json"])!
      client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
      client?.urlProtocol(self, didLoad: try JSONEncoder().encode(json))
      client?.urlProtocolDidFinishLoading(self)
    } catch { client?.urlProtocol(self, didFailWithError: error) }
  }
  override func stopLoading() {}
}

/// A small board server: items of `default-board` on trip `trip`, a cursor and an epoch,
/// with switches for the answers a test needs.
private final class BoardMockServer {
  var items: [String: JSON] = [:]
  var cursor = 5.0
  var epoch = 1.0
  var offline = false
  /// Operation uploads fail while item reads still work.
  var operationsOffline = false
  /// An answer for the next operation instead of the default receipt.
  var nextOperation: ((JSON) -> (Int, JSON))?
  /// An answer for the next items request instead of the real one.
  var nextItems: ((URLRequest) -> JSON)?
  let snapshot: JSON = .object([
    "trip": .object([
      "id": .string("trip"), "ownerId": .string("board-user"), "teamMode": .string("equal"),
      "state": .string("active"), "generation": .integer(0),
    ]),
    "objects": .array([
      .object([
        "id": .string("default-board"), "tripId": .string("trip"), "kind": .string("board"),
        "payload": .object(["title": .string("主白板"), "order": .number(0), "background": .string("dots")]),
        "state": .string("active"), "generation": .integer(0),
      ])
    ]),
    "members": .array([.object(["userId": .string("board-user"), "isAdmin": .bool(true)])]),
    "cursor": .integer(1), "epoch": .integer(1),
  ])

  func object(_ id: String, x: Double, text: String, state: String = "active", generation: Double = 0)
    -> JSON
  {
    .object([
      "id": .string(id), "kind": .string("boardItem"), "state": .string(state),
      "generation": .number(generation), "clocks": .object([:]), "changedCursor": .number(cursor),
      "payload": .object([
        "boardId": .string("default-board"),
        "frame": .object([
          "x": .number(x), "y": .number(20), "w": .number(160), "h": .number(120),
          "rotation": .number(0), "scale": .number(1),
        ]),
        "z": .number(1), "content": .object(["type": .string("note"), "text": .string(text)]),
        "style": .object(["color": .string("yellow")]), "linkedActivityId": .null,
        "createdBy": .string("board-user"),
      ]),
    ])
  }
  func put(_ item: JSON) { items[item["id"].string] = item }

  func handle(_ request: URLRequest, _ body: JSON) throws -> (Int, JSON) {
    let path = request.url!.path
    if offline { throw URLError(.notConnectedToInternet) }
    switch path {
    case "/api/auth/login":
      return (200, .object(["user": .object(["id": .string("board-user")]), "csrfToken": .string("csrf")]))
    case "/api/trips": return (200, .object(["trips": .array([])]))
    case "/api/clock":
      let now = Date().timeIntervalSince1970 * 1000
      return (
        200,
        .object([
          "leaseId": .string("lease"), "serverTime": .number(now), "expiresAt": .number(now + 86_400_000),
        ])
      )
    case "/api/trips/trip": return (200, snapshot)
    case "/api/trips/trip/operations":
      if operationsOffline { throw URLError(.notConnectedToInternet) }
      if let next = nextOperation {
        nextOperation = nil
        return next(body)
      }
      cursor += 1
      if body["objectType"].string == "boardItem" {
        let id = body["objectId"].string
        if body["kind"].string == "create" {
          var item = object(id, x: 0, text: "")
          item["payload"] = body["patch"]
          item["changedCursor"] = .number(cursor)
          put(item)
        } else if var item = items[id] {
          if body["kind"].string == "patch" {
            for (k, v) in body["patch"].dictionary { item["payload"][k] = v }
          } else {
            item["state"] = .string(body["kind"].string == "delete" ? "deleted" : "active")
            item["generation"] = .number(item["generation"].number + 1)
          }
          item["changedCursor"] = .number(cursor)
          put(item)
        }
        return (
          200,
          .object([
            "receipt": .object([
              "operationId": body["id"], "changed": .bool(true), "cursor": .number(cursor),
            ])
          ])
        )
      }
      return (
        200, .object(["snapshot": snapshot, "receipt": .object(["operationId": body["id"]])])
      )
    case "/api/trips/trip/boards/default-board/items":
      if let next = nextItems {
        nextItems = nil
        return (200, next(request))
      }
      let since = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems?
        .first { $0.name == "since" }?.value.flatMap(Double.init)
      let rows = items.values.filter { since == nil || $0["changedCursor"].number > since! }
        .sorted { $0["changedCursor"].number < $1["changedCursor"].number }
      return (200, .object(["items": .array(rows), "cursor": .number(cursor), "epoch": .number(epoch)]))
    default:
      return (404, .object(["error": .object(["code": .string("NOT_FOUND"), "message": .string(path)])]))
    }
  }
}

extension BoardSyncTests {
  @MainActor private func signedIn(_ server: BoardMockServer, directory: URL) async throws
    -> JourneyStore
  {
    let config = URLSessionConfiguration.ephemeral
    config.protocolClasses = [BoardMockProtocol.self]
    BoardMockProtocol.log = []
    BoardMockProtocol.handler = { try server.handle($0, $1) }
    let store = JourneyStore(
      urlSession: URLSession(configuration: config), serverURL: "https://journey-board-test.invalid",
      storageDirectory: directory)
    try await store.login(identifier: "board", password: "password", name: "", register: false)
    store.stopPolling()
    store.selectedTrip = "trip"
    store.accept(server.snapshot)
    return store
  }

  @MainActor private func eventually(
    _ message: String, timeout: Double = 3, _ condition: () -> Bool
  ) async throws {
    let deadline = Date().addingTimeInterval(timeout)
    while !condition() {
      if Date() > deadline {
        XCTFail("Timed out: \(message)")
        return
      }
      try await Task.sleep(for: .milliseconds(10))
    }
  }

  private func temporaryDirectory() -> URL {
    FileManager.default.temporaryDirectory.appendingPathComponent("board-" + UUID().uuidString)
  }

  private var itemRequests: [String] {
    BoardMockProtocol.requests.filter { $0.path.contains("/boards/") }.map(\.path)
  }

  @MainActor func testOpeningABoardReadsItAndKeepsTheCacheForTheNextIncrementalRead() async throws {
    let server = BoardMockServer()
    let directory = temporaryDirectory()
    defer {
      BoardMockProtocol.handler = nil
      try? FileManager.default.removeItem(at: directory)
    }
    server.put(server.object("a", x: 10, text: "集合"))
    let store = try await signedIn(server, directory: directory)
    XCTAssertEqual(store.boardList.map(\.id), ["default-board"])
    await store.boards.open(store.currentBoardID(selected: nil))
    XCTAssertFalse(store.boards.loading)
    XCTAssertEqual(store.boards.items.map(\.id), ["a"])
    XCTAssertEqual(store.boards.items[0]["frame"]["x"], .number(10))
    XCTAssertEqual(store.boards.items[0]["boardId"], .string("default-board"))
    XCTAssertEqual(store.boards.items[0]["locked"], .bool(false))
    XCTAssertEqual(store.boards.cursor, 5)
    XCTAssertEqual(store.boards.epoch, 1)
    XCTAssertEqual(itemRequests, ["/api/trips/trip/boards/default-board/items"])
    let cacheFile = try XCTUnwrap(store.boardCacheDirectory())
      .appending(path: "trip/default-board.json")
    XCTAssertTrue(FileManager.default.fileExists(atPath: cacheFile.path))

    // Reopened: the cached copy shows at once and only the changes are read.
    store.boards.close()
    server.cursor = 6
    server.put(server.object("b", x: 300, text: "午饭"))
    await store.boards.open("default-board")
    XCTAssertEqual(store.boards.items.map(\.id), ["a", "b"])
    XCTAssertEqual(itemRequests.last, "/api/trips/trip/boards/default-board/items?since=5")
    XCTAssertEqual(store.boards.cursor, 6)

    // The server restarted (new epoch): the cursor is dropped and the board read in full.
    store.boards.close()
    server.epoch = 2
    server.cursor = 2
    server.items.removeValue(forKey: "a")
    await store.boards.open("default-board")
    XCTAssertEqual(Array(itemRequests.suffix(2)), [
      "/api/trips/trip/boards/default-board/items?since=6",
      "/api/trips/trip/boards/default-board/items",
    ])
    XCTAssertEqual(store.boards.items.map(\.id), ["b"])
    XCTAssertEqual(store.boards.epoch, 2)
    XCTAssertEqual(store.boards.cursor, 2)
  }

  @MainActor func testRefreshMergesChangesDropsStaleAnswersAndRereadsAfterANewEpoch() async throws {
    let server = BoardMockServer()
    let directory = temporaryDirectory()
    defer {
      BoardMockProtocol.handler = nil
      try? FileManager.default.removeItem(at: directory)
    }
    server.put(server.object("a", x: 10, text: "集合"))
    server.put(server.object("b", x: 300, text: "午饭"))
    let store = try await signedIn(server, directory: directory)
    await store.boards.open("default-board")

    server.cursor = 7
    server.put(server.object("a", x: 99, text: "集合"))
    await store.boards.refresh()
    XCTAssertEqual(itemRequests.last, "/api/trips/trip/boards/default-board/items?since=5")
    XCTAssertEqual(store.boards.items.map(\.id), ["a", "b"])
    XCTAssertEqual(store.boards.items[0]["frame"]["x"], .number(99))
    XCTAssertEqual(store.boards.cursor, 7)

    // An answer older than the board on screen (same epoch, smaller cursor) is dropped.
    server.nextItems = { _ in
      .object([
        "items": .array([server.object("a", x: 10, text: "旧")]), "cursor": .number(6),
        "epoch": .number(1),
      ])
    }
    await store.boards.refresh()
    XCTAssertEqual(store.boards.items[0]["frame"]["x"], .number(99))
    XCTAssertEqual(store.boards.cursor, 7)

    // A new epoch: the incremental answer is not the whole board; read it in full.
    server.epoch = 3
    server.cursor = 1
    server.items = [:]
    server.put(server.object("c", x: 5, text: "新"))
    server.nextItems = { _ in .object(["items": .array([]), "cursor": .number(1), "epoch": .number(3)]) }
    await store.boards.refresh()
    XCTAssertEqual(Array(itemRequests.suffix(2)), [
      "/api/trips/trip/boards/default-board/items?since=7",
      "/api/trips/trip/boards/default-board/items",
    ])
    XCTAssertEqual(store.boards.items.map(\.id), ["c"])
    XCTAssertEqual(store.boards.epoch, 3)
  }

  @MainActor func testOperationsQueueOfflineReplayAndAcceptReceiptOnlyAnswers() async throws {
    let server = BoardMockServer()
    let directory = temporaryDirectory()
    defer {
      BoardMockProtocol.handler = nil
      try? FileManager.default.removeItem(at: directory)
    }
    server.put(server.object("a", x: 10, text: "集合"))
    let store = try await signedIn(server, directory: directory)
    await store.boards.open("default-board")

    server.offline = true
    let note = try await store.boards.add(
      .object([
        "content": .object(["type": .string("note"), "text": .string("原生便签")]),
        "style": .object(["color": .string("green")]),
        "frame": .object([
          "x": .number(40), "y": .number(60), "w": .number(160), "h": .number(160),
          "rotation": .number(0), "scale": .number(1),
        ]),
        "z": .number(2),
      ]))
    let id = note["id"].string
    try await store.boards.patch(id, .object(["frame": .object(["x": .number(80), "y": .number(90), "w": .number(160), "h": .number(160)])]))
    try await store.boards.patch(id, .object(["style": .object(["color": .string("pink")]), "locked": .bool(true)]))
    try await eventually("the first upload attempt fails") {
      store.cache.queue.first?.receiptUnknown == true
    }
    // Waiting offline: shown on the board, kept out of the main snapshot.
    XCTAssertEqual(store.cache.queue.count, 3)
    XCTAssertEqual(store.boards.activeItems.map(\.id), ["a", id])
    let local = store.boards.items[1]
    XCTAssertEqual(local["frame"]["x"], .number(80))
    XCTAssertEqual(local["style"], .object(["color": .string("pink"), "locked": .bool(true)]))
    XCTAssertEqual(local["locked"], .bool(true))
    XCTAssertFalse(store.objects.contains { $0.id == id })
    XCTAssertEqual(store.trip.id, "trip")

    // Each operation carries the board item type and only the groups it changes.
    let bodies = store.cache.queue.map(\.body)
    XCTAssertEqual(bodies.map { $0["kind"].string }, ["create", "patch", "patch"])
    XCTAssertTrue(bodies.allSatisfy { $0["objectType"].string == "boardItem" && $0["objectId"].string == id })
    XCTAssertEqual(
      Set(bodies[0]["patch"].dictionary.keys),
      ["boardId", "content", "style", "frame", "z", "linkedActivityId"])
    XCTAssertEqual(bodies[0]["patch"]["boardId"], .string("default-board"))
    XCTAssertEqual(bodies[0]["patch"]["linkedActivityId"], .null)
    XCTAssertEqual(
      bodies[1]["patch"],
      .object([
        "frame": .object([
          "x": .number(80), "y": .number(90), "w": .number(160), "h": .number(160),
          "rotation": .number(0), "scale": .number(1),
        ])
      ]))
    XCTAssertEqual(
      bodies[2]["patch"], .object(["style": .object(["color": .string("pink"), "locked": .bool(true)])]))

    // Back online: the same operations upload in order, answered with receipts only.
    server.offline = false
    await store.retryPending()
    try await eventually("the queue drains") { store.cache.queue.isEmpty }
    XCTAssertNil(store.error)
    let posted = BoardMockProtocol.requests.filter { $0.path.hasSuffix("/operations") }.map(\.body)
    XCTAssertEqual(Array(posted.suffix(3)).map { $0["id"] }, bodies.map { $0["id"] })
    // After its own operations the board reads what changed.
    try await eventually("the board reads the accepted changes") {
      store.boards.items.first { $0["id"].string == id }?["payload"]["style"]["color"] == .string("pink")
    }
    XCTAssertEqual(server.items[id]?["payload"]["frame"]["x"], .number(80))
    XCTAssertEqual(store.boards.items.map(\.id), ["a", id])
  }

  @MainActor func testPendingChangeSurvivesAnOlderServerCopy() async throws {
    let server = BoardMockServer()
    let directory = temporaryDirectory()
    defer {
      BoardMockProtocol.handler = nil
      try? FileManager.default.removeItem(at: directory)
    }
    server.put(server.object("a", x: 10, text: "集合"))
    let store = try await signedIn(server, directory: directory)
    await store.boards.open("default-board")
    var clock = 1_000_000.0
    store.boards.now = { clock }
    let move: JSON = .object([
      "frame": .object(["x": .number(40), "y": .number(20), "w": .number(160), "h": .number(120)])
    ])

    server.operationsOffline = true
    try await store.boards.patch("a", move)
    try await eventually("the upload waits") { store.cache.queue.first?.receiptUnknown == true }
    // A peer changed the text first: the server copy of `a` still has the old position.
    server.cursor = 6
    server.put(server.object("a", x: 10, text: "集合（同伴改过）"))
    await store.boards.refresh()
    XCTAssertEqual(store.boards.items[0]["frame"]["x"], .number(40))
    XCTAssertEqual(store.boards.items[0]["content"]["text"], .string("集合"))
    XCTAssertNotNil(store.boards.pending["a"])
    // A read that does not return `a` keeps the local copy, which shows the move, so the
    // change counts as seen (the web client does the same).
    server.cursor = 7
    server.put(server.object("b", x: 300, text: "午饭"))
    await store.boards.refresh()
    XCTAssertEqual(store.boards.items.map(\.id), ["a", "b"])
    XCTAssertEqual(store.boards.items[0]["frame"]["x"], .number(40))
    XCTAssertNil(store.boards.pending["a"])

    // Uploaded later: the server keeps the peer's text and this device's move.
    server.operationsOffline = false
    await store.retryPending()
    try await eventually("the move is accepted") { store.cache.queue.isEmpty }
    await store.boards.refresh()
    XCTAssertEqual(store.boards.items[0]["frame"]["x"], .number(40))
    XCTAssertEqual(store.boards.items[0]["content"]["text"], .string("集合（同伴改过）"))

    // A change the server never shows (a peer won) gives way after PENDING_TTL.
    server.operationsOffline = true
    try await store.boards.patch("b", .object(["z": .number(9)]))
    try await eventually("the upload waits") { store.cache.queue.first?.receiptUnknown == true }
    server.cursor += 1
    server.put(server.object("b", x: 300, text: "午饭"))
    await store.boards.refresh()
    XCTAssertEqual(store.boards.items[1]["z"], .number(9))
    XCTAssertNotNil(store.boards.pending["b"])
    clock += BoardPending.ttl + 1
    server.cursor += 1
    server.put(server.object("b", x: 300, text: "午饭"))
    await store.boards.refresh()
    XCTAssertEqual(store.boards.items[1]["z"], .number(1))
    XCTAssertTrue(store.boards.pending.isEmpty)
  }

  @MainActor func testStaleDeleteAndRestoreAnsweredUnchangedCountAsDone() async throws {
    let server = BoardMockServer()
    let directory = temporaryDirectory()
    defer {
      BoardMockProtocol.handler = nil
      try? FileManager.default.removeItem(at: directory)
    }
    server.put(server.object("a", x: 10, text: "集合"))
    server.put(server.object("b", x: 300, text: "午饭", state: "deleted", generation: 1))
    let store = try await signedIn(server, directory: directory)
    await store.boards.open("default-board")
    XCTAssertEqual(store.boards.deletedItems.map(\.id), ["b"])

    // A peer deleted `a` and restored `b` first; these requests carry older generations.
    for (id, state) in [("a", "deleted"), ("b", "active")] {
      server.nextOperation = { body in
        XCTAssertEqual(body["objectType"], .string("boardItem"))
        XCTAssertEqual(body["generation"], id == "a" ? .number(0) : .number(1))
        return (
          200,
          .object([
            "receipt": .object([
              "operationId": body["id"], "changed": .bool(false), "ignored": .array([]), "cursor": .number(5),
            ])
          ])
        )
      }
      if state == "deleted" { try await store.boards.delete(id) } else { try await store.boards.restore(id) }
      try await eventually("\(id) is acknowledged") { store.cache.queue.isEmpty }
      XCTAssertNil(store.error)
      XCTAssertEqual(store.boards.items.first { $0["id"].string == id }?["state"], .string(state))
    }
    XCTAssertEqual(store.boards.activeItems.map(\.id), ["b"])
    XCTAssertEqual(store.boards.deletedItems.map(\.id), ["a"])
    XCTAssertEqual(store.status, "已同步")
  }

  @MainActor func testBoardFullIsShownAndDiscardingRereadsTheBoard() async throws {
    let server = BoardMockServer()
    let directory = temporaryDirectory()
    defer {
      BoardMockProtocol.handler = nil
      try? FileManager.default.removeItem(at: directory)
    }
    server.put(server.object("a", x: 10, text: "集合"))
    let store = try await signedIn(server, directory: directory)
    await store.boards.open("default-board")
    server.nextOperation = { _ in
      (
        409,
        .object([
          "error": .object(["code": .string("BOARD_FULL"), "message": .string("每块白板最多添加 2000 个对象")])
        ])
      )
    }
    let note = try await store.boards.add(
      .object([
        "content": .object(["type": .string("note"), "text": .string("第 2001 个")]),
        "style": .object(["color": .string("yellow")]),
        "frame": .object(["x": .number(0), "y": .number(0), "w": .number(160), "h": .number(160)]),
      ]))
    try await eventually("the board is full") { store.cache.queue.first?.blocked == "BOARD_FULL" }
    XCTAssertEqual(store.error, "每块白板最多添加 2000 个对象")
    XCTAssertEqual(store.boards.activeItems.map(\.id), ["a", note["id"].string])

    // Giving the change up: the board no longer shows it once read again in full.
    try store.discard("trip")
    try await eventually("the board is read again") {
      store.boards.tripID == "trip" && !store.boards.loading
        && store.boards.items.map(\.id) == ["a"]
    }
    XCTAssertEqual(itemRequests.last, "/api/trips/trip/boards/default-board/items")
  }

  @MainActor func testBoardClosesWhenTheTripOrAccountChanges() async throws {
    let server = BoardMockServer()
    let directory = temporaryDirectory()
    defer {
      BoardMockProtocol.handler = nil
      try? FileManager.default.removeItem(at: directory)
    }
    server.put(server.object("a", x: 10, text: "集合"))
    let store = try await signedIn(server, directory: directory)
    await store.boards.open("default-board")
    XCTAssertEqual(store.boards.items.count, 1)
    store.selectedTrip = "another"
    XCTAssertEqual(store.boards.tripID, "")
    XCTAssertTrue(store.boards.items.isEmpty)
    await store.boards.refresh()
    XCTAssertEqual(itemRequests.count, 1)
    store.selectedTrip = "trip"
    await store.boards.open("default-board")
    XCTAssertEqual(store.boards.items.count, 1)
    store.user = .object(["id": .string("someone-else")])
    XCTAssertTrue(store.boards.items.isEmpty)
  }

  @MainActor func testBoardOperationsUseTheWebClientRules() async throws {
    let server = BoardMockServer()
    let directory = temporaryDirectory()
    defer {
      BoardMockProtocol.handler = nil
      try? FileManager.default.removeItem(at: directory)
    }
    let store = try await signedIn(server, directory: directory)
    let id = try await store.createBoard()
    try await eventually("the board is created") {
      BoardMockProtocol.requests.contains { $0.body["objectId"].string == id }
    }
    let body = try XCTUnwrap(BoardMockProtocol.requests.last { $0.body["objectId"].string == id }?.body)
    XCTAssertEqual(body["objectType"], .string("board"))
    XCTAssertEqual(body["kind"], .string("create"))
    XCTAssertEqual(body["patch"], .object(["title": .string("白板 2"), "order": .number(1)]))
    XCTAssertTrue(store.canDeleteBoard)
    // The last board is never deleted.
    try await store.deleteBoard(store.boardList[0])
    XCTAssertFalse(BoardMockProtocol.requests.contains { $0.body["kind"].string == "delete" })
  }
}

// MARK: - Against the local acceptance server

extension BoardSyncTests {
  /// Run with the local server (`node mobile/tools/dev-server.mjs --seed`) and its
  /// fixture passed as TEST_RUNNER_JOURNEY_TEST_BASE_URL, _IDENTIFIER, _PASSWORD and
  /// _TRIP_ID. TEST_RUNNER_JOURNEY_TEST_WEB_NOTE names a note the web client wrote on the
  /// trip's board, which this client must read back. The test leaves the note
  /// 「原生写的便签」 on the board for the web client to show.
  @MainActor func testBoardRoundTripWithTheLocalServer() async throws {
    let env = ProcessInfo.processInfo.environment
    guard let base = env["JOURNEY_TEST_BASE_URL"], let identifier = env["JOURNEY_TEST_IDENTIFIER"],
      let password = env["JOURNEY_TEST_PASSWORD"], let tripID = env["JOURNEY_TEST_TRIP_ID"]
    else { throw XCTSkip("JOURNEY_TEST_BASE_URL and the fixture account are not set") }
    let directory = temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: directory) }
    let store = JourneyStore(serverURL: base, storageDirectory: directory)
    try await store.login(identifier: identifier, password: password, name: "", register: false)
    store.stopPolling()
    try await store.open(tripID)
    let boardID = store.currentBoardID(selected: nil)
    await store.boards.open(boardID)
    XCTAssertNotNil(store.boards.epoch)

    // Web → native: the note written in the browser is read and normalized.
    if let text = env["JOURNEY_TEST_WEB_NOTE"] {
      let note = try XCTUnwrap(
        store.boards.activeItems.first { $0["content"]["text"].string == text },
        "the web note 「\(text)」 is on the board")
      for key in ["boardId", "frame", "z", "content", "style", "linkedActivityId", "createdBy"] {
        XCTAssertEqual(note[key], note["payload"][key], key)
      }
      XCTAssertEqual(note["boardId"], .string(boardID))
      XCTAssertEqual(note["locked"], .bool(note["style"]["locked"].bool))
    }

    // Native → server: create, move, recolor and lock a note; delete a second one.
    let created = try await store.boards.add(
      .object([
        "content": .object(["type": .string("note"), "text": .string("原生写的便签")]),
        "style": .object(["color": .string("blue")]),
        "frame": .object([
          "x": .number(40), "y": .number(40), "w": .number(200), "h": .number(160),
          "rotation": .number(0), "scale": .number(1),
        ]),
        "z": .number(BoardItemsTestSupport.topZ(store.boards.activeItems) + 1),
      ]))
    let id = created["id"].string
    try await store.boards.patch(id, .object(["frame": .object(["x": .number(320), "y": .number(60), "w": .number(220), "h": .number(170)])]))
    try await store.boards.patch(id, .object(["style": .object(["color": .string("green")]), "locked": .bool(true)]))
    let temporary = try await store.boards.add(
      .object([
        "content": .object(["type": .string("text"), "text": .string("原生临时文字")]),
        "style": .object(["size": .string("body")]),
        "frame": .object(["x": .number(40), "y": .number(260), "w": .number(200), "h": .number(60)]),
        "z": .number(BoardItemsTestSupport.topZ(store.boards.activeItems) + 1),
      ]))
    try await store.boards.delete(temporary["id"].string)
    try await eventually("the native operations upload", timeout: 15) {
      store.cache.queue.isEmpty && store.boards.pending.isEmpty
    }
    XCTAssertNil(store.error)

    // A peer deletes and restores first; this device's older requests are no-ops.
    let peer = JourneyStore(
      urlSession: URLSession(configuration: .ephemeral), serverURL: base,
      storageDirectory: directory.appending(path: "peer"))
    try await peer.login(identifier: identifier, password: password, name: "", register: false)
    peer.stopPolling()
    try await peer.open(tripID)
    await peer.boards.open(boardID)
    let stale = try await store.boards.add(
      .object([
        "content": .object(["type": .string("emoji"), "char": .string("🧭")]),
        "frame": .object(["x": .number(560), "y": .number(260), "w": .number(80), "h": .number(80)]),
        "z": .number(BoardItemsTestSupport.topZ(store.boards.activeItems) + 1),
      ]))
    try await eventually("the emoji uploads", timeout: 15) { store.cache.queue.isEmpty }
    await peer.boards.refresh()
    try await peer.boards.delete(stale["id"].string)
    try await eventually("the peer deletes", timeout: 15) { peer.cache.queue.isEmpty }
    try await store.boards.delete(stale["id"].string)
    try await eventually("the stale delete is acknowledged", timeout: 15) { store.cache.queue.isEmpty }
    XCTAssertNil(store.error)
    await peer.boards.refresh()
    try await peer.boards.restore(stale["id"].string)
    try await eventually("the peer restores", timeout: 15) { peer.cache.queue.isEmpty }
    try await store.boards.restore(stale["id"].string)
    try await eventually("the stale restore is acknowledged", timeout: 15) {
      store.cache.queue.isEmpty
    }
    XCTAssertNil(store.error)
    XCTAssertNil(peer.error)

    // The server holds what this client sent.
    let answer = try await store.api("/api/trips/\(tripID)/boards/\(boardID)/items")
    let rows = Dictionary(uniqueKeysWithValues: answer["items"].array.map { ($0["id"].string, $0) })
    let note = try XCTUnwrap(rows[id])
    XCTAssertEqual(note["state"], .string("active"))
    XCTAssertEqual(note["payload"]["frame"]["x"], .number(320))
    XCTAssertEqual(note["payload"]["style"], .object(["color": .string("green"), "locked": .bool(true)]))
    XCTAssertEqual(rows[temporary["id"].string]?["state"], .string("deleted"))
    XCTAssertEqual(rows[stale["id"].string]?["state"], .string("active"))
    XCTAssertEqual(rows[stale["id"].string]?["generation"], .number(2))
    // …and both clients read the same board.
    await store.boards.refresh()
    await peer.boards.refresh()
    XCTAssertEqual(
      Set(store.boards.activeItems.map(\.id)), Set(peer.boards.activeItems.map(\.id)))
  }
}

private enum BoardItemsTestSupport {
  static func topZ(_ items: [JSON]) -> Double { items.map { $0["z"].number }.max() ?? 0 }
}

private let webCases = #"""
{
  "normalize": [
    [{"id":"n1","kind":"boardItem","state":"active","generation":2,"changedCursor":5,"clocks":{},"payload":{"boardId":"default-board","frame":{"x":10,"y":20,"w":160,"h":120,"rotation":0,"scale":1},"z":3,"content":{"type":"note","text":"集合","html":"<b>集合</b>"},"style":{"color":"yellow","locked":true},"linkedActivityId":null,"createdBy":"u1"}},{"id":"n1","kind":"boardItem","state":"active","generation":2,"changedCursor":5,"clocks":{},"payload":{"boardId":"default-board","frame":{"x":10,"y":20,"w":160,"h":120,"rotation":0,"scale":1},"z":3,"content":{"type":"note","text":"集合","html":"<b>集合</b>"},"style":{"color":"yellow","locked":true},"linkedActivityId":null,"createdBy":"u1"},"boardId":"default-board","frame":{"x":10,"y":20,"w":160,"h":120,"rotation":0,"scale":1},"z":3,"content":{"type":"note","text":"集合","html":"<b>集合</b>"},"style":{"color":"yellow","locked":true},"locked":true,"linkedActivityId":null,"createdBy":"u1"}],
    [{"id":"l1","boardId":"b","frame":{"x":0,"y":0,"w":50,"h":50,"rotation":0,"scale":1},"z":0,"content":{"type":"emoji","char":"🎉"},"style":{},"state":"active"},{"id":"l1","boardId":"b","frame":{"x":0,"y":0,"w":50,"h":50,"rotation":0,"scale":1},"z":0,"content":{"type":"emoji","char":"🎉"},"style":{},"state":"active","locked":false,"linkedActivityId":null}],
    [{"id":"p1","payload":{"boardId":"b"},"state":"active"},{"id":"p1","payload":{"boardId":"b","frame":{"x":0,"y":0,"w":100,"h":100,"rotation":0,"scale":1},"z":0,"content":{},"style":{},"linkedActivityId":null},"state":"active","boardId":"b","frame":{"x":0,"y":0,"w":100,"h":100,"rotation":0,"scale":1},"z":0,"content":{},"style":{},"locked":false,"linkedActivityId":null}],
    [{"id":"t1","style":{"color":"pink"},"z":9,"payload":{"boardId":"b","style":{"color":"blue"},"z":1,"frame":{"x":1,"y":1,"w":1,"h":1}}},{"id":"t1","style":{"color":"pink"},"z":9,"payload":{"boardId":"b","style":{"color":"pink"},"z":9,"frame":{"x":1,"y":1,"w":1,"h":1},"content":{},"linkedActivityId":null},"boardId":"b","frame":{"x":1,"y":1,"w":1,"h":1},"content":{},"locked":false,"linkedActivityId":null}],
    [{"id":"k1","locked":1,"payload":{"style":{"color":"blue"}}},{"id":"k1","locked":true,"payload":{"style":{"color":"blue"},"frame":{"x":0,"y":0,"w":100,"h":100,"rotation":0,"scale":1},"z":0,"content":{},"linkedActivityId":null},"frame":{"x":0,"y":0,"w":100,"h":100,"rotation":0,"scale":1},"z":0,"content":{},"style":{"color":"blue"},"linkedActivityId":null}],
    [{"id":"k2","locked":true,"style":{"locked":false}},{"id":"k2","locked":false,"style":{"locked":false},"frame":{"x":0,"y":0,"w":100,"h":100,"rotation":0,"scale":1},"z":0,"content":{},"linkedActivityId":null}],
    [{"id":"a1","linkedActivityId":null,"payload":{"linkedActivityId":"act-1"}},{"id":"a1","linkedActivityId":null,"payload":{"linkedActivityId":null,"frame":{"x":0,"y":0,"w":100,"h":100,"rotation":0,"scale":1},"z":0,"content":{},"style":{}},"frame":{"x":0,"y":0,"w":100,"h":100,"rotation":0,"scale":1},"z":0,"content":{},"style":{},"locked":false}],
    [{"id":"a2","payload":{"linkedActivityId":"act-1"}},{"id":"a2","payload":{"linkedActivityId":"act-1","frame":{"x":0,"y":0,"w":100,"h":100,"rotation":0,"scale":1},"z":0,"content":{},"style":{}},"frame":{"x":0,"y":0,"w":100,"h":100,"rotation":0,"scale":1},"z":0,"content":{},"style":{},"locked":false,"linkedActivityId":"act-1"}],
    [{"id":"a3","payload":{"linkedActivityId":null,"createdBy":null}},{"id":"a3","payload":{"linkedActivityId":null,"createdBy":null,"frame":{"x":0,"y":0,"w":100,"h":100,"rotation":0,"scale":1},"z":0,"content":{},"style":{}},"frame":{"x":0,"y":0,"w":100,"h":100,"rotation":0,"scale":1},"z":0,"content":{},"style":{},"locked":false,"linkedActivityId":null,"createdBy":null}],
    [{"id":"b1","boardId":null,"payload":{"z":null}},{"id":"b1","payload":{"z":0,"frame":{"x":0,"y":0,"w":100,"h":100,"rotation":0,"scale":1},"content":{},"style":{},"linkedActivityId":null},"frame":{"x":0,"y":0,"w":100,"h":100,"rotation":0,"scale":1},"z":0,"content":{},"style":{},"locked":false,"linkedActivityId":null}],
    [{"id":"b2","payload":{"boardId":null}},{"id":"b2","payload":{"boardId":null,"frame":{"x":0,"y":0,"w":100,"h":100,"rotation":0,"scale":1},"z":0,"content":{},"style":{},"linkedActivityId":null},"boardId":null,"frame":{"x":0,"y":0,"w":100,"h":100,"rotation":0,"scale":1},"z":0,"content":{},"style":{},"locked":false,"linkedActivityId":null}],
    [{"id":"q1","payload":null,"z":4},{"id":"q1","payload":null,"z":4,"frame":{"x":0,"y":0,"w":100,"h":100,"rotation":0,"scale":1},"content":{},"style":{},"locked":false,"linkedActivityId":null}]
  ],
  "clean": [
    [null,{}],
    ["text",{}],
    [[1,2],{}],
    [{"frame":{"x":1,"y":2,"w":3,"h":4,"extra":9}},{"frame":{"x":1,"y":2,"w":3,"h":4,"rotation":0,"scale":1}}],
    [{"frame":{"x":1,"y":2,"w":3,"h":4,"rotation":null,"scale":2}},{"frame":{"x":1,"y":2,"w":3,"h":4,"rotation":0,"scale":2}}],
    [{"frame":{"x":1}},{"frame":{"x":1,"rotation":0,"scale":1}}],
    [{"style":{"color":"pink","fill":"#fff","locked":"yes"},"locked":0},{"style":{"color":"pink","locked":false}}],
    [{"locked":true},{"style":{"locked":true}}],
    [{"style":{}},{"style":{}}],
    [{"style":null,"z":3,"content":{"type":"note","text":"x"},"linkedActivityId":null,"boardId":"b","createdBy":"u","state":"deleted"},{"z":3,"content":{"type":"note","text":"x"},"linkedActivityId":null}],
    [{"payload":{"frame":{"x":1,"y":1,"w":1,"h":1},"z":2,"style":{"color":"blue"}},"z":5},{"style":{"color":"blue"},"frame":{"x":1,"y":1,"w":1,"h":1,"rotation":0,"scale":1},"z":5}],
    [{"frame":null},{"frame":null}],
    [{"frame":5},{"frame":{"rotation":0,"scale":1}}],
    [{"z":0,"linkedActivityId":"act-2"},{"z":0,"linkedActivityId":"act-2"}]
  ],
  "patch": [
    [{"frame":{"x":40,"y":50,"w":160,"h":120}},false,{"cleaned":{"frame":{"x":40,"y":50,"w":160,"h":120,"rotation":0,"scale":1}},"updatedItem":{"id":"n1","kind":"boardItem","state":"active","generation":2,"changedCursor":5,"clocks":{},"payload":{"boardId":"default-board","frame":{"x":40,"y":50,"w":160,"h":120,"rotation":0,"scale":1},"z":3,"content":{"type":"note","text":"集合","html":"<b>集合</b>"},"style":{"color":"yellow","locked":true},"linkedActivityId":null,"createdBy":"u1"},"boardId":"default-board","frame":{"x":40,"y":50,"w":160,"h":120,"rotation":0,"scale":1},"z":3,"content":{"type":"note","text":"集合","html":"<b>集合</b>"},"style":{"color":"yellow","locked":true},"locked":true,"linkedActivityId":null,"createdBy":"u1","updatedAt":1700000000000}}],
    [{"style":{"color":"pink"}},false,{"cleaned":{"style":{"color":"pink","locked":true}},"updatedItem":{"id":"n1","kind":"boardItem","state":"active","generation":2,"changedCursor":5,"clocks":{},"payload":{"boardId":"default-board","frame":{"x":10,"y":20,"w":160,"h":120,"rotation":0,"scale":1},"z":3,"content":{"type":"note","text":"集合","html":"<b>集合</b>"},"style":{"color":"pink","locked":true},"linkedActivityId":null,"createdBy":"u1"},"boardId":"default-board","frame":{"x":10,"y":20,"w":160,"h":120,"rotation":0,"scale":1},"z":3,"content":{"type":"note","text":"集合","html":"<b>集合</b>"},"style":{"color":"pink","locked":true},"locked":true,"linkedActivityId":null,"createdBy":"u1","updatedAt":1700000000000}}],
    [{"style":{"size":"M"}},true,{"cleaned":{"style":{"size":"M"}},"updatedItem":{"id":"n1","kind":"boardItem","state":"active","generation":2,"changedCursor":5,"clocks":{},"payload":{"boardId":"default-board","frame":{"x":10,"y":20,"w":160,"h":120,"rotation":0,"scale":1},"z":3,"content":{"type":"note","text":"集合","html":"<b>集合</b>"},"style":{"size":"M"},"linkedActivityId":null,"createdBy":"u1"},"boardId":"default-board","frame":{"x":10,"y":20,"w":160,"h":120,"rotation":0,"scale":1},"z":3,"content":{"type":"note","text":"集合","html":"<b>集合</b>"},"style":{"size":"M"},"locked":true,"linkedActivityId":null,"createdBy":"u1","updatedAt":1700000000000}}],
    [{"locked":false},false,{"cleaned":{"style":{"color":"yellow","locked":false}},"updatedItem":{"id":"n1","kind":"boardItem","state":"active","generation":2,"changedCursor":5,"clocks":{},"payload":{"boardId":"default-board","frame":{"x":10,"y":20,"w":160,"h":120,"rotation":0,"scale":1},"z":3,"content":{"type":"note","text":"集合","html":"<b>集合</b>"},"style":{"color":"yellow","locked":false},"linkedActivityId":null,"createdBy":"u1"},"boardId":"default-board","frame":{"x":10,"y":20,"w":160,"h":120,"rotation":0,"scale":1},"z":3,"content":{"type":"note","text":"集合","html":"<b>集合</b>"},"style":{"color":"yellow","locked":false},"locked":false,"linkedActivityId":null,"createdBy":"u1","updatedAt":1700000000000}}],
    [{"content":{"type":"note","text":"改了"}},false,{"cleaned":{"content":{"type":"note","text":"改了"}},"updatedItem":{"id":"n1","kind":"boardItem","state":"active","generation":2,"changedCursor":5,"clocks":{},"payload":{"boardId":"default-board","frame":{"x":10,"y":20,"w":160,"h":120,"rotation":0,"scale":1},"z":3,"content":{"type":"note","text":"改了","html":"<b>集合</b>"},"style":{"color":"yellow","locked":true},"linkedActivityId":null,"createdBy":"u1"},"boardId":"default-board","frame":{"x":10,"y":20,"w":160,"h":120,"rotation":0,"scale":1},"z":3,"content":{"type":"note","text":"改了","html":"<b>集合</b>"},"style":{"color":"yellow","locked":true},"locked":true,"linkedActivityId":null,"createdBy":"u1","updatedAt":1700000000000}}],
    [{"z":7,"linkedActivityId":"act-9"},false,{"cleaned":{"z":7,"linkedActivityId":"act-9"},"updatedItem":{"id":"n1","kind":"boardItem","state":"active","generation":2,"changedCursor":5,"clocks":{},"payload":{"boardId":"default-board","frame":{"x":10,"y":20,"w":160,"h":120,"rotation":0,"scale":1},"z":7,"content":{"type":"note","text":"集合","html":"<b>集合</b>"},"style":{"color":"yellow","locked":true},"linkedActivityId":"act-9","createdBy":"u1"},"boardId":"default-board","frame":{"x":10,"y":20,"w":160,"h":120,"rotation":0,"scale":1},"z":7,"content":{"type":"note","text":"集合","html":"<b>集合</b>"},"style":{"color":"yellow","locked":true},"locked":true,"linkedActivityId":"act-9","createdBy":"u1","updatedAt":1700000000000}}]
  ]
}
"""#
