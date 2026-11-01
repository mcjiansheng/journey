import CoreLocation
import XCTest

@testable import Journey

final class JourneyTests: XCTestCase {
  func testCoordinates() {
    let w = CLLocationCoordinate2D(latitude: 32.0603, longitude: 118.7969)
    let gcj = Coordinates.gcj02(fromWGS: w)
    XCTAssertGreaterThan(abs(gcj.longitude - w.longitude), 0.001)
    let r = Coordinates.wgs84(fromGCJ: gcj)
    XCTAssertEqual(r.latitude, w.latitude, accuracy: 0.000001)
    XCTAssertEqual(r.longitude, w.longitude, accuracy: 0.000001)
  }
  func testOutsideChina() {
    let c = CLLocationCoordinate2D(latitude: 51.5074, longitude: -0.1278)
    XCTAssertEqual(Coordinates.wgs84(fromGCJ: c).latitude, c.latitude)
    XCTAssertEqual(Coordinates.wgs84(fromGCJ: c).longitude, c.longitude)
  }
  func testClockJumpIsUncertain() {
    let l = TimeLease(
      lease: .object([
        "leaseId": .string("l"), "serverTime": .number(1000), "expiresAt": .number(999999),
      ]), midpoint: 100, wall: 5000, uncertainty: 2)
    XCTAssertFalse(l.clock(uptime: 101, wallTime: 6000)["uncertain"].bool)
    XCTAssertTrue(l.clock(uptime: 101, wallTime: 10000)["uncertain"].bool)
  }
  func testMoney() throws {
    XCTAssertEqual(try Money.parse("123", currency: "JPY", paid: true), .number(123))
    XCTAssertThrowsError(try Money.parse("1.1", currency: "JPY", paid: true))
    XCTAssertEqual(try Money.parse("0", currency: "CNY", paid: true), .number(0))
    XCTAssertEqual(try Money.parse("", currency: "CNY", paid: false), .null)
    XCTAssertEqual(try Money.parse("10.25", currency: "CNY", paid: true), .number(1025))
    XCTAssertEqual(try Money.parse("1000", currency: "KRW", paid: true), .number(1000))
  }
  func testDatesUseCivilDaysAcrossDST() {
    let a = JourneyDate.date("2026-03-07")
    let b = JourneyDate.date("2026-03-10")
    XCTAssertEqual(JourneyDate.calendar.dateComponents([.day], from: a, to: b).day, 3)
    XCTAssertEqual(
      JourneyDate.string(JourneyDate.calendar.date(byAdding: .day, value: 3, to: a)!), "2026-03-10")
  }
  func testQueueRoundtripPreservesClockAndID() throws {
    let op = QueuedOperation(
      tripID: "trip",
      body: .object([
        "id": .string("stable-id"),
        "clock": .object(["leaseId": .string("old"), "elapsedMs": .number(123)]),
      ]), receiptUnknown: true)
    let r = try JSONDecoder().decode(QueuedOperation.self, from: JSONEncoder().encode(op))
    XCTAssertEqual(r, op)
    XCTAssertTrue(r.receiptUnknown)
  }
  func testPreciseTimeOrderingKeepsFlexibleSlot() {
    func row(_ id: String, _ rank: Int, _ time: String) -> JSON {
      .object([
        "id": .string(id), "kind": .string("activity"), "state": .string("active"),
        "payload": .object([
          "dayId": .string("day"), "order": .integer(rank),
          "time": .object([
            "mode": .string(time.isEmpty ? "flexible" : "precise"), "start": .string(time),
          ]),
        ]),
      ])
    }
    XCTAssertEqual(
      ActivityOrder.ordered(
        [row("late", 0, "14:00"), row("flex", 1024, ""), row("early", 2048, "09:00")], dayID: "day"
      ).map(\.id), ["early", "flex", "late"])
  }
  func testLifecycleProjectionKeepsGenerationForRestore() {
    let snapshot: JSON = .object([
      "trip": .object(["id": .string("t")]),
      "objects": .array([
        .object(["id": .string("a"), "state": .string("active"), "generation": .integer(2)])
      ]),
    ])
    let deleted = SnapshotProjection.apply(
      [
        QueuedOperation(
          tripID: "t", body: .object(["objectId": .string("a"), "kind": .string("delete")]))
      ], to: snapshot, userID: "u")
    XCTAssertEqual(deleted["objects"].array[0]["generation"], .integer(3))
    let restored = SnapshotProjection.apply(
      [
        QueuedOperation(
          tripID: "t", body: .object(["objectId": .string("a"), "kind": .string("restore")]))
      ], to: deleted, userID: "u")
    XCTAssertEqual(restored["objects"].array[0]["generation"], .integer(4))
  }
  @MainActor func testSnapshotCursorAndEpoch() {
    let store = JourneyStore()
    func snapshot(_ epoch: Int, _ cursor: Int) -> JSON {
      .object([
        "trip": .object(["id": .string("t")]), "objects": .array([]), "members": .array([]),
        "epoch": .integer(epoch), "cursor": .integer(cursor),
      ])
    }
    store.accept(snapshot(1, 5))
    store.accept(snapshot(1, 4))
    XCTAssertEqual(store.cache.snapshots["t"]?["cursor"], .integer(5))
    store.accept(snapshot(2, 1))
    store.accept(snapshot(1, 999))
    XCTAssertEqual(store.cache.snapshots["t"]?["cursor"], .integer(1))
  }
}

