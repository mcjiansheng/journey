import CoreLocation
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
    if let identifier = DestinationTimezones.known(query) { return identifier }
    let geocoder = CLGeocoder()
    if let placemark = try? await geocoder.geocodeAddressString(query).first,
      let identifier = placemark.timeZone?.identifier
    {
      return identifier
    }
    try Task.checkCancellation()
    let q =
      query.addingPercentEncoding(
        withAllowedCharacters: .urlQueryAllowed.subtracting(CharacterSet(charactersIn: "&+?#")))
      ?? ""
    let r = try await store.api("/_AMapService/v3/geocode/geo?address=\(q)")
    let code = r["geocodes"].array.first?["adcode"].string ?? ""
    let mainland = [
      "11", "12", "13", "14", "15", "21", "22", "23", "31", "32", "33", "34", "35", "36", "37",
      "41", "42", "43", "44", "45", "46", "50", "51", "52", "53", "54", "61", "62", "63", "64",
      "65",
    ]
    if code.count == 6 {
      let prefix = String(code.prefix(2))
      if mainland.contains(prefix) { return "Asia/Shanghai" }
      if let zone = ["71": "Asia/Taipei", "81": "Asia/Hong_Kong", "82": "Asia/Macau"][prefix] {
        return zone
      }
    }
    throw APIError(message: "未能确认目的地时区")
  }

}
struct PlacePicker: View {
  @Environment(\.journeyPalette) private var palette
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
      JourneyList {
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
                Text(place["address"].string).font(.caption).foregroundStyle(palette.muted)
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
  @Environment(\.accessibilityReduceMotion) private var reducedMotion
  @Environment(\.journeyPalette) private var palette
  @EnvironmentObject var store: JourneyStore
  @State private var camera: MapCameraPosition = .automatic
  @State private var fittedTrip: String?
  @State private var selected: MapPinItem?
  @State private var searching = false
  @State private var newActivity: JSON?
  @State private var pendingSearchPlace: JSON?
  @State private var managingPresets = false
  @State private var customizing: JSON?
  @State private var cameraDistance = Double.infinity
  @State private var groups: [[String]] = []
  @State private var clusterList: [MapPinItem] = []
  @State private var showClusterList = false
  @State private var filter: String?
  @State private var lastMark: JSON = .null
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
  var favoriteMarkDraftKey: String { "\(store.selectedTrip ?? ""):last-favorite-mark" }
  var defaultMark: JSON { .object(["icon": .string("circle"), "color": .string(store.user["preferences"]["palette"].string == "atlas" ? "blue" : "green")]) }
  func mark(_ pin: MapPinItem) -> JSON { pin.favorite?["payload"]["mark"].isNull == false ? pin.favorite!["payload"]["mark"] : defaultMark }
  var presets: [JSON] { store.objects.filter { $0["kind"].string == "markPreset" && $0["state"].string == "active" }.sorted { $0["payload"]["order"].number < $1["payload"]["order"].number } }
  var visiblePins: [MapPinItem] { pins.filter { $0.favorite == nil || filter == nil || FavoriteMark.key(mark($0)) == filter } }
  var displayedGroups: [[MapPinItem]] {
    let lookup = Dictionary(uniqueKeysWithValues: visiblePins.map { ($0.id, $0) })
    let covered = Set(groups.flatMap { $0 })
    return groups.map { $0.compactMap { lookup[$0] } }.filter { !$0.isEmpty } + visiblePins.filter { !covered.contains($0.id) }.map { [$0] }
  }
  func cluster(_ proxy: MapProxy) {
    let points = visiblePins.compactMap { pin -> ClusterPoint? in
      guard let coordinate = Coordinates.coordinate(pin.place), let point = proxy.convert(coordinate, to: .local) else { return nil }
      return ClusterPoint(id: pin.id, x: point.x, y: point.y, mark: FavoriteMark.key(mark(pin)), priority: pin.favorite == nil || selected?.id == pin.id ? 1 : 0)
    }
    groups = FavoriteClusters.groups(points, previous: groups)
  }
  func openGroup(_ group: [MapPinItem]) {
    if group.count == 1 { selected = group[0]; return }
    let coordinates = group.compactMap { Coordinates.coordinate($0.place) }
    let lat = coordinates.map(\.latitude), lng = coordinates.map(\.longitude)
    let height = lat.max()! - lat.min()!, width = lng.max()! - lng.min()!
    if max(height, width) < 0.00005 || cameraDistance < 150 { clusterList = group; showClusterList = true; return }
    camera = .region(MKCoordinateRegion(center: .init(latitude: (lat.max()! + lat.min()!) / 2, longitude: (lng.max()! + lng.min()!) / 2), span: .init(latitudeDelta: max(0.0001, height * 1.6), longitudeDelta: max(0.0001, width * 1.6))))
  }
  func groupCoordinate(_ group: [MapPinItem]) -> CLLocationCoordinate2D? {
    let coordinates = group.compactMap { Coordinates.coordinate($0.place) }
    guard !coordinates.isEmpty else { return nil }
    return CLLocationCoordinate2D(latitude: coordinates.map(\.latitude).reduce(0,+) / Double(coordinates.count), longitude: coordinates.map(\.longitude).reduce(0,+) / Double(coordinates.count))
  }
  func groupName(_ group: [MapPinItem]) -> String {
    if group.count == 1 { return String(group[0].place["name"].string.prefix(8)) + (group[0].place["name"].string.count > 8 ? "…" : "") }
    let keys = Set(group.map { FavoriteMark.key(mark($0)) })
    return keys.count == 1 ? presets.first { FavoriteMark.key($0["payload"]) == keys.first! }?["payload"]["name"].string ?? "" : ""
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
      Text(store.trip["name"].string).font(.subheadline).foregroundStyle(palette.muted).frame(
        maxWidth: .infinity, alignment: .leading
      ).padding(.horizontal).padding(.bottom, 8)
      MapReader { proxy in
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
          ).stroke(FavoriteMark.color(.object(["color": .string(store.user["preferences"]["palette"].string == "atlas" ? "blue" : "green")])), lineWidth: 4)
        }
        ForEach(displayedGroups, id: \.first!.id) { group in
          if let first = group.first, let c = groupCoordinate(group) {
            Annotation(groupName(group), coordinate: c) {
              Button { openGroup(group) } label: {
                HStack(spacing: 1) {
                  if first.favorite == nil { Text("\((pins.filter { $0.favorite == nil }.firstIndex { $0.id == first.id } ?? 0) + 1)").font(.headline).foregroundStyle(.white).frame(width: 26, height: 26).background(palette.accent, in: Circle()) }
                  else { ForEach(Array(Dictionary(grouping: group, by: { FavoriteMark.key(mark($0)) }).values.sorted { $0.count > $1.count }.prefix(3)), id: \.first!.id) { values in FavoriteMarkBadge(mark: mark(values[0])) } }
                  if group.count > 1 { Text("\(group.count)").font(.caption.bold()).foregroundStyle(.black) }
                }.font(.title2).padding(3).background(.white, in: Capsule())
                  .overlay(alignment: .bottomTrailing) { if group.contains(where: { pin in store.objects.contains { $0["kind"].string == "activity" && $0["state"].string == "active" && FavoriteMark.samePlace($0["payload"]["place"], pin.place) } }) { Circle().fill(palette.accent).frame(width: 7, height: 7).overlay(Circle().stroke(.white, lineWidth: 1)) } }
              }.accessibilityLabel(group.count == 1 ? first.place["name"].string : "\(group.count) 个收藏：\(groupName(group))")
            }.annotationTitles(.automatic)
          }
        }
      }.mapControls {
        MapCompass()
        MapScaleView()
      }.frame(minHeight: 230)
        .onMapCameraChange(frequency: .onEnd) { context in cameraDistance = context.camera.distance; cluster(proxy) }
        .animation(reducedMotion ? nil : .easeInOut(duration: 0.15), value: groups)
        .onChange(of: visiblePins.map { JSON.object(["id": .string($0.id), "place": $0.place, "mark": mark($0), "favorite": .bool($0.favorite != nil)]) }) { _, _ in cluster(proxy) }
        .onChange(of: selected?.id) { _, _ in cluster(proxy) }
      }
      JourneyList {
        Section("标记") {
          ScrollView(.horizontal) { HStack { ForEach(Array(Dictionary(grouping: favorites, by: { FavoriteMark.key($0["payload"]["mark"].isNull ? defaultMark : $0["payload"]["mark"]) }).keys.sorted()), id: \.self) { key in
            let rows = favorites.filter { FavoriteMark.key($0["payload"]["mark"].isNull ? defaultMark : $0["payload"]["mark"]) == key }
            let mark = rows[0]["payload"]["mark"].isNull ? defaultMark : rows[0]["payload"]["mark"]
            Button { filter = filter == key ? nil : key } label: { HStack { FavoriteMarkBadge(mark: mark); Text((presets.first { FavoriteMark.key($0["payload"]) == key }?["payload"]["name"].string).flatMap { $0.isEmpty ? nil : $0 } ?? "未命名"); Text("\(rows.count)") } }.buttonStyle(.bordered).tint(filter == key ? palette.accent : palette.muted)
          } } }
        }
        Section("收藏地点") {
          Button("管理预设") { managingPresets = true }
          if favorites.isEmpty { Text("收藏沿途想去的地方").foregroundStyle(palette.muted) }
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
                HStack { FavoriteMarkBadge(mark: o["payload"]["mark"].isNull ? defaultMark : o["payload"]["mark"]); Text(o["payload"]["name"].string) }
                Text(o["payload"]["address"].string).font(.caption).foregroundStyle(palette.muted)
              }
            }
          }
        }
      }.frame(maxHeight: 250)
    }.onAppear { lastMark = store.draft(favoriteMarkDraftKey); fitInitialCamera() }.onChange(of: pins.map(\.id)) { _, _ in fitInitialCamera() }
      .navigationTitle("地图").navigationBarTitleDisplayMode(.large).toolbar {
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
          JourneyForm {
            Section {
              Text(pin.place["name"].string).font(.title2)
              Text(pin.place["address"].string).foregroundStyle(palette.muted)
            }
            Button("添加到行程") {
              pendingActivityPlace = FavoriteMark.placePayload(pin.place)
              selected = nil
            }
            if let f = favorites.first(where: { $0.id == pin.id || FavoriteMark.samePlace($0["payload"], pin.place) }) {
              Section("标记") {
                HStack { Text("已收藏"); FavoriteMarkBadge(mark: f["payload"]["mark"].isNull ? defaultMark : f["payload"]["mark"]) }
                ForEach(presets) { preset in Button {
                  store.perform { let mark = JSON.object(["icon": preset["payload"]["icon"], "color": preset["payload"]["color"]]); try await store.mutate(object: f, kind: "patch", patch: .object(["mark": mark])); lastMark = mark; try store.setDraft(favoriteMarkDraftKey, mark) }
                } label: { HStack { FavoriteMarkBadge(mark: preset["payload"]); Text(preset["payload"]["name"].string.isEmpty ? "未命名" : preset["payload"]["name"].string) } } }
                Button("自定义") { customizing = f }
              }
              LifecycleActions(object: f)
            } else {
              Button("收藏地点") {
                store.perform {
                  var place = FavoriteMark.placePayload(pin.place); place["mark"] = lastMark.isNull ? defaultMark : lastMark
                  let id = UUID().uuidString
                  try await store.mutate(kind: "create", type: "favorite", patch: place, id: id)
                  selected = MapPinItem(id: id, place: place, favorite: store.objects.first { $0.id == id })
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
        }.presentationDetents([.medium, .large]).sheet(item: $customizing) { favorite in FavoriteMarkEditor(favorite: favorite, initial: favorite["payload"]["mark"].isNull ? defaultMark : favorite["payload"]["mark"], onApply: { mark in lastMark = mark; do { try store.setDraft(favoriteMarkDraftKey, mark) } catch { store.error = error.localizedDescription } }) }
      }.sheet(isPresented: $managingPresets) { MarkPresetManager() }
      .sheet(isPresented: $showClusterList) { NavigationStack { JourneyList { ForEach(clusterList) { pin in Button { showClusterList = false; selected = pin } label: { HStack { FavoriteMarkBadge(mark: mark(pin)); Text(pin.place["name"].string) } } } }.navigationTitle("收藏地点") } }
      .sheet(item: $newActivity) { place in
        ActivityEditor(dayID: store.days.first?.id ?? "", initialPlace: FavoriteMark.placePayload(place))
      }
  }
}

enum FavoriteMark {
  static let icons = ["circle", "triangle", "square", "diamond", "hexagon", "star", "heart", "flag"]
  static let colors = ["blue", "green", "coral", "amber", "purple", "rose", "sky", "graphite"]
  static let hex = ["176b88", "2f7a5a", "c8553d", "b7791f", "7a4f9a", "b8457a", "3f7fbf", "4a5560"]
  static func placePayload(_ place: JSON) -> JSON {
    let keys: Set<String> = ["name", "address", "lng", "lat", "provider", "providerPlaceId", "category", "sourceUrl", "fetchedAt", "coordSystem"]
    return .object(place.dictionary.filter { keys.contains($0.key) })
  }
  static func symbol(_ mark: JSON) -> String { (icons.contains(mark["icon"].string) ? mark["icon"].string : "circle") + ".fill" }
  static func color(_ mark: JSON) -> Color { { let value = Int(hex[colors.firstIndex(of: mark["color"].string) ?? 0], radix: 16)!; return Color(red: Double((value >> 16) & 255) / 255, green: Double((value >> 8) & 255) / 255, blue: Double(value & 255) / 255) }() }
  static func samePlace(_ a: JSON, _ b: JSON) -> Bool {
    if !a["providerPlaceId"].string.isEmpty && !b["providerPlaceId"].string.isEmpty { return a["providerPlaceId"] == b["providerPlaceId"] && a["provider"] == b["provider"] }
    return !a["lng"].isNull && !b["lng"].isNull && a["lng"] == b["lng"] && a["lat"] == b["lat"]
  }
  static func key(_ mark: JSON) -> String { mark["icon"].string + ":" + mark["color"].string }
}
struct FavoriteMarkBadge: View {
  var mark: JSON
  var body: some View { Image(systemName: FavoriteMark.symbol(mark)).foregroundStyle(FavoriteMark.color(mark)).padding(3).background(.white, in: Circle()).accessibilityLabel("\(mark["color"].string) \(mark["icon"].string)") }
}
struct FavoriteMarkEditor: View {
  @EnvironmentObject var store: JourneyStore
  @Environment(\.dismiss) var dismiss
  var favorite: JSON? = nil
  var preset: JSON? = nil
  var initial: JSON
  @State private var icon = "circle"
  @State private var color = "blue"
  @State private var name = ""
  @State private var savePreset = false
  @State private var confirm = false
  var onApply: ((JSON) -> Void)? = nil
  var mark: JSON { .object(["icon": .string(icon), "color": .string(color)]) }
  var used: Int { store.objects.filter { $0["kind"].string == "favorite" && $0["state"].string == "active" && $0["payload"]["mark"] == initial }.count }
  func save() {
    store.perform {
      if let favorite { try await store.mutate(object: favorite, kind: "patch", patch: .object(["mark": mark])) }
      if let preset {
        try await store.mutate(object: preset, kind: "patch", patch: .object(["icon": .string(icon), "color": .string(color), "name": .string(String(name.prefix(12)))]))
      } else if savePreset {
        try await store.mutate(kind: "create", type: "markPreset", patch: .object(["icon": .string(icon), "color": .string(color), "name": .string(String(name.prefix(12)))]))
      }
      onApply?(mark)
      dismiss()
    }
  }
  var body: some View {
    NavigationStack {
      JourneyForm {
        Section { FavoriteMarkBadge(mark: mark).font(.largeTitle).frame(maxWidth: .infinity) }
        Section("图标") { Picker("图标", selection: $icon) { ForEach(FavoriteMark.icons, id: \.self) { Image(systemName: $0 + ".fill").tag($0) } }.pickerStyle(.segmented) }
        Section("颜色") { Picker("颜色", selection: $color) { ForEach(FavoriteMark.colors, id: \.self) { value in Text(["blue":"海图蓝", "green":"森林绿", "coral":"珊瑚红", "amber":"琥珀", "purple":"梅紫", "rose":"玫红", "sky":"天蓝", "graphite":"石墨"][value]!).tag(value) } } }
        if preset == nil { Toggle("存为预设", isOn: $savePreset) }
        if preset != nil || savePreset { TextField("它代表什么（选填）", text: $name).onChange(of: name) { _, value in name = String(value.prefix(12)) } }
      }.navigationTitle(preset == nil ? "自定义标记" : "编辑预设").toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) { Button("完成") { if preset != nil && mark != initial && used > 0 { confirm = true } else { save() } } }
      }.confirmationDialog("有 \(used) 个地点在用这个标记，一起改吗？", isPresented: $confirm, titleVisibility: .visible) { Button("一起修改") { save() } }
    }.onAppear { icon = initial["icon"].string; color = initial["color"].string; name = preset?["payload"]["name"].string ?? "" }
  }
}
struct MarkPresetManager: View {
  @EnvironmentObject var store: JourneyStore
  @Environment(\.dismiss) var dismiss
  @State private var editing: JSON?
  var presets: [JSON] { store.objects.filter { $0["kind"].string == "markPreset" && $0["state"].string == "active" }.sorted { $0["payload"]["order"].number < $1["payload"]["order"].number } }
  var body: some View {
    NavigationStack {
      JourneyList {
        ForEach(presets) { preset in
          HStack { FavoriteMarkBadge(mark: preset["payload"]); Button(preset["payload"]["name"].string.isEmpty ? "未命名" : preset["payload"]["name"].string) { editing = preset }; Spacer(); LifecycleActions(object: preset) }
        }.onMove { offsets, destination in
          var rows = presets; rows.move(fromOffsets: offsets, toOffset: destination)
          store.perform { for (index, preset) in rows.enumerated() { try await store.mutate(object: preset, kind: "patch", patch: .object(["order": .integer(index * 1024)])) } }
        }
      }.navigationTitle("管理预设").toolbar { EditButton(); Button("完成") { dismiss() } }
    }.sheet(item: $editing) { preset in FavoriteMarkEditor(preset: preset, initial: .object(["icon": preset["payload"]["icon"], "color": preset["payload"]["color"]])) }
  }
}
