import XCTest

@testable import Journey

/// Shared fixtures from mobile/fixtures, generated from the web client by
/// mobile/tools/generate-fixtures.mjs (docs/设计文档/11-原生端功能对齐.md §4).
///
/// Each later work package ports a web function and adds a test here that replays
/// `Fixtures.cases(file, "<fn>")` through the port and checks it with `Fixtures.same`.
enum Fixtures {
  static let files = ["rich-text", "board-geometry", "board-widgets", "itinerary"]

  static func load(_ name: String) throws -> JSON {
    let url = try XCTUnwrap(
      Bundle(for: SharedFixturesTests.self).url(forResource: name, withExtension: "json"),
      "\(name).json is missing from the test bundle; regenerate the Xcode project")
    return try JSONDecoder().decode(JSON.self, from: Data(contentsOf: url))
  }

  struct Case {
    let args: [JSON]
    let result: JSON
  }

  /// Successful cases of one function. An argument "$snapshot" stands for the file's
  /// top-level `snapshot`; "$fn:simplify" for a callback the caller passes in itself.
  static func cases(_ file: JSON, _ fn: String, module: String? = nil) -> [Case] {
    file["cases"].array.compactMap { c in
      guard c["fn"].string == fn, module == nil || c["module"].string == module,
        c["error"] == .null
      else { return nil }
      let args = c["args"].array.map { a -> JSON in
        if case .string(let s) = a, s.hasPrefix("$"), !s.hasPrefix("$fn:") {
          return file[String(s.dropFirst())]
        }
        return a
      }
      return Case(args: args, result: c["result"])
    }
  }

  /// Deep JSON equality; numbers may differ by 1e-9.
  static func same(_ expected: JSON, _ actual: JSON) -> Bool {
    switch (expected, actual) {
    case (.number(let x), .number(let y)): return abs(x - y) <= 1e-9
    case (.object(let x), .object(let y)):
      return Set(x.keys) == Set(y.keys) && x.keys.allSatisfy { same(x[$0]!, y[$0]!) }
    case (.array(let x), .array(let y)):
      return x.count == y.count && zip(x, y).allSatisfy { same($0, $1) }
    default: return expected == actual
    }
  }
}

final class SharedFixturesTests: XCTestCase {
  func testEveryFixtureFileIsGeneratedAndHasCases() throws {
    for name in Fixtures.files {
      let file = try Fixtures.load(name)
      XCTAssertTrue(file["$comment"].string.contains("generate-fixtures.mjs"), name)
      XCTAssertFalse(file["cases"].array.isEmpty, name)
    }
  }

  func testDeletedContentListsOnlyKindsTheWebClientRestores() throws {
    // The snapshot also holds a deleted board, which this client must not list.
    let objects = try Fixtures.load("itinerary")["snapshot"]["objects"].array
    XCTAssertEqual(DeletedContent.items(objects).map(\.id), ["day-3", "act-5", "fav-4", "exp-5"])
  }

  func testOrderedActivitiesMatchTheWebClient() throws {
    let file = try Fixtures.load("itinerary")
    let objects = file["snapshot"]["objects"].array
    let cases = Fixtures.cases(file, "orderedActivities", module: "domain")
    XCTAssertFalse(cases.isEmpty)
    for c in cases {
      let dayID = c.args[1].string
      XCTAssertEqual(
        ActivityOrder.ordered(objects, dayID: dayID).map(\.id), c.result.array.map(\.id), dayID)
    }
  }

  func testRouteSignaturesMatchTheWebClientForTheSharedSnapshot() throws {
    let file = try Fixtures.load("itinerary")
    let cases = Fixtures.cases(file, "routeSignature", module: "domain")
    XCTAssertFalse(cases.isEmpty)
    for c in cases {
      XCTAssertEqual(
        try RouteSignature.signature(from: c.args[0], to: c.args[1], mode: c.args[2].string),
        c.result.string)
    }
  }

  func testFixtureComparisonToleratesFloatingPointNoiseOnly() {
    XCTAssertTrue(
      Fixtures.same(
        .object(["a": .array([.number(1), .number(2.5)]), "b": .null]),
        .object(["b": .null, "a": .array([.number(1), .number(2.5000000000001)])])))
    XCTAssertFalse(Fixtures.same(.object(["a": .number(1)]), .object(["a": .number(1), "b": .number(2)])))
    XCTAssertFalse(Fixtures.same(.array([.number(1), .number(2)]), .array([.number(2), .number(1)])))
  }
}
