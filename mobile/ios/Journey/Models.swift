import CoreLocation
import Foundation

/// JSON preserves unknown server fields when persisting snapshots and immutable queued operations.
enum JSON: Codable, Equatable, Hashable {
  case object([String: JSON])
  case array([JSON])
  case string(String)
  case number(Double)
  case bool(Bool)
  case null
  init(from decoder: Decoder) throws {
    let c = try decoder.singleValueContainer()
    if c.decodeNil() {
      self = .null
    } else if let x = try? c.decode(Bool.self) {
      self = .bool(x)
    } else if let x = try? c.decode(Double.self) {
      self = .number(x)
    } else if let x = try? c.decode(String.self) {
      self = .string(x)
    } else if let x = try? c.decode([String: JSON].self) {
      self = .object(x)
    } else {
      self = .array(try c.decode([JSON].self))
    }
  }
  func encode(to encoder: Encoder) throws {
    var c = encoder.singleValueContainer()
    switch self {
    case .object(let x): try c.encode(x)
    case .array(let x): try c.encode(x)
    case .string(let x): try c.encode(x)
    case .number(let x): try c.encode(x)
    case .bool(let x): try c.encode(x)
    case .null: try c.encodeNil()
    }
  }
  subscript(_ key: String) -> JSON {
    get {
      if case .object(let x) = self { return x[key] ?? .null }
      return .null
    }
    set {
      var d = dictionary
      d[key] = newValue
      self = .object(d)
    }
  }
  var dictionary: [String: JSON] {
    if case .object(let x) = self { return x }
    return [:]
  }
  var array: [JSON] {
    if case .array(let x) = self { return x }
    return []
  }
  var string: String {
    if case .string(let x) = self { return x }
    return ""
  }
  var number: Double {
    if case .number(let x) = self { return x }
    return 0
  }
  var bool: Bool {
    if case .bool(let x) = self { return x }
    return false
  }
  var isNull: Bool { self == .null }
  static func text(_ s: String?) -> JSON { s.map(JSON.string) ?? .null }
  static func integer(_ n: Int) -> JSON { .number(Double(n)) }
}
extension JSON: Identifiable {
  var id: String { self["id"].string.isEmpty ? self["userId"].string : self["id"].string }
}
struct QueuedOperation: Codable, Identifiable, Equatable {
  var id: String { body["id"].string }
  var tripID: String
  var body: JSON
  var blocked: String?
  var receiptUnknown = false
}
struct AccountCache: Codable {
  var trips: [JSON] = []
  var snapshots: [String: JSON] = [:]
  var queue: [QueuedOperation] = []
  var drafts: [String: JSON] = [:]
  var contexts: [String: JSON] = [:]
}
struct APIError: LocalizedError {
  var message: String
  var code = ""
  var status = 0
  var errorDescription: String? { message }
}
struct TimeLease {
  var lease: JSON
  var midpoint: Double
  var wall: Double
  var uncertainty: Double
  func clock(
    uptime: Double = ProcessInfo.processInfo.systemUptime,
    wallTime: Double = Date().timeIntervalSince1970 * 1000
  ) -> JSON {
    let elapsed = (uptime - midpoint) * 1000
    let uncertain =
      elapsed < 0 || abs((wallTime - wall) - elapsed) > 2000
      || lease["serverTime"].number + elapsed > lease["expiresAt"].number
    return .object([
      "leaseId": lease["leaseId"], "elapsedMs": .number(max(0, elapsed.rounded())),
      "uncertaintyMs": .number(uncertainty + ceil(max(0, elapsed) * 0.00005)),
      "uncertain": .bool(uncertain),
    ])
  }
}

