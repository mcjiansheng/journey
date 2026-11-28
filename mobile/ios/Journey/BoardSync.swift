import Foundation

// Board data rules ported from the web client (docs/设计文档/11-原生端功能对齐.md, B1):
// app/src/board-pending.js, the pure parts of app/src/board-sync.js and the style
// helpers of app/src/board.js. The shared cases in mobile/fixtures/board-sync.json and
// board-geometry.json check that these give the same results as the web client.

/// The JavaScript value semantics the ported rules depend on. `nil` stands for
/// `undefined` (a missing key); `.null` for `null`.
enum JSRules {
  /// `Boolean(value)`.
  static func truthy(_ value: JSON?) -> Bool {
    switch value {
    case nil, .null?: return false
    case .bool(let x)?: return x
    case .number(let x)?: return x != 0 && !x.isNaN
    case .string(let x)?: return !x.isEmpty
    case .object?, .array?: return true
    }
  }

  /// `Number(value)` for the values JSON can hold.
  static func number(_ value: JSON?) -> Double {
    switch value {
    case nil: return .nan
    case .null?: return 0
    case .bool(let x)?: return x ? 1 : 0
    case .number(let x)?: return x
    case .string(let x)?:
      let s = x.trimmingCharacters(in: .whitespacesAndNewlines)
      return s.isEmpty ? 0 : Double(s) ?? .nan
    case .array(let x)?: return x.isEmpty ? 0 : x.count == 1 ? number(.string(stringValue(x[0]))) : .nan
    case .object?: return .nan
    }
  }

  private static func stringValue(_ value: JSON) -> String {
    switch value {
    case .string(let x): return x
    case .number(let x): return x == x.rounded() && abs(x) < 1e15 ? String(Int64(x)) : String(x)
    case .bool(let x): return x ? "true" : "false"
    default: return ""
    }
  }

  /// `a ?? b`: `b` as it is (possibly missing or null) when `a` is missing or null.
  static func coalesce(_ a: JSON?, _ b: JSON?) -> JSON? {
    if let a, a != .null { return a }
    return b
  }

  /// `a.localeCompare(b) < 0` for object ids (`[A-Za-z0-9_-]`, see server/model.mjs `id`):
  /// the Unicode root collation the browser applies orders `_` before `-`, both before
  /// digits, digits before letters, ignores case first and then puts lowercase first.
  static func localeLess(_ a: String, _ b: String) -> Bool {
    func primary(_ c: Character) -> Int {
      if c == "_" { return 0 }
      if c == "-" { return 1 }
      if let d = c.wholeNumberValue, c.isASCII { return 2 + d }
      if c.isASCII, c.isLetter, let v = c.lowercased().unicodeScalars.first?.value {
        return 12 + Int(v) - 97
      }
      return 100 + Int(c.unicodeScalars.first?.value ?? 0)
    }
    let x = Array(a)
    let y = Array(b)
    for (p, q) in zip(x, y) where primary(p) != primary(q) { return primary(p) < primary(q) }
    if x.count != y.count { return x.count < y.count }
    for (p, q) in zip(x, y) where p != q {
      if p.isLowercase != q.isLowercase { return p.isLowercase }
      return String(p) < String(q)
    }
    return false
  }
}

/// app/src/board-pending.js: local changes the server has not echoed back yet. A
/// refresh triggered by an earlier operation returns the older server copy; applying
/// it would flash the object back to its previous size or position.
enum BoardPending {
  static let ttl: Double = 15000

  struct Entry: Equatable {
    var expect: JSON
    var at: Double
  }

  /// The web client's `Map<id, { expect, at }>`: entries keep their insertion order,
  /// and setting an existing id keeps its place.
  struct Changes: Equatable {
    private(set) var order: [String] = []
    private var entries: [String: Entry] = [:]

    init(_ pairs: [(String, Entry)] = []) {
      for (id, entry) in pairs { set(id, entry) }
    }
    var isEmpty: Bool { order.isEmpty }
    var pairs: [(String, Entry)] { order.map { ($0, entries[$0]!) } }
    subscript(id: String) -> Entry? { entries[id] }
    mutating func set(_ id: String, _ entry: Entry) {
      if entries[id] == nil { order.append(id) }
      entries[id] = entry
    }
    mutating func remove(_ id: String) {
      guard entries.removeValue(forKey: id) != nil else { return }
      order.removeAll { $0 == id }
    }
    mutating func removeAll() {
      order = []
      entries = [:]
    }
    static func == (a: Changes, b: Changes) -> Bool { a.order == b.order && a.entries == b.entries }
  }