extension JourneyTests {
  func testEqualTeamExpressionProjectsMajorityDeletion() {
    let snap: JSON = .object([
      "trip": .object(["id": .string("t"), "teamMode": .string("equal")]),
      "members": .array([.object(["userId": .string("u")])]),
      "objects": .array([
        .object([
          "id": .string("a"), "kind": .string("activity"), "state": .string("active"),
          "generation": .integer(0), "expressions": .array([]),
        ])
      ]),
    ])
    let op = QueuedOperation(
      tripID: "t",
      body: .object([
        "kind": .string("express"), "objectId": .string("a"),
        "expression": .object(["wishDelete": .bool(true)]),
      ]))
    let result = SnapshotProjection.apply([op], to: snap, userID: "u")["objects"].array[0]
    XCTAssertEqual(result["state"], .string("deleted"))
    XCTAssertEqual(result["generation"], .integer(1))
  }
  func testRescheduleBuildsOutsideRangeDependencyDay() {
    let snap: JSON = .object([
      "trip": .object(["id": .string("t")]),
      "objects": .array([
        .object([
          "id": .string("a"), "kind": .string("activity"),
          "payload": .object(["dayId": .string("old")]),
        ])
      ]),
    ])
    let op = QueuedOperation(
      tripID: "t",
      body: .object([
        "kind": .string("reschedule"), "objectId": .string("t"),
        "patch": .object([
          "startDate": .string("2026-11-10"), "dayCount": .integer(3),
          "moves": .array([.object(["activityId": .string("a"), "ordinal": .integer(5)])]),
        ]),
      ]))
    let rows = SnapshotProjection.apply([op], to: snap, userID: "u")["objects"].array
    XCTAssertTrue(
      rows.contains { $0.id == "plan-day-t-date-2026-11-14" && $0["kind"].string == "day" })
    XCTAssertEqual(rows[0]["payload"]["dayId"], .string("plan-day-t-date-2026-11-14"))
  }
}