enum Coordinates {
  /// Backend Place values are GCJ-02. MapKit content coordinates use WGS84.
  static func wgs84(fromGCJ c: CLLocationCoordinate2D) -> CLLocationCoordinate2D {
    guard c.longitude >= 72.004, c.longitude <= 137.8347, c.latitude >= 0.8293,
      c.latitude <= 55.8271
    else { return c }
    var guess = c
    for _ in 0..<5 {
      let converted = gcj02(fromWGS: guess)
      guess.latitude -= converted.latitude - c.latitude
      guess.longitude -= converted.longitude - c.longitude
    }
    return guess
  }
  static func gcj02(fromWGS c: CLLocationCoordinate2D) -> CLLocationCoordinate2D {
    let lng = c.longitude
    let lat = c.latitude
    guard lng >= 72.004, lng <= 137.8347, lat >= 0.8293, lat <= 55.8271 else { return c }
    let x = lng - 105
    let y = lat - 35
    var dlat = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * sqrt(abs(x))
    dlat += (20 * sin(6 * x * .pi) + 20 * sin(2 * x * .pi)) * 2 / 3
    dlat += (20 * sin(y * .pi) + 40 * sin(y / 3 * .pi)) * 2 / 3
    dlat += (160 * sin(y / 12 * .pi) + 320 * sin(y * .pi / 30)) * 2 / 3
    var dlng = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * sqrt(abs(x))
    dlng += (20 * sin(6 * x * .pi) + 20 * sin(2 * x * .pi)) * 2 / 3
    dlng += (20 * sin(x * .pi) + 40 * sin(x / 3 * .pi)) * 2 / 3
    dlng += (150 * sin(x / 12 * .pi) + 300 * sin(x / 30 * .pi)) * 2 / 3
    let rad = lat / 180 * .pi
    let magic = 1 - 0.00669342162296594323 * sin(rad) * sin(rad)
    let root = sqrt(magic)
    dlat = dlat * 180 / ((6_378_245 * (1 - 0.00669342162296594323)) / (magic * root) * .pi)
    dlng = dlng * 180 / (6_378_245 / root * cos(rad) * .pi)
    return .init(latitude: lat + dlat, longitude: lng + dlng)
  }
  static func coordinate(_ place: JSON) -> CLLocationCoordinate2D? {
    guard !place["lat"].isNull, !place["lng"].isNull else { return nil }
    return wgs84(fromGCJ: .init(latitude: place["lat"].number, longitude: place["lng"].number))
  }
}
enum JourneyDate {
  static var calendar: Calendar {
    var c = Calendar(identifier: .gregorian)
    c.timeZone = TimeZone(secondsFromGMT: 0)!
    return c
  }
  static func string(_ d: Date) -> String {
    let f = DateFormatter()
    f.calendar = calendar
    f.timeZone = calendar.timeZone
    f.dateFormat = "yyyy-MM-dd"
    return f.string(from: d)
  }
  static func date(_ s: String) -> Date {
    let f = DateFormatter()
    f.calendar = calendar
    f.timeZone = calendar.timeZone
    f.dateFormat = "yyyy-MM-dd"
    return f.date(from: s) ?? Date()
  }
  static func dayID(trip: String, date: String, ordinal: Int) -> String {
    date.isEmpty ? "plan-day-\(trip)-ordinal-\(ordinal)" : "plan-day-\(trip)-date-\(date)"
  }
}

enum ActivityOrder {
  static func ordered(_ objects: [JSON], dayID: String) -> [JSON] {
    let rows = objects.filter {
      $0["kind"].string == "activity" && $0["state"].string == "active"
        && $0["payload"]["dayId"].string == dayID
    }.sorted { a, b in
      a["payload"]["order"].number == b["payload"]["order"].number
        ? a.id < b.id : a["payload"]["order"].number < b["payload"]["order"].number
    }
    func precise(_ o: JSON) -> Bool {
      o["payload"]["time"]["mode"].string == "precise"
        && !o["payload"]["time"]["start"].string.isEmpty
    }
    let times = rows.filter(precise).sorted { a, b in
      let at = a["payload"]["time"]["start"].string
      let bt = b["payload"]["time"]["start"].string
      return at == bt ? a.id < b.id : at < bt
    }
    var i = 0
    return rows.map { o in
      guard precise(o) else { return o }
      defer { i += 1 }
      return times[i]
    }
  }
}