  static func sameValue(_ a: JSON?, _ b: JSON?) -> Bool {
    if case .number(let x)? = a, case .number(let y)? = b { return abs(x - y) < 0.01 }
    return (a ?? .null) == (b ?? .null)
  }

  static func matchesExpected(_ item: JSON, _ expect: JSON) -> Bool {
    let fields = item.dictionary
    for (key, value) in expect.dictionary {
      if case .object(let group) = value {
        let current = fields[key]?.dictionary ?? [:]
        for (sub, v) in group where !sameValue(current[sub], v) { return false }
      } else if !sameValue(fields[key], value) {
        return false
      }
    }
    return true
  }

  static func mergeExpected(_ previous: JSON = .object([:]), _ next: JSON = .object([:])) -> JSON {
    var out = previous.dictionary
    for (key, value) in next.dictionary {
      if case .object(let group) = value {
        var merged = previous.dictionary[key]?.dictionary ?? [:]
        for (sub, v) in group { merged[sub] = v }
        out[key] = .object(merged)
      } else {
        out[key] = value
      }
    }
    return .object(out)
  }

  /// Keep local versions of items whose pending change the server copy does not
  /// reflect yet. `pending` is pruned in place once the server confirms a change or it
  /// expires (a peer may have won the conflict).
  static func reconcile(
    _ serverItems: [JSON], local localItems: [JSON], pending: inout Changes, now: Double
  ) -> [JSON] {
    if pending.isEmpty { return serverItems }
    var local: [String: JSON] = [:]
    for item in localItems { local[item["id"].string] = item }
    var seen = Set<String>()
    var out = serverItems.map { item -> JSON in
      let id = item["id"].string
      seen.insert(id)
      guard let p = pending[id] else { return item }
      if matchesExpected(item, p.expect) || now - p.at > ttl {
        pending.remove(id)
        return item
      }
      return local[id] ?? item
    }
    for (id, p) in pending.pairs where !seen.contains(id) {
      if now - p.at > ttl {
        pending.remove(id)
      } else if let item = local[id] {
        out.append(item)
      }
    }
    return out
  }

  /// Whether an items response is older than what is already on screen: same server
  /// epoch, smaller cursor. (A different epoch is a restart or restore and is handled by
  /// a full refetch, never dropped.)
  static func isStaleResponse(_ response: JSON?, cursor: JSON?, epoch: JSON?) -> Bool {
    guard JSRules.truthy(response), let epoch, epoch != .null, JSRules.truthy(cursor),
      let response, let cursor
    else { return false }
    let fields = response.dictionary
    let responseCursor = JSRules.truthy(fields["cursor"]) ? fields["cursor"]! : .number(0)
    return JSRules.number(fields["epoch"]) == JSRules.number(epoch)
      && JSRules.number(responseCursor) < JSRules.number(cursor)
  }

  static func isStaleResponse(_ response: JSON, cursor: Double, epoch: Double?) -> Bool {
    isStaleResponse(response, cursor: .number(cursor), epoch: epoch.map(JSON.number))
  }
}

/// boardItem rules from app/src/board-sync.js (`normalizeBoardItem`,
/// `cleanBoardItemPatch`) and app/src/board.js (`BOARD_STYLE_KEYS`,
/// `cleanBoardStylePatch`, `nextBoardStyle`).
enum BoardItems {
  /// Style fields the board may patch; the sync layer drops everything else before
  /// saving. Keep in sync with the style schema in server/model.mjs.
  static let styleKeys = [
    "color", "size", "frameStyle", "variant", "fontSize", "tilt", "ratio", "autoWidth", "locked",
    "mapStyle",
  ]
  /// The logical groups of a boardItem. Each is replaced as a whole and carries its own
  /// clock on the server, so a patch sends only the groups it changes, each complete.
  static let patchKeys = ["frame", "z", "content", "style", "linkedActivityId"]
  static let defaultFrame: JSON = .object([
    "x": .number(0), "y": .number(0), "w": .number(100), "h": .number(100),
    "rotation": .number(0), "scale": .number(1),
  ])