private final class JourneyMockProtocol: URLProtocol {
  static var handler: ((URLRequest) throws -> (Int, JSON))?
  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func startLoading() {
    do {
      let (status, body) = try Self.handler!(request)
      let response = HTTPURLResponse(
        url: request.url!, statusCode: status, httpVersion: nil,
        headerFields: ["Content-Type": "application/json"])!
      client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
      client?.urlProtocol(self, didLoad: try JSONEncoder().encode(body))
      client?.urlProtocolDidFinishLoading(self)
    } catch { client?.urlProtocol(self, didFailWithError: error) }
  }
  override func stopLoading() {}
}
extension JourneyTests {
  @MainActor
  func testUnknownReceiptRetriesOriginalOperationThenAllowsReapplyAfterDefinitiveRejection()
    async throws
  {
    let config = URLSessionConfiguration.ephemeral
    config.protocolClasses = [JourneyMockProtocol.self]
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer {
      try? FileManager.default.removeItem(at: directory)
      JourneyMockProtocol.handler = nil
    }
    let lock = NSLock()
    var submissions: [JSON] = []
    let snapshot: JSON = .object([
      "trip": .object(["id": .string("trip"), "teamMode": .string("equal")]), "objects": .array([]),
      "members": .array([]), "cursor": .integer(1), "epoch": .integer(1),
    ])
    JourneyMockProtocol.handler = { request in
      let path = request.url!.path
      if path == "/api/auth/login" {
        return (
          200,
          .object([
            "user": .object(["id": .string("test-user")]), "csrfToken": .string("test-csrf"),
          ])
        )
      }
      if path == "/api/trips" { return (200, .object(["trips": .array([])])) }
      if path == "/api/clock" {
        return (
          200,
          .object([
            "leaseId": .string(UUID().uuidString),
            "serverTime": .number(Date().timeIntervalSince1970 * 1000),
            "expiresAt": .number(Date().timeIntervalSince1970 * 1000 + 86_400_000),
          ])
        )
      }
      if path.hasSuffix("/operations") {
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
        let body = try JSONDecoder().decode(JSON.self, from: data)
        lock.lock()
        submissions.append(body)
        let count = submissions.count
        lock.unlock()
        if count == 1 {
          return (
            200,
            .object([
              "snapshot": snapshot, "receipt": .object(["operationId": .string("unrecognized")]),
            ])
          )
        }
        if count == 2 {
          return (
            409,
            .object([
              "error": .object(["code": .string("CLOCK_UNCERTAIN"), "message": .string("重新应用")])
            ])
          )
        }
        return (
          200, .object(["snapshot": snapshot, "receipt": .object(["operationId": body["id"]])])
        )
      }
      return (200, snapshot)
    }
    let store = JourneyStore(
      urlSession: URLSession(configuration: config),
      serverURL: "https://journey-native-test.invalid", storageDirectory: directory)
    try await store.login(identifier: "test", password: "password", name: "", register: false)
    store.selectedTrip = "trip"
    store.accept(snapshot)
    try await store.mutate(
      kind: "create", type: "expense", patch: .object(["title": .string("test")]))
    for _ in 0..<100 {
      if store.cache.queue.first?.receiptUnknown == true { break }
      try await Task.sleep(for: .milliseconds(10))
    }
    XCTAssertEqual(store.cache.queue.count, 1)
    XCTAssertTrue(store.cache.queue[0].receiptUnknown)
    await store.retryPending()
    XCTAssertEqual(store.cache.queue[0].blocked, "CLOCK_UNCERTAIN")
    XCTAssertFalse(store.cache.queue[0].receiptUnknown)
    try await store.reapply("trip")
    XCTAssertTrue(store.cache.queue.isEmpty)
    XCTAssertEqual(submissions.count, 3)
    XCTAssertEqual(submissions[0], submissions[1])
    XCTAssertNotEqual(submissions[1]["id"], submissions[2]["id"])
    XCTAssertEqual(submissions[0]["clock"], submissions[1]["clock"])
  }
}

extension JourneyTests {
  func testRouteSignatureMatchesWebFixtures() throws {
    let fixtureURL = try XCTUnwrap(
      Bundle(for: JourneyTests.self).url(forResource: "routes", withExtension: "json"))
    let fixtures = try JSONDecoder().decode(JSON.self, from: Data(contentsOf: fixtureURL)).array
    for fixture in fixtures {
      XCTAssertEqual(
        try RouteSignature.signature(
          from: fixture["from"], to: fixture["to"], mode: fixture["mode"].string),
        fixture["inputSignature"].string, fixture["name"].string)
    }
  }
}

