import Foundation
import SwiftUI

/// Byte-for-byte compatible with domain.js routeSignature, including nested JSON strings.
enum RouteSignature {
  static func stringify(_ value: JSON) throws -> String {
    switch value {
    case .number(let n):
      if n == 0 { return "0" }
      let raw = String(n)
      if let e = raw.firstIndex(of: "e"), let exponent = Int(raw[raw.index(after: e)...]) {
        let mantissa = String(raw[..<e])
        let negative = mantissa.hasPrefix("-")
        let unsigned = negative ? String(mantissa.dropFirst()) : mantissa
        let pieces = unsigned.split(separator: ".")
        let digits = pieces.joined()
        let decimal = pieces[0].count + exponent
        if abs(n) >= 0.000001 && abs(n) < 1e21 {
          let expanded: String
          if decimal <= 0 {
            expanded = "0." + String(repeating: "0", count: -decimal) + digits
          } else if decimal >= digits.count {
            expanded = digits + String(repeating: "0", count: decimal - digits.count)
          } else {
            let i = digits.index(digits.startIndex, offsetBy: decimal)
            expanded = String(digits[..<i]) + "." + String(digits[i...])
          }
          return (negative ? "-" : "") + expanded
        }
        let compact = mantissa.hasSuffix(".0") ? String(mantissa.dropLast(2)) : mantissa
        return compact + "e" + (exponent >= 0 ? "+" : "-") + String(abs(exponent))
      }
      return raw.hasSuffix(".0") ? String(raw.dropLast(2)) : raw
    case .array(let values): return "[" + (try values.map(stringify)).joined(separator: ",") + "]"
    default:
      let encoder = JSONEncoder()
      encoder.outputFormatting = [.withoutEscapingSlashes]
      return String(decoding: try encoder.encode(value), as: UTF8.self)
    }
  }
  static func signature(from: JSON, to: JSON, mode: String) throws -> String {
    func place(_ object: JSON) -> JSON {
      let p = object["payload"]["place"].isNull ? object : object["payload"]["place"]
      guard !p.isNull else { return .null }
      return .array([
        .string(p["providerPlaceId"].string), p["lng"], p["lat"], .string(p["address"].string),
        .string(p["name"].string),
      ])
    }
    let endpoint = try stringify(
      .array([.string(from.id), place(from), .string(to.id), place(to)]))
    return try stringify(.array([.string(endpoint), .string(mode)]))
  }
  static func label(_ mode: String) -> String {
    ["walking": "步行", "driving": "驾车", "bicycling": "骑行", "transit": "公交"][mode] ?? mode
  }
  static func isCurrent(_ route: JSON, objects: [JSON]) -> Bool {
    let p = route["payload"]
    guard let to = objects.first(where: { $0.id == p["toId"].string }) else { return false }
    let from =
      p["fromId"].isNull
      ? JSON.object(["id": .string("origin"), "payload": .object(["place": p["fromPlace"]])])
      : objects.first(where: { $0.id == p["fromId"].string }) ?? .null
    return p["inputSignature"].string
      == (try? signature(from: from, to: to, mode: p["mode"].string))
  }
  static func description(_ route: JSON, objects: [JSON]) -> String {
    let p = route["payload"]
    let mode = label(p["mode"].string)
    guard isCurrent(route, objects: objects) else { return mode + " · 重新查询" }
    return mode + (p["minutes"].isNull ? " · 时间待定" : " · \(Int(p["minutes"].number)) 分钟")
  }
  @MainActor static func estimate(from: JSON, to: JSON, mode: String, store: JourneyStore)
    async throws -> JSON
  {
    guard !from["lng"].isNull, !from["lat"].isNull, !to["lng"].isNull, !to["lat"].isNull else {
      throw APIError(message: "请先为起终点选择地图地点，或直接填写路程时间")
    }
    let origin = "\(from["lng"].number),\(from["lat"].number)"
    let destination = "\(to["lng"].number),\(to["lat"].number)"
    let endpoint =
      mode == "bicycling"
      ? "/v4/direction/bicycling"
      : mode == "transit" ? "/v3/direction/transit/integrated" : "/v3/direction/\(mode)"
    var params = URLComponents()
    params.queryItems = [
      URLQueryItem(name: "origin", value: origin),
      URLQueryItem(name: "destination", value: destination),
    ]
    if mode == "transit" {
      params.queryItems?.append(URLQueryItem(name: "city", value: store.trip["destination"].string))
    }
    let response = try await store.api(
      "/_AMapService" + endpoint + "?" + (params.percentEncodedQuery ?? ""))
    let paths =
      mode == "bicycling"
      ? response["data"]["paths"].array
      : mode == "transit" ? response["route"]["transits"].array : response["route"]["paths"].array
    guard let route = paths.first else { throw APIError(message: "未找到路线，请直接填写路程时间") }
    let duration =
      Double(route["duration"].string)
      ?? (route["duration"].isNull ? nil : route["duration"].number)
    guard let duration else { throw APIError(message: "未能取得路线时间，请直接填写") }
    var segments = route["steps"].array
    for segment in route["segments"].array {
      segments += segment["walking"]["steps"].array
      segments += segment["bus"]["buslines"].array
    }
    let path: [JSON] = segments.flatMap { step in
      step["polyline"].string.split(separator: ";").compactMap { pair in
        let c = pair.split(separator: ",").compactMap { Double($0) }
        return c.count == 2 ? JSON.array(c.map(JSON.number)) : nil
      }
    }
    return .object([
      "minutes": .number(ceil(duration / 60)),
      "distance": Double(route["distance"].string).map(JSON.number)
        ?? (route["distance"].isNull ? .null : route["distance"]), "path": .array(path),
    ])
  }
}
struct RouteEditor: View {
  @EnvironmentObject var store: JourneyStore
  @Environment(\.dismiss) var dismiss
  var object: JSON?
  var from: JSON?
  var to: JSON
  @State private var mode = "walking"
  @State private var minutes = ""
  @State private var originPlace: JSON = .null
  @State private var estimate: JSON = .null
  @State private var manual = true
  @State private var searching = false
  @State private var estimating = false
  @State private var account = ""
  @State private var tripID = ""
  var currentFrom: JSON {
    if let from { return store.objects.first(where: { $0.id == from.id }) ?? from }
    return .object(["id": .string("origin"), "payload": .object(["place": originPlace])])
  }
  var currentTo: JSON { store.objects.first(where: { $0.id == to.id }) ?? to }
  var body: some View {
    NavigationStack {
      JourneyForm {
        Section("前往下一站") {
          Text(
            (from == nil
              ? originPlace["name"].string.isEmpty ? "出发地" : originPlace["name"].string
              : currentFrom["payload"]["title"].string) + " → "
              + currentTo["payload"]["title"].string)
          if from == nil {
            Button(originPlace.isNull ? "选择出发地点" : originPlace["name"].string) { searching = true }
          }
          Picker(
            "交通方式",
            selection: Binding(
              get: { mode },
              set: {
                mode = $0
                estimate = .null
                minutes = ""
                manual = true
              })
          ) {
            ForEach(["walking", "driving", "bicycling", "transit"], id: \.self) {
              Text(RouteSignature.label($0)).tag($0)
            }
          }
          TextField(
            "路程时间（分钟）",
            text: Binding(
              get: { minutes },
              set: {
                minutes = $0
                manual = true
                estimate = .null
              })
          ).keyboardType(.decimalPad)
          Button(estimating ? "正在查询…" : "查询路线时间") {
            Task {
              estimating = true
              defer { estimating = false }
              let signature = try? RouteSignature.signature(
                from: currentFrom, to: currentTo, mode: mode)
              do {
                let result = try await RouteSignature.estimate(
                  from: currentFrom["payload"]["place"], to: currentTo["payload"]["place"],
                  mode: mode, store: store)
                guard
                  signature
                    == (try? RouteSignature.signature(from: currentFrom, to: currentTo, mode: mode))
                else { throw APIError(message: "起终点已变化，请重新查询") }
                estimate = result
                minutes = String(Int(result["minutes"].number))
                manual = false
              } catch { store.error = error.localizedDescription }
            }
          }.disabled(estimating)
        }
        if let object { Section { LifecycleActions(object: object) } }
      }.navigationTitle("路程").toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) {
          Button("保存") {
            store.perform {
              let time = minutes.trimmingCharacters(in: .whitespaces)
              guard
                time.isEmpty
                  || (Double(time) != nil && Double(time)!.isFinite && Double(time)! >= 0)
              else { throw APIError(message: "请填写非负路程时间") }
              guard from != nil || !originPlace["name"].string.isEmpty else {
                throw APIError(message: "请选择出发地点")
              }
              let signature = try RouteSignature.signature(
                from: currentFrom, to: currentTo, mode: mode)
              let patch: JSON = .object([
                "fromId": from.map { .string($0.id) } ?? .null,
                "fromPlace": from == nil ? originPlace : .null, "toId": .string(to.id),
                "mode": .string(mode), "minutes": Double(time).map(JSON.number) ?? .null,
                "manual": .bool(manual), "inputSignature": .string(signature),
                "path": estimate["path"].isNull ? .array([]) : estimate["path"],
                "distance": estimate["distance"],
              ])
              try await store.mutate(
                object: object, kind: object == nil ? "create" : "patch",
                type: object == nil ? "route" : nil, patch: patch, expectedTrip: tripID,
                expectedAccount: account)
              dismiss()
            }
          }.journeyButton(prominent: true).disabled(store.busy || estimating)
        }.journeyOwnGlass()
      }.onAppear {
        account = store.user.id
        tripID = store.selectedTrip ?? ""
        if let object {
          let p = object["payload"]
          mode = p["mode"].string
          originPlace = p["fromPlace"]
          manual = p["manual"].bool
          if p["inputSignature"].string
            == (try? RouteSignature.signature(from: currentFrom, to: currentTo, mode: mode))
          {
            minutes = p["minutes"].isNull ? "" : String(p["minutes"].number)
            estimate = p
          }
        }
      }.sheet(isPresented: $searching) {
        PlacePicker {
          originPlace = $0
          estimate = .null
          minutes = ""
        }
      }
    }
  }
}
struct RouteSelection: Identifiable {
  let id = UUID()
  var object: JSON?
  var from: JSON?
  var to: JSON
}