  static func cleanStylePatch(_ stylePatch: JSON) -> JSON {
    let fields = stylePatch.dictionary
    var out: [String: JSON] = [:]
    for key in styleKeys {
      guard let value = fields[key] else { continue }
      out[key] = key == "locked" ? .bool(JSRules.truthy(value)) : value
    }
    return .object(out)
  }

  /// The style an item gets from `patch` (`{ style?, locked? }`), or nil when the patch
  /// changes neither. A patch normally adds to the current style; `replace` swaps the
  /// style for the one given (how undo removes a field the undone change had added).
  static func nextStyle(_ current: JSON?, patch: JSON, replace: Bool = false) -> JSON? {
    let fields = patch.dictionary
    let style = fields["style"]
    let locked = fields["locked"]
    if !JSRules.truthy(style) && locked == nil { return nil }
    var out = replace && JSRules.truthy(style) ? [:] : current?.dictionary ?? [:]
    for (key, value) in style?.dictionary ?? [:] { out[key] = value }
    if let locked { out["locked"] = .bool(JSRules.truthy(locked)) }
    return .object(out)
  }

  /// Only the patchable groups, with the style cleaned and the frame reduced to
  /// `{ x, y, w, h, rotation, scale }`.
  static func cleanPatch(_ raw: JSON?) -> JSON {
    guard let raw, case .object(var source) = raw else { return .object([:]) }
    if JSRules.truthy(source["payload"]) {
      var merged = source["payload"]!.dictionary
      for (key, value) in raw.dictionary { merged[key] = value }
      source = merged
    }
    var cleaned: [String: JSON] = [:]
    var stylePatch: [String: JSON]? = JSRules.truthy(source["style"]) ? source["style"]!.dictionary : nil
    if let locked = source["locked"] {
      stylePatch = stylePatch ?? [:]
      stylePatch!["locked"] = .bool(JSRules.truthy(locked))
    }
    if let stylePatch { cleaned["style"] = cleanStylePatch(.object(stylePatch)) }
    for key in patchKeys where key != "style" {
      if let value = source[key] { cleaned[key] = value }
    }
    if JSRules.truthy(cleaned["frame"]) {
      let frame = cleaned["frame"]!.dictionary
      var next: [String: JSON] = [:]
      for key in ["x", "y", "w", "h"] { next[key] = frame[key] }
      next["rotation"] = JSRules.coalesce(frame["rotation"], .number(0))
      next["scale"] = JSRules.coalesce(frame["scale"], .number(1))
      cleaned["frame"] = .object(next)
    }
    return .object(cleaned)
  }

  /// A server object (`{ id, payload: { boardId, frame, … } }`) or a local item, with
  /// the payload fields also at the top level. Local fields win over the payload.
  static func normalize(_ item: JSON) -> JSON {
    guard JSRules.truthy(item) else { return item }
    let fields = item.dictionary
    let payload = JSRules.truthy(fields["payload"]) ? fields["payload"]!.dictionary : [:]
    func pick(_ key: String) -> JSON? { JSRules.coalesce(fields[key], payload[key]) }
    let style = JSRules.coalesce(pick("style"), .object([:]))!
    let locked = JSRules.truthy(JSRules.coalesce(style.dictionary["locked"], fields["locked"]))
    let boardID = pick("boardId")
    let frame = JSRules.coalesce(pick("frame"), defaultFrame)!
    let z = JSRules.coalesce(pick("z"), .number(0))!
    let content = JSRules.coalesce(pick("content"), .object([:]))!
    let linked =
      fields["linkedActivityId"] ?? JSRules.coalesce(payload["linkedActivityId"], .null)!
    let createdBy = pick("createdBy")
    var out = fields
    out["boardId"] = boardID
    out["frame"] = frame
    out["z"] = z
    out["content"] = content
    out["style"] = style
    out["locked"] = .bool(locked)
    out["linkedActivityId"] = linked
    out["createdBy"] = createdBy
    if JSRules.truthy(fields["payload"]) {
      var next = payload
      next["boardId"] = boardID
      next["frame"] = frame
      next["z"] = z
      next["content"] = content
      next["style"] = style
      next["linkedActivityId"] = linked
      next["createdBy"] = createdBy
      out["payload"] = .object(next)
    }
    return .object(out)
  }