extension JourneyTests {
  @MainActor func testCorruptOtherAccountCacheCannotExposePreviousAccount() async throws {
    let config = URLSessionConfiguration.ephemeral
    config.protocolClasses = [JourneyMockProtocol.self]
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    let baseURL = "https://journey-account-isolation.invalid"
    var loginCount = 0
    JourneyMockProtocol.handler = { request in
      if request.url!.path == "/api/auth/login" {
        loginCount += 1
        return (
          200,
          .object([
            "user": .object(["id": .string(loginCount == 1 ? "account-a" : "account-b")]),
            "csrfToken": .string("token"),
          ])
        )
      }
      if request.url!.path == "/api/trips" { return (200, .object(["trips": .array([])])) }
      return (
        200,
        .object([
          "leaseId": .string("lease"), "serverTime": .number(Date().timeIntervalSince1970 * 1000),
          "expiresAt": .number(Date().timeIntervalSince1970 * 1000 + 86_400_000),
        ])
      )
    }
    let store = JourneyStore(
      urlSession: URLSession(configuration: config), serverURL: baseURL, storageDirectory: directory
    )
    defer {
      store.stopPolling()
      JourneyMockProtocol.handler = nil
      try? FileManager.default.removeItem(at: directory)
    }
    try await store.login(identifier: "a", password: "p", name: "", register: false)
    store.cache.drafts["private-a"] = .string("private draft")
    store.cache.queue = [
      QueuedOperation(
        tripID: "a-trip", body: .object(["id": .string("a-operation")]), blocked: "CLOCK_UNCERTAIN")
    ]
    let key = Data(baseURL.utf8).base64EncodedString().replacingOccurrences(of: "/", with: "_")
    let file = directory.appendingPathComponent("Journey/\(key)/account-b.json")
    try FileManager.default.createDirectory(
      at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
    let corrupt = Data("corrupted account b cache".utf8)
    try corrupt.write(to: file)
    do {
      try await store.login(identifier: "b", password: "p", name: "", register: false)
      XCTFail("corrupt cache must fail")
    } catch { XCTAssertEqual((error as? APIError)?.code, "LOCAL_STORAGE") }
    XCTAssertTrue(store.user.isNull)
    XCTAssertTrue(store.cache.queue.isEmpty)
    XCTAssertTrue(store.cache.drafts.isEmpty)
    XCTAssertEqual(try Data(contentsOf: file), corrupt)
  }
}

extension JourneyTests {
  @MainActor func testTripDeletionUndoUsesDeletedGeneration() async throws {
    let config = URLSessionConfiguration.ephemeral
    config.protocolClasses = [JourneyMockProtocol.self]
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    JourneyMockProtocol.handler = { request in
      switch request.url!.path {
      case "/api/auth/login":
        return (
          200,
          .object(["user": .object(["id": .string("undo-user")]), "csrfToken": .string("token")])
        )
      case "/api/trips": return (200, .object(["trips": .array([])]))
      case "/api/clock":
        return (
          200,
          .object([
            "leaseId": .string("lease"), "serverTime": .number(Date().timeIntervalSince1970 * 1000),
            "expiresAt": .number(Date().timeIntervalSince1970 * 1000 + 86_400_000),
          ])
        )
      default: return (503, .object(["error": .object(["message": .string("offline")])]))
      }
    }
    let store = JourneyStore(
      urlSession: URLSession(configuration: config), serverURL: "https://journey-undo-test.invalid",
      storageDirectory: directory)
    defer {
      store.stopPolling()
      JourneyMockProtocol.handler = nil
      try? FileManager.default.removeItem(at: directory)
    }
    try await store.login(identifier: "undo", password: "password", name: "", register: false)
    store.selectedTrip = "trip"
    store.accept(
      .object([
        "trip": .object([
          "id": .string("trip"), "state": .string("active"), "generation": .integer(2),
        ]),
        "objects": .array([]), "members": .array([]), "epoch": .integer(1), "cursor": .integer(1),
      ]))
    store.deleteWithUndo(store.trip)
    for _ in 0..<100 {
      if store.undoDeletion != nil { break }
      try await Task.sleep(for: .milliseconds(10))
    }
    XCTAssertEqual(store.trip["state"].string, "deleted")
    XCTAssertEqual(store.trip["generation"], .integer(3))
    store.undoDelete()
    for _ in 0..<100 {
      if store.cache.queue.count == 2 { break }
      try await Task.sleep(for: .milliseconds(10))
    }
    XCTAssertEqual(store.cache.queue.count, 2)
    XCTAssertEqual(store.cache.queue.last?.body["kind"].string, "restore")
    XCTAssertEqual(store.cache.queue.last?.body["generation"], .integer(3))
    XCTAssertEqual(store.trip["state"].string, "active")
    XCTAssertNil(store.undoDeletion)
  }
}

extension JourneyTests {
  func testDestinationTimezoneDefaultsAndLocalChineseCities() {
    var selection = DestinationTimezoneSelection()
    XCTAssertEqual(selection.identifier, TimeZone.current.identifier)
    selection.changeDestination("北京", deviceTimezone: "Europe/London")
    XCTAssertEqual(selection.identifier, "Asia/Shanghai")
    selection.changeDestination("南京", deviceTimezone: "Europe/London")
    XCTAssertEqual(selection.identifier, "Asia/Shanghai")
    XCTAssertEqual(JourneyTimeZone.label(selection.identifier), "北京时间")
  }

