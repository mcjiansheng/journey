import MapKit
import SwiftUI

enum PlaceSearch {
  @MainActor static func search(_ query: String, store: JourneyStore) async throws -> [JSON] {
    let q =
      query.addingPercentEncoding(
        withAllowedCharacters: .urlQueryAllowed.subtracting(CharacterSet(charactersIn: "&+?#")))
      ?? ""
    let r = try await store.api(
      "/_AMapService/v3/place/text?keywords=\(q)&offset=20&page=1&extensions=base")
    guard r["status"].string == "1" else {
      throw APIError(message: r["info"].string.isEmpty ? "地点搜索未完成" : r["info"].string)
    }
    return r["pois"].array.map { poi in
      let c = poi["location"].string.split(separator: ",").compactMap { Double($0) }
      return .object([
        "name": poi["name"], "address": .string(poi["address"].string),
        "lng": c.count == 2 ? .number(c[0]) : .null, "lat": c.count == 2 ? .number(c[1]) : .null,
        "provider": .string("amap"), "providerPlaceId": poi["id"],
        "category": .string(poi["type"].string), "sourceUrl": .string(""),
        "fetchedAt": .number(Date().timeIntervalSince1970 * 1000), "coordSystem": .string("GCJ-02"),
      ])
    }
  }
  @MainActor static func timezone(_ query: String, store: JourneyStore) async throws -> String {
    let q =
      query.addingPercentEncoding(
        withAllowedCharacters: .urlQueryAllowed.subtracting(CharacterSet(charactersIn: "&+?#")))
      ?? ""
    let r = try await store.api("/_AMapService/v3/geocode/geo?address=\(q)")
    let code = r["geocodes"].array.first?["adcode"].string ?? ""
    let prefix = String(code.prefix(2))
    let mainland = [
      "11", "12", "13", "14", "15", "21", "22", "23", "31", "32", "33", "34", "35", "36", "37",
      "41", "42", "43", "44", "45", "46", "50", "51", "52", "53", "54", "61", "62", "63", "64",
      "65",
    ]
    guard code.count == 6 else { throw APIError(message: "未能确认目的地时区，请手动选择") }
    if mainland.contains(prefix) { return "Asia/Shanghai" }
    if let zone = ["71": "Asia/Taipei", "81": "Asia/Hong_Kong", "82": "Asia/Macau"][prefix] {
      return zone
    }
    throw APIError(message: "未能确认目的地时区，请手动选择")
  }
}
struct PlacePicker: View {
  @EnvironmentObject var store: JourneyStore
  @Environment(\.dismiss) var dismiss
  var onSelect: (JSON) -> Void
  @State private var query = ""
  @State private var manualName = ""
  @State private var manualAddress = ""
  @State private var results: [JSON] = []
  @State private var searching = false
  var body: some View {
    NavigationStack {
      List {
        Section {
          HStack {
            TextField("搜索地点", text: $query).onSubmit { search() }
            Button("搜索") { search() }.disabled(query.isEmpty || searching)
          }
          if searching { ProgressView() }
        }
        Section("搜索结果") {
          ForEach(Array(results.enumerated()), id: \.offset) { _, place in
            Button {
              onSelect(place)
              dismiss()
            } label: {
              VStack(alignment: .leading, spacing: 6) {
                Text(place["name"].string)
                Text(place["address"].string).font(.caption).foregroundStyle(.secondary)
              }
            }
          }
        }
        Section("手动填写") {
          TextField("地点名称", text: $manualName)
          TextField("地址", text: $manualAddress)
          Button("使用这个地点") {
            onSelect(
              .object([
                "name": .string(manualName), "address": .string(manualAddress), "lng": .null,
                "lat": .null, "provider": .null, "providerPlaceId": .null, "category": .string(""),
                "sourceUrl": .string(""), "fetchedAt": .null, "coordSystem": .string("GCJ-02"),
              ]))
            dismiss()
          }.disabled(manualName.trimmingCharacters(in: .whitespaces).isEmpty)
        }
      }.navigationTitle("选择地点").toolbar { Button("取消") { dismiss() } }
    }
  }
  func search() {
    Task {
      searching = true
      defer { searching = false }
      do { results = try await PlaceSearch.search(query, store: store) } catch {
        store.error = error.localizedDescription
      }
    }
  }
}
struct MapPinItem: Identifiable {
  var id: String
  var place: JSON
  var favorite: JSON?
}
struct TripMapView: View {
  @EnvironmentObject var store: JourneyStore
  @State private var camera: MapCameraPosition = .automatic
  @State private var fittedTrip: String?
  @State private var selected: MapPinItem?
  @State private var searching = false
  @State private var newActivity: JSON?
  @State private var pendingSearchPlace: JSON?
  @State private var pendingActivityPlace: JSON?
  var pins: [MapPinItem] {
    store.objects.filter {
      $0["state"].string == "active" && ["activity", "favorite"].contains($0["kind"].string)
    }.compactMap { o in
      let p = o["kind"].string == "favorite" ? o["payload"] : o["payload"]["place"]
      return Coordinates.coordinate(p) == nil
        ? nil : MapPinItem(id: o.id, place: p, favorite: o["kind"].string == "favorite" ? o : nil)
    }
  }
  var favorites: [JSON] {
    store.objects.filter { $0["kind"].string == "favorite" && $0["state"].string == "active" }
  }
  func fitInitialCamera() {
    guard fittedTrip != store.selectedTrip else { return }
    let points = pins.compactMap { Coordinates.coordinate($0.place) }
    guard !points.isEmpty else { return }
    let minLat = points.map(\.latitude).min()!
    let maxLat = points.map(\.latitude).max()!
    let minLng = points.map(\.longitude).min()!
    let maxLng = points.map(\.longitude).max()!
    camera = .region(
      MKCoordinateRegion(
        center: .init(latitude: (minLat + maxLat) / 2, longitude: (minLng + maxLng) / 2),
        span: .init(
          latitudeDelta: max(0.04, (maxLat - minLat) * 1.4),
          longitudeDelta: max(0.04, (maxLng - minLng) * 1.4))))
    fittedTrip = store.selectedTrip
  }
  var body: some View {
    VStack(spacing: 0) {
      Map(position: $camera) {
        ForEach(
          store.objects.filter {
            $0["kind"].string == "route" && $0["state"].string == "active"
              && $0["payload"]["path"].array.count > 1
              && RouteSignature.isCurrent($0, objects: store.objects)
          }
        ) { route in
          MapPolyline(
            coordinates: route["payload"]["path"].array.compactMap { pair in
              let c = pair.array
              return c.count == 2
                ? Coordinates.wgs84(fromGCJ: .init(latitude: c[1].number, longitude: c[0].number))
                : nil
            }
          ).stroke(Palette.accent, lineWidth: 4)
        }
        ForEach(pins) { pin in
          if let c = Coordinates.coordinate(pin.place) {
            Annotation(pin.place["name"].string, coordinate: c) {
              Button {
                selected = pin
              } label: {
                Image(systemName: pin.favorite == nil ? "mappin.circle.fill" : "star.circle.fill")
                  .font(.title).foregroundStyle(Palette.accent).background(
                    .regularMaterial, in: Circle())
              }
            }
          }
        }
      }.mapControls {
        MapCompass()
        MapScaleView()
      }.frame(minHeight: 230)
      List {
        Section("收藏地点") {
          if favorites.isEmpty { Text("收藏沿途想去的地方").foregroundStyle(.secondary) }
          ForEach(favorites) { o in
            Button {
              selected = MapPinItem(id: o.id, place: o["payload"], favorite: o)
              if let c = Coordinates.coordinate(o["payload"]) {
                camera = .region(
                  MKCoordinateRegion(
                    center: c, span: .init(latitudeDelta: 0.02, longitudeDelta: 0.02)))
              }
            } label: {
              VStack(alignment: .leading) {
                Text(o["payload"]["name"].string)
                Text(o["payload"]["address"].string).font(.caption).foregroundStyle(.secondary)
              }
            }
          }
        }
      }.frame(maxHeight: 250)
    }.onAppear { fitInitialCamera() }.onChange(of: pins.map(\.id)) { _, _ in fitInitialCamera() }
      .navigationTitle("沿途地图").navigationBarTitleDisplayMode(.inline).toolbar {
        Button {
          searching = true
        } label: {
          Label("搜索地点", systemImage: "magnifyingglass")
        }
      }.sheet(
        isPresented: $searching,
        onDismiss: {
          if let place = pendingSearchPlace {
            pendingSearchPlace = nil
            selected = MapPinItem(id: UUID().uuidString, place: place, favorite: nil)
          }
        }
      ) {
        PlacePicker { place in pendingSearchPlace = place }
      }.sheet(
        item: $selected,
        onDismiss: {
          if let place = pendingActivityPlace {
            pendingActivityPlace = nil
            newActivity = place
          }
        }
      ) { pin in
        NavigationStack {
          Form {
            Section {
              Text(pin.place["name"].string).font(.title2)
              Text(pin.place["address"].string).foregroundStyle(.secondary)
            }
            Button("添加到行程") {
              pendingActivityPlace = pin.place
              selected = nil
            }
            if let f = pin.favorite {
              LifecycleActions(object: f)
            } else {
              Button("收藏地点") {
                store.perform {
                  try await store.mutate(kind: "create", type: "favorite", patch: pin.place)
                  selected = nil
                }
              }
            }
            if let c = Coordinates.coordinate(pin.place) {
              Button("在地图中导航") {
                MKMapItem(placemark: MKPlacemark(coordinate: c)).openInMaps(launchOptions: [
                  MKLaunchOptionsDirectionsModeKey: MKLaunchOptionsDirectionsModeWalking
                ])
              }
            }
          }.navigationTitle("地点").toolbar { Button("完成") { selected = nil } }
        }.presentationDetents([.medium, .large])
      }.sheet(item: $newActivity) { place in
        ActivityEditor(dayID: store.days.first?.id ?? "", initialPlace: place)
      }
  }
}