enum SnapshotProjection {
  static func apply(_ queue: [QueuedOperation], to snapshot: JSON, userID: String) -> JSON {
    var snap = snapshot
    var trip = snap["trip"]
    var rows = snap["objects"].array
    let tid = trip.id
    for op in queue {
      let b = op.body
      let oid = b["objectId"].string
      let kind = b["kind"].string
      if kind == "reschedule" {
        let p = b["patch"]
        let start = p["startDate"].string
        let count = Int(p["dayCount"].number)
        trip["startDate"] = p["startDate"]
        trip["dayCount"] = p["dayCount"]
        if count > 0 {
          for ordinal in 1...count {
            let date =
              start.isEmpty
              ? ""
              : JourneyDate.string(
                JourneyDate.calendar.date(
                  byAdding: .day, value: ordinal - 1, to: JourneyDate.date(start))!)
            let id = JourneyDate.dayID(trip: tid, date: date, ordinal: ordinal)
            if !rows.contains(where: { $0.id == id }) {
              rows.append(
                .object([
                  "id": .string(id), "tripId": .string(tid), "kind": .string("day"),
                  "payload": .object([
                    "date": date.isEmpty ? .null : .string(date), "ordinal": .integer(ordinal),
                  ]), "state": .string("active"), "generation": .integer(0),
                ]))
            }
          }
        }
        for move in p["moves"].array {
          if let i = rows.firstIndex(where: { $0.id == move["activityId"].string }) {
            var target = move["dayId"].string
            if target.isEmpty {
              let ordinal = Int(move["ordinal"].number)
              let date =
                move["date"].string.isEmpty && !start.isEmpty
                ? JourneyDate.string(
                  JourneyDate.calendar.date(
                    byAdding: .day, value: ordinal - 1, to: JourneyDate.date(start))!)
                : move["date"].string
              target = JourneyDate.dayID(trip: tid, date: date, ordinal: ordinal)
            }
            if !rows.contains(where: { $0.id == target }) {
              let ordinal = Int(move["ordinal"].number)
              let date =
                !move["date"].string.isEmpty
                ? move["date"].string
                : start.isEmpty
                  ? ""
                  : JourneyDate.string(
                    JourneyDate.calendar.date(
                      byAdding: .day, value: ordinal - 1, to: JourneyDate.date(start))!)
              rows.append(
                .object([
                  "id": .string(target), "tripId": .string(tid), "kind": .string("day"),
                  "payload": .object([
                    "date": date.isEmpty ? .null : .string(date), "ordinal": .integer(ordinal),
                  ]), "state": .string("active"), "generation": .integer(0),
                ]))
            }
            rows[i]["payload"]["dayId"] = .string(target)
          }
        }
        continue
      }
      if kind == "create", !rows.contains(where: { $0.id == oid }) {
        rows.append(
          .object([
            "id": .string(oid), "tripId": .string(tid), "kind": b["objectType"],
            "payload": b["patch"], "state": .string("active"), "generation": .integer(0),
            "expressions": .array([]),
          ]))
        continue
      }
      let index = rows.firstIndex(where: { $0.id == oid })
      guard oid == tid || index != nil else { continue }
      var target = oid == tid ? trip : rows[index!]
      if kind == "patch" {
        for (k, v) in b["patch"].dictionary {
          if oid == tid { target[k] = v } else { target["payload"][k] = v }
        }
      }
      if kind == "delete" || kind == "restore" {
        let state = kind == "delete" ? "deleted" : "active"
        if target["state"].string != state {
          target["state"] = .string(state)
          target["generation"] = .number(target["generation"].number + 1)
        }
      }
      if kind == "express" {
        var expressions = target["expressions"].array
        let i = expressions.firstIndex { $0["userId"].string == userID }
        var expression = i.map { expressions[$0] } ?? .object(["userId": .string(userID)])
        for (k, v) in b["expression"].dictionary { expression[k] = v }
        if let i { expressions[i] = expression } else { expressions.append(expression) }
        target["expressions"] = .array(expressions)
        let majority = snap["members"].array.count / 2 + 1
        let shouldDelete =
          target["state"].string == "active" && trip["teamMode"].string == "equal"
          && expressions.contains(where: { $0["wishDelete"].bool })
          && expressions.filter {
            $0["wishDelete"].bool
              || (target["kind"].string == "activity" && $0["notParticipating"].bool)
          }.count >= majority
        let shouldRestore =
          target["state"].string == "deleted"
          && expressions.filter { $0["wishRestore"].bool }.count >= majority
        if shouldDelete || shouldRestore {
          target["state"] = .string(shouldDelete ? "deleted" : "active")
          target["generation"] = .number(target["generation"].number + 1)
          if shouldRestore {
            target["expressions"] =
              oid == tid
              ? .array([])
              : .array(
                expressions.map { e in
                  var e = e
                  e["wishDelete"] = .bool(false)
                  e["wishRestore"] = .bool(false)
                  return e
                })
          }
        }
      }
      if oid == tid { trip = target } else { rows[index!] = target }
    }
    snap["trip"] = trip
    snap["objects"] = .array(rows)
    return snap
  }
}