  func testDestinationTimezoneRejectsStaleAndManualOverrides() {
    var selection = DestinationTimezoneSelection(identifier: "Asia/Shanghai")
    selection.changeDestination("unlisted-first", deviceTimezone: "Europe/London")
    let oldRevision = selection.revision
    selection.resolve("Asia/Tokyo", revision: oldRevision)
    XCTAssertEqual(selection.identifier, "Asia/Tokyo")
    selection.changeDestination("unlisted-second", deviceTimezone: "Europe/London")
    XCTAssertEqual(selection.identifier, "Europe/London")
    selection.resolve("America/New_York", revision: oldRevision)
    XCTAssertEqual(selection.identifier, "Europe/London")
    let currentRevision = selection.revision
    selection.choose("Europe/Paris")
    selection.resolve("Asia/Tokyo", revision: currentRevision)
    XCTAssertEqual(selection.identifier, "Europe/Paris")
    selection.changeDestination("北京", deviceTimezone: "Europe/London")
    XCTAssertTrue(selection.isManual)
    XCTAssertEqual(selection.identifier, "Europe/Paris")
    selection.useAutomatic(deviceTimezone: "Europe/London")
    XCTAssertFalse(selection.isManual)
    XCTAssertEqual(selection.identifier, "Asia/Shanghai")
  }

  @MainActor func testCreateUsesReturnedTripWithoutSecondListRequest() async throws {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [JourneyMockProtocol.self]
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    var listRequests = 0
    let created: JSON = .object([
      "trip": .object([
        "id": .string("created-trip"), "name": .string("北京假期"),
        "timezone": .string("Asia/Shanghai"), "teamMode": .string("admin"),
      ]),
      "objects": .array([]), "members": .array([]), "epoch": .integer(1), "cursor": .integer(1),
    ])
    JourneyMockProtocol.handler = { request in
      if request.url!.path == "/api/auth/login" {
        return (
          200,
          .object(["user": .object(["id": .string("creator")]), "csrfToken": .string("token")])
        )
      }
      if request.url!.path == "/api/trips" {
        if request.httpMethod == "POST" { return (200, created) }
        listRequests += 1
        return listRequests == 1
          ? (200, .object(["trips": .array([])]))
          : (503, .object(["error": .object(["message": .string("list unavailable")])]))
      }
      return (
        200,
        .object([
          "leaseId": .string("lease"), "serverTime": .number(Date().timeIntervalSince1970 * 1000),
          "expiresAt": .number(Date().timeIntervalSince1970 * 1000 + 86_400_000),
        ])
      )
    }
    let store = JourneyStore(
      urlSession: URLSession(configuration: configuration),
      serverURL: "https://journey-create-test.invalid", storageDirectory: directory)
    defer {
      store.stopPolling()
      JourneyMockProtocol.handler = nil
      try? FileManager.default.removeItem(at: directory)
    }
    try await store.login(identifier: "creator", password: "password", name: "", register: false)
    try await store.create(.object(["name": .string("北京假期")]))
    XCTAssertEqual(listRequests, 1)
    XCTAssertEqual(store.selectedTrip, "created-trip")
    XCTAssertEqual(store.trips.first?["name"].string, "北京假期")
    XCTAssertEqual(store.trip["timezone"].string, "Asia/Shanghai")
  }
}

extension JourneyTests {
  func testTripCreationKeepsBeijingCivilDateAtHalfPastMidnight() throws {
    let timezone = try XCTUnwrap(TimeZone(identifier: "Asia/Shanghai"))
    let date = try XCTUnwrap(ISO8601DateFormatter().date(from: "2026-11-01T00:30:00+08:00"))
    XCTAssertEqual(TripCreationDate.string(date, timezone: timezone), "2026-11-01")
    XCTAssertEqual(TripCreationDate.dayCount(from: date, through: date, timezone: timezone), 1)
    XCTAssertEqual(TripCreationDate.calendar(timezone: timezone).component(.day, from: date), 1)
  }
  func testTripCreationCountsCivilDaysAcrossDaylightSaving() throws {
    let timezone = try XCTUnwrap(TimeZone(identifier: "America/New_York"))
    let formatter = ISO8601DateFormatter()
    let start = try XCTUnwrap(formatter.date(from: "2026-03-07T00:30:00-05:00"))
    let end = try XCTUnwrap(formatter.date(from: "2026-03-10T00:30:00-04:00"))
    XCTAssertEqual(TripCreationDate.dayCount(from: start, through: end, timezone: timezone), 4)
  }
}