  /// The local copy after `patch`, as useBoard's patchBoardItem builds it: content,
  /// style and frame merge into the current values (style is replaced with `replace`).
  static func applying(_ cleaned: JSON, to target: JSON, replaceStyle: Bool, now: Double) -> JSON {
    var next = target.dictionary
    let patch = cleaned.dictionary
    for (key, value) in patch { next[key] = value }
    func merged(_ key: String) -> JSON? {
      guard JSRules.truthy(patch[key]) else { return target.dictionary[key] }
      var out = target[key].dictionary
      for (k, v) in patch[key]!.dictionary { out[k] = v }
      return .object(out)
    }
    next["content"] = merged("content")
    next["frame"] = merged("frame")
    next["style"] = JSRules.truthy(patch["style"]) && replaceStyle ? patch["style"] : merged("style")
    next["updatedAt"] = .number(now)
    return normalize(.object(next))
  }

  static func isActive(_ item: JSON) -> Bool { item["state"].string != "deleted" }
  static func active(_ items: [JSON]) -> [JSON] { items.filter(isActive) }
  /// Recently deleted first, as the web client's 「最近删除」 lists them.
  static func deleted(_ items: [JSON]) -> [JSON] {
    let rows = items.enumerated().filter { !isActive($0.element) }
    return rows.sorted { a, b in
      let x = a.element["updatedAt"].number
      let y = b.element["updatedAt"].number
      return x == y ? a.offset < b.offset : x > y
    }.map(\.element)
  }
}

/// The trip's boards (Board.jsx): the `board` objects of the main snapshot, at most
/// 20 active. A trip without any is shown its `default-board`, which the server adds
/// on the first read of its items.
enum BoardList {
  static let defaultID = "default-board"
  static let defaultTitle = "主白板"
  static let limit = 20
  static let itemLimit = 2000

  static func active(_ objects: [JSON]) -> [JSON] {
    objects.filter { $0["kind"].string == "board" && $0["state"].string == "active" }.sorted {
      a, b in
      let x = a["payload"]["order"].isNull ? 0 : JSRules.number(a["payload"]["order"])
      let y = b["payload"]["order"].isNull ? 0 : JSRules.number(b["payload"]["order"])
      return x != y && !(x - y).isNaN ? x < y : JSRules.localeLess(a["id"].string, b["id"].string)
    }
  }

  static func deleted(_ objects: [JSON]) -> [JSON] {
    objects.filter { $0["kind"].string == "board" && $0["state"].string == "deleted" }
  }

  /// The boards to list: the active ones, or the default board when there are none.
  static func boards(_ objects: [JSON], tripID: String) -> [JSON] {
    let rows = active(objects)
    if !rows.isEmpty { return rows }
    return [
      .object([
        "id": .string(defaultID), "tripId": .string(tripID), "kind": .string("board"),
        "payload": .object([
          "title": .string(defaultTitle), "order": .number(0), "background": .string("dots"),
        ]),
        "state": .string("active"), "generation": .number(0),
      ])
    ]
  }

  /// The board to show: the selected one while it is active, otherwise the first.
  static func currentID(_ objects: [JSON], selected: String?) -> String {
    let rows = active(objects)
    if let selected, rows.contains(where: { $0["id"].string == selected }) { return selected }
    return rows.first?["id"].string ?? (selected?.isEmpty == false ? selected! : defaultID)
  }

  static func title(_ board: JSON) -> String {
    let title = board["payload"]["title"].string
    return title.isEmpty ? "白板" : title
  }

  /// `order` and title of a new board (Board.jsx `createBoard`).
  static func nextOrder(_ boards: [JSON]) -> Double {
    max(0, boards.map { $0["payload"]["order"].number }.max() ?? 0) + 1
  }
  static func newTitle(_ boards: [JSON]) -> String { "白板 \(boards.count + 1)" }

  /// Same rule as the server: deleting a board is for the trip owner (and admins in an
  /// admin-run team); restoring for the owner and any admin.
  static func canDelete(_ snapshot: JSON, userID: String) -> Bool {
    let trip = snapshot["trip"]
    let me = snapshot["members"].array.first { $0["userId"].string == userID }
    return trip["ownerId"].string == userID
      || (trip["teamMode"].string == "admin" && me?["isAdmin"].bool == true)
  }
  static func canRestore(_ snapshot: JSON, userID: String) -> Bool {
    snapshot["trip"]["ownerId"].string == userID
      || snapshot["members"].array.contains { $0["userId"].string == userID && $0["isAdmin"].bool }
  }
}
