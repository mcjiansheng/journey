import SwiftUI

@main struct JourneyApp: App {
  @StateObject private var store = JourneyStore()
  @Environment(\.scenePhase) private var phase
  @AppStorage("journey.theme") private var theme = "system"
  @AppStorage("journey.palette") private var paletteName = "forest"
  @AppStorage("journey.reducedTransparency") private var transparency = "system"
  @AppStorage("journey.reducedMotion") private var motion = "system"
  var body: some Scene {
    WindowGroup {
      RootView().environmentObject(store)
        .modifier(JourneyAppearance(paletteName: paletteName, transparency: transparency, motion: motion))
        .onChange(of: store.user) { _, user in
          guard !user.isNull else { return }
          let prefs = user["preferences"]
          paletteName = prefs["palette"].string.isEmpty ? "forest" : prefs["palette"].string
          theme = prefs["theme"].string.isEmpty ? "system" : prefs["theme"].string
          transparency = PreferenceChoice.string(prefs["reducedTransparency"])
          motion = PreferenceChoice.string(prefs["reducedMotion"])
        }
        .environment(\.locale, Locale(identifier: "zh_CN")).tint(
        DesignTokens.palette(paletteName).accent
      ).preferredColorScheme(
        theme == "system" ? nil : theme == "dark" ? .dark : .light
      ).task {
        await store.start()
        store.startPolling()
      }.onChange(of: phase) { _, phase in
        if phase == .active { store.startPolling() } else { store.stopPolling() }
      }
    }
  }
}
struct RootView: View {
  @Environment(\.journeyPalette) private var palette
  @EnvironmentObject var store: JourneyStore
  var body: some View {
    Group {
      if !store.ready {
        ProgressView("正在连接同行…").frame(maxWidth: .infinity, maxHeight: .infinity)
          .foregroundStyle(palette.muted).background { JourneyBackground() }
      } else if store.user.isNull || store.sessionExpired {
        LoginView()
      } else if store.selectedTrip != nil {
        WorkspaceView()
      } else {
        HomeView()
      }
    }.onChange(of: store.selectedTrip) { _, _ in store.undoDeletion = nil }
      .onChange(of: store.user.id) { _, _ in store.undoDeletion = nil }
      .overlay(alignment: .bottom) {
        if store.undoDeletion != nil {
          HStack {
            Text("已删除")
            Spacer()
            Button("撤销") { store.undoDelete() }
            Button {
              store.undoDeletion = nil
            } label: {
              Image(systemName: "xmark")
            }.accessibilityLabel("收起")
          }.padding().background(palette.surfaceSolid, in: RoundedRectangle(cornerRadius: 16))
            .padding(.horizontal).padding(.bottom, store.selectedTrip == nil ? 12 : 88)
        }
      }.alert(
        "未能完成",
        isPresented: Binding(get: { store.error != nil }, set: { if !$0 { store.error = nil } })
      ) {
        Button("好") { store.error = nil }
      } message: {
        Text(store.error ?? "")
      }
  }
}
struct LoginView: View {
  @Environment(\.journeyPalette) private var palette
  @EnvironmentObject var store: JourneyStore
  @State private var register = false
  @State private var identifier = ""
  @State private var password = ""
  @State private var name = ""
  var body: some View {
    NavigationStack {
      JourneyForm {
        Section {
          VStack(alignment: .leading, spacing: 14) {
            Image(systemName: "safari").font(.system(size: 34)).foregroundStyle(palette.accent)
              .frame(width: 68, height: 68).background(
                palette.iconBackground, in: RoundedRectangle(cornerRadius: 22))
            Text("同行").font(.largeTitle.bold())
            Text("JOURNEY").font(.caption).tracking(4)
            Text("和同伴一起，把旅行慢慢安排好。").foregroundStyle(palette.muted)
          }.padding(.vertical, 24).listRowBackground(Color.clear)
        }
        Section {
          Picker("账号", selection: $register) {
            Text("登录").tag(false)
            Text("注册").tag(true)
          }.pickerStyle(.segmented)
          TextField("账号", text: $identifier).keyboardType(.emailAddress).textContentType(.username)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled().accessibilityIdentifier("auth.identifier")
          SecureField("密码", text: $password).textContentType(register ? .newPassword : .password)
            .accessibilityIdentifier("auth.password")
          if register { TextField("你的称呼", text: $name).accessibilityIdentifier("auth.name") }
          Button(register ? "注册并开始" : "登录") {
            store.perform {
              try await store.login(
                identifier: identifier, password: password, name: name, register: register)
            }
          }.disabled(
            store.busy || identifier.isEmpty || password.isEmpty || (register && name.isEmpty)
          ).journeyButton(prominent: true).accessibilityIdentifier("auth.submit")
        }
      }.navigationTitle("")
    }
  }
}
struct HomeView: View {
  @Environment(\.journeyPalette) private var palette
  @EnvironmentObject var store: JourneyStore
  @State private var sheet: String?
  var body: some View {
    NavigationStack {
      JourneyList {
        Section {
          VStack(alignment: .leading, spacing: 12) {
            Label("同行 JOURNEY", systemImage: "safari").font(.headline).foregroundStyle(
              palette.accent)
            Text("我的旅程").font(.largeTitle.bold())
            Text("把下一段好时光，留给彼此。").foregroundStyle(palette.muted)
          }.padding(.vertical, 14).listRowBackground(Color.clear)
        }
        Section {
          ViewThatFits(in: .horizontal) {
            HStack(spacing: 12) { homeActions }
            VStack(spacing: 12) { homeActions }
          }.controlSize(.large).listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))
        }
        if !store.cache.queue.isEmpty {
          NavigationLink {
            SyncView()
          } label: {
            Label("\(store.cache.queue.count) 项修改等待同步", systemImage: "arrow.triangle.2.circlepath")
          }
        }
        if store.loadedTrips && store.trips.isEmpty {
          ContentUnavailableView(
            "还没有旅程", systemImage: "safari", description: Text("创建一段旅程，或加入同伴的旅程。"))
        }
        Section("旅程") {
          ForEach(store.trips) { trip in
            Button {
              store.perform { try await store.open(trip.id) }
            } label: {
              HStack(spacing: 16) {
                Image(systemName: "safari").font(.title2).foregroundStyle(palette.accent)
                  .frame(width: 52, height: 58)
                  .background(palette.iconBackground, in: RoundedRectangle(cornerRadius: 17))
                VStack(alignment: .leading, spacing: 7) {
                  Text(trip["name"].string).font(.headline).foregroundStyle(palette.text)
                  Text(
                    [
                      trip["destination"].string, trip["startDate"].string,
                      trip["archived"].bool
                        ? "已归档"
                        : trip["state"].string == "deleted"
                          ? "已删除" : "\(Int(trip["dayCount"].number)) 天",
                    ].filter { !$0.isEmpty }.joined(separator: " · ")
                  ).font(.subheadline).foregroundStyle(palette.muted)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(
                  palette.muted)
              }.padding(.vertical, 4)
            }.buttonStyle(.plain).accessibilityIdentifier("trip.open." + trip.id)
          }
        }
        if store.status != "已同步" && store.cache.queue.isEmpty {
          Text(store.status).font(.caption).foregroundStyle(palette.muted).listRowBackground(
            Color.clear)
        }
      }.navigationTitle("").toolbar {
        Button {
          sheet = "profile"
        } label: {
          Image(systemName: "person.crop.circle")
        }.accessibilityLabel("我的设置").accessibilityIdentifier("settings.personal")
      }.refreshable {
        do { try await store.refreshTrips() } catch { store.error = error.localizedDescription }
      }.sheet(item: Binding(get: { sheet.map(SheetID.init) }, set: { sheet = $0?.id })) { item in
        if item.id == "create" {
          CreateTripView()
        } else if item.id == "join" {
          JoinView()
        } else {
          ProfileView()
        }
      }
    }
  }
}
extension HomeView {
  @ViewBuilder var homeActions: some View {
    Button {
      sheet = "create"
    } label: {
      Label("创建旅程", systemImage: "plus").frame(maxWidth: .infinity)
    }.journeyButton()
    Button {
      sheet = "join"
    } label: {
      Label("加入旅程", systemImage: "person.badge.plus").frame(maxWidth: .infinity)
    }.journeyButton()
  }
}
struct SheetID: Identifiable {
  var id: String
  init(_ id: String) { self.id = id }
}
struct CreateTripView: View {
  @Environment(\.journeyPalette) private var palette
  @EnvironmentObject var store: JourneyStore
  @Environment(\.dismiss) var dismiss
  @State private var name = ""
  @State private var destination = ""
  @State private var timezone = DestinationTimezoneSelection()
  @State private var mode = "admin"
  @State private var currency = "CNY"
  @State private var start = Date()
  @State private var end = Date()
  @State private var creating = false
  @State private var creationError: String?
  @FocusState private var textFocus: String?
  var body: some View {
    NavigationStack {
      JourneyForm {
        Section {
          TextField("旅程名称", text: $name).focused($textFocus, equals: "name")
            .accessibilityIdentifier("trip.name")
          TextField("目的地", text: $destination).focused($textFocus, equals: "destination")
            .accessibilityIdentifier("trip.destination")
          DatePicker("出发日期", selection: $start, displayedComponents: .date)
            .environment(\.calendar, TripCreationDate.calendar()).environment(
              \.timeZone, TimeZone.current)
          DatePicker("结束日期", selection: $end, in: start..., displayedComponents: .date)
            .environment(\.calendar, TripCreationDate.calendar()).environment(
              \.timeZone, TimeZone.current)
        }
        Section {
          TeamModeCards(
            selection: Binding(
              get: { mode },
              set: {
                mode = $0
                textFocus = nil
              }))
        } header: {
          Text("同行方式")
        } footer: {
          Text("大家都能添加和编辑行程。")
        }
        Section {
          DisclosureGroup("更多设置") {
            Picker("记账币种", selection: $currency) { ForEach(currencies, id: \.self) { Text($0) } }
            NavigationLink {
              JourneyTimeZonePicker(
                selection: Binding(get: { timezone.identifier }, set: { timezone.choose($0) }),
                useAutomatic: { timezone.useAutomatic() })
            } label: {
              LabeledContent("旅程时区", value: JourneyTimeZone.label(timezone.identifier))
            }.accessibilityIdentifier("trip.timezone")
          }
        }
        Section {
          if let creationError {
            Text(creationError).foregroundStyle(palette.danger).accessibilityIdentifier(
              "trip.create.error")
          }
          Button(creating ? "正在创建…" : "创建旅程") { create() }
            .disabled(
              creating || name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                || destination.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            )
            .journeyButton(prominent: true).accessibilityIdentifier("trip.create")
        }
      }.disabled(creating).navigationTitle("新旅程").toolbar {
        Button("取消") { dismiss() }.disabled(creating)
      }
      .interactiveDismissDisabled(creating)
      .onChange(of: destination) { _, value in timezone.changeDestination(value) }
      .onChange(of: start) { _, value in if end < value { end = value } }
      .task(id: timezone.revision) {
        let query = destination.trimmingCharacters(in: .whitespacesAndNewlines)
        timezone.changeDestination(query)
        guard !query.isEmpty, !timezone.isManual, DestinationTimezones.known(query) == nil else {
          return
        }
        let revision = timezone.revision
        do {
          try await Task.sleep(for: .milliseconds(350))
          let identified = try await PlaceSearch.timezone(query, store: store)
          guard !Task.isCancelled else { return }
          timezone.resolve(identified, revision: revision)
        } catch { /* Keep the current device time zone when lookup is unavailable. */  }
      }
    }
  }
  func create() {
    creating = true
    creationError = nil
    Task {
      defer { creating = false }
      do {
        let count = TripCreationDate.dayCount(from: start, through: end)
        guard (1...365).contains(count) else { throw APIError(message: "请选择 1 至 365 天的日期范围") }
        try await store.create(
          .object([
            "id": .string(UUID().uuidString),
            "name": .string(name.trimmingCharacters(in: .whitespacesAndNewlines)),
            "destination": .string(destination.trimmingCharacters(in: .whitespacesAndNewlines)),
            "startDate": .string(TripCreationDate.string(start)), "dayCount": .integer(count),
            "teamMode": .string(mode), "timezone": .string(timezone.identifier),
            "currency": .string(currency),
          ]))
        dismiss()
      } catch { creationError = error.localizedDescription }
    }
  }
}

struct TeamModeCards: View {
  @Environment(\.journeyPalette) private var palette
  @Binding var selection: String
  var body: some View {
    VStack(spacing: 12) {
      option("admin", "管理员团队", "创建者与管理员可直接删除。成员可表达自己的意见。", symbol: "shield.lefthalf.filled")
      option("equal", "平等团队", "成员通过集体表态删除内容。创建者也可直接删除。", symbol: "person.3.fill")
    }
  }
  func option(_ value: String, _ title: String, _ detail: String, symbol: String) -> some View {
    let selected = selection == value
    return Button {
      selection = value
    } label: {
      HStack(alignment: .top, spacing: 12) {
        Image(systemName: symbol).font(.title2).foregroundStyle(palette.accent)
          .frame(width: 44, height: 44).background(
            palette.accent.opacity(0.10), in: RoundedRectangle(cornerRadius: 12)
          )
          .accessibilityHidden(true)
        VStack(alignment: .leading, spacing: 6) {
          Text(title).font(.headline).foregroundStyle(palette.text)
          Text(detail).font(.subheadline).foregroundStyle(palette.muted).fixedSize(
            horizontal: false, vertical: true)
        }.frame(maxWidth: .infinity, alignment: .leading)
        Image(systemName: selected ? "checkmark.circle.fill" : "circle").font(.title3)
          .foregroundStyle(selected ? palette.accent : palette.muted).accessibilityHidden(true)
      }.padding(14).frame(maxWidth: .infinity, alignment: .leading)
        .background(
          selected ? palette.accent.opacity(0.09) : palette.surfaceSolid,
          in: RoundedRectangle(cornerRadius: 16)
        )
        .overlay {
          RoundedRectangle(cornerRadius: 16).strokeBorder(
            selected ? palette.accent : palette.border, lineWidth: selected ? 1.5 : 1)
        }
        .contentShape(RoundedRectangle(cornerRadius: 16))
    }.buttonStyle(.plain).accessibilityElement(children: .combine)
      .accessibilityAddTraits(selected ? [.isSelected] : []).accessibilityIdentifier(
        "team.mode." + value)
  }
}

struct JourneyTimeZonePicker: View {
  @Environment(\.journeyPalette) private var palette
  @Binding var selection: String
  var useAutomatic: (() -> Void)? = nil
  var destination: String = ""
  @Environment(\.dismiss) private var dismiss
  @State private var query = ""
  var zones: [String] {
    guard !query.isEmpty else {
      let recommended = [DestinationTimezones.known(destination), TimeZone.current.identifier, selection].compactMap { $0 }
      return Array(NSOrderedSet(array: recommended + TimeZone.knownTimeZoneIdentifiers.sorted())) as? [String] ?? []
    }
    return TimeZone.knownTimeZoneIdentifiers.filter {
      JourneyTimeZone.label($0).localizedCaseInsensitiveContains(query)
        || $0.localizedCaseInsensitiveContains(query)
    }
  }
  var body: some View {
    JourneyList {
      if let useAutomatic {
        Button("根据目的地自动选择", systemImage: "location") {
          useAutomatic()
          dismiss()
        }
        .accessibilityIdentifier("timezone.automatic")
      }
      Section(query.isEmpty ? "目的地、本机与全部时区" : "搜索结果") {
        ForEach(zones, id: \.self) { identifier in
          Button {
            selection = identifier
            dismiss()
          } label: {
            HStack {
              VStack(alignment: .leading, spacing: 4) {
                Text(JourneyTimeZone.label(identifier)).foregroundStyle(palette.text)
                Text(JourneyTimeZone.offset(identifier)).font(.caption).foregroundStyle(
                  palette.muted)
              }
              Spacer()
              if identifier == selection {
                Image(systemName: "checkmark").foregroundStyle(palette.accent)
              }
            }
          }.accessibilityIdentifier("timezone." + identifier)
        }
      }
    }.navigationTitle("旅程时区").navigationBarTitleDisplayMode(.inline).searchable(
      text: $query, prompt: "搜索城市或时区")
  }
}

let currencies = [
  "CNY", "USD", "EUR", "JPY", "GBP", "HKD", "KRW", "SGD", "THB", "TWD", "AUD", "CAD",
]
struct JoinView: View {
  @Environment(\.journeyPalette) private var palette
  @EnvironmentObject var store: JourneyStore
  @Environment(\.dismiss) var dismiss
  @State private var input = ""
  @State private var preview: JSON = .null
  var code: String {
    let t = input.trimmingCharacters(in: .whitespacesAndNewlines)
    if let u = URLComponents(string: t), u.host != nil {
      return u.queryItems?.first { $0.name == "invite" }?.value ?? u.path.split(separator: "/").last
        .map(String.init) ?? t
    }
    return t
  }
  var body: some View {
    NavigationStack {
      JourneyForm {
        TextField("邀请编码或链接", text: $input).textInputAutocapitalization(.never)
          .autocorrectionDisabled().onChange(of: input) { _, _ in preview = .null }
        if !preview.isNull {
          Section {
            Text(preview["name"].string).font(.title2)
            Text(preview["teamMode"].string == "equal" ? "平等团队" : "管理员团队")
          }
        }
        Button(preview.isNull ? "查看旅程" : "确认加入") {
          store.perform {
            if preview.isNull {
              preview = try await store.api(
                "/api/invites/\(code.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? code)"
              )
            } else {
              try await store.join(code)
              dismiss()
            }
          }
        }.disabled(code.isEmpty || store.busy)
      }.navigationTitle("加入旅程").toolbar { Button("取消") { dismiss() } }
    }
  }
}
struct WorkspaceView: View {
  @Environment(\.journeyPalette) private var palette
  @EnvironmentObject var store: JourneyStore
  @State private var tab = "itinerary"
  @State private var focusedActivity: JSON?
  @State private var profile = false
  var body: some View {
    TabView(selection: $tab) {
      NavigationStack { ItineraryView(focusedActivity: focusedActivity).toolbar { personalToolbar } }.toolbar(.hidden, for: .tabBar).tag("itinerary")
      NavigationStack { TripMapView().toolbar { personalToolbar } }.toolbar(.hidden, for: .tabBar).tag("map")
      NavigationStack { ExpensesView().toolbar { personalToolbar } }.toolbar(.hidden, for: .tabBar).tag("ledger")
      NavigationStack { ManageView().toolbar { personalToolbar } }.toolbar(.hidden, for: .tabBar).tag("settings")
    }.sheet(isPresented: $profile) { ProfileView() }
    .safeAreaInset(edge: .bottom, spacing: 0) {
      JourneyTabBar(selection: $tab)
    }.safeAreaInset(edge: .top, spacing: 0) {
      if !store.cache.queue.isEmpty {
        Label("\(store.cache.queue.count) 项修改等待同步", systemImage: "arrow.triangle.2.circlepath")
          .font(.caption).padding(7).frame(maxWidth: .infinity).background(palette.background)
      }
    }
    .onReceive(NotificationCenter.default.publisher(for: Notification.Name("journeyShowActivity"))) { note in
      if let activity = note.object as? JSON { focusedActivity = activity; tab = "itinerary" }
    }
    .onChange(of: tab) { _, value in
      guard let id = store.selectedTrip else { return }
      var context = store.cache.contexts[id] ?? .object([:])
      context["page"] = .string(value)
      store.cache.contexts[id] = context
      store.perform {
        _ = try await store.api(
          "/api/navigation", method: "PUT",
          body: .object(["tripId": .string(id), "context": context]))
      }
    }
    .onAppear {
      if let id = store.selectedTrip, let p = store.cache.contexts[id]?["page"].string, !p.isEmpty {
        tab = p
      }
    }
  }
  @ToolbarContentBuilder private var personalToolbar: some ToolbarContent {
    ToolbarItem(placement: .topBarTrailing) {
      Button { profile = true } label: { Image(systemName: "person.crop.circle") }
        .accessibilityLabel("我的设置").accessibilityIdentifier("settings.personal")
    }
  }

}
enum PreferenceChoice {
  static func string(_ value: JSON) -> String {
    value.isNull ? "system" : value == .bool(true) ? "true" : value == .bool(false) ? "false" : value.string
  }
  static func json(_ value: String) -> JSON {
    value == "system" ? .string("system") : .bool(value == "true")
  }
}

struct ProfileView: View {
  @Environment(\.journeyPalette) private var palette
  @EnvironmentObject var store: JourneyStore
  @Environment(\.dismiss) var dismiss
  @AppStorage("journey.palette") private var paletteName = "forest"
  @AppStorage("journey.theme") private var theme = "system"
  var body: some View {
    NavigationStack {
      JourneyForm {
        Section {
          Label(store.user["displayName"].string, systemImage: "person.crop.circle.fill").font(.title3.bold())
          Text("只对你自己生效，在所有旅程中通用").font(.subheadline).foregroundStyle(palette.muted)
        }
        Section("偏好") {
          NavigationLink { AppearanceSettingsView() } label: {
            LabeledContent("外观", value: (paletteName == "atlas" ? "海图蓝" : "森林绿") + " · " + (theme == "system" ? "跟随系统" : theme == "dark" ? "深色" : "浅色"))
          }.accessibilityIdentifier("settings.appearance")
          NavigationLink("辅助功能") { AccessibilitySettingsView() }
          NavigationLink("通知与提示") { NotificationSettingsView() }
        }
        Section("数据") { NavigationLink("保存与同步") { SyncView() } }
        Section("账号") { NavigationLink("账号") { AccountSettingsView() } }
        Section {
          Button("退出登录", role: .destructive) {
            store.perform { try await store.logout(); dismiss() }
          }.foregroundStyle(palette.danger)
        }
      }.navigationTitle("我的设置").toolbar { Button("完成") { dismiss() } }
    }.preferredColorScheme(theme == "system" ? nil : theme == "dark" ? .dark : .light)
  }
}

struct AppearanceSettingsView: View {
  @Environment(\.journeyPalette) private var palette
  @EnvironmentObject var store: JourneyStore
  @Environment(\.colorScheme) private var colorScheme
  @AppStorage("journey.palette") private var paletteName = "forest"
  @AppStorage("journey.theme") private var theme = "system"
  @AppStorage("journey.reducedTransparency") private var transparency = "system"
  var body: some View {
    JourneyForm {
      Section("主题色") {
        HStack {
          ForEach(["forest", "atlas"], id: \.self) { value in
            Button {
              store.saveAppearancePreference("palette", .string(value))
            } label: {
              SettingsPreview(title: value == "atlas" ? "海图蓝" : "森林绿", colors: DesignTokens.palette(value), selected: paletteName == value)
            }.buttonStyle(.plain).accessibilityIdentifier("settings.palette." + value)
              .accessibilityAddTraits(paletteName == value ? [.isSelected] : [])
          }
        }
      }
      Section("明暗") {
        HStack {
          ForEach(["system", "light", "dark"], id: \.self) { value in
            Button {
              store.saveAppearancePreference("theme", .string(value))
            } label: {
              SettingsPreview(title: value == "system" ? "跟随系统" : value == "dark" ? "深色" : "浅色", colors: DesignTokens.palette(paletteName), selected: theme == value, previewScheme: value == "dark" ? .dark : value == "light" ? .light : nil, split: value == "system")
            }.buttonStyle(.plain).accessibilityIdentifier("settings.theme." + value)
              .accessibilityAddTraits(theme == value ? [.isSelected] : [])
          }
        }
      }
      Section {
        Picker("减少透明效果", selection: Binding(get: { transparency }, set: {
          store.saveAppearancePreference("reducedTransparency", PreferenceChoice.json($0))
        })) { Text("跟随系统").tag("system"); Text("关").tag("false"); Text("开").tag("true") }
          .pickerStyle(.segmented).accessibilityIdentifier("settings.transparency")
      } header: { Text("减少透明效果") } footer: {
        Text("使用不透明的实底卡片和面板，不显示毛玻璃和高光。")
      }
      if let error = store.error {
        Section { Text(error).foregroundStyle(palette.danger).accessibilityIdentifier("settings.error") }
      }
    }.disabled(store.busy || store.savingAppearance).navigationTitle("外观")
  }
}

struct SettingsPreview: View {
  @Environment(\.colorScheme) private var colorScheme
  var title: String
  var colors: DesignTokens.Colors
  var selected: Bool
  var previewScheme: ColorScheme? = nil
  /// “跟随系统”：左半浅色、右半深色，与网页一致，一眼看出会自动切换。
  var split = false
  private var mock: some View {
    HStack(spacing: 6) {
      RoundedRectangle(cornerRadius: 3).fill(colors.selected).frame(width: 15)
      VStack(spacing: 6) {
        Capsule().fill(colors.primary).frame(height: 5).padding(.trailing, 16)
        RoundedRectangle(cornerRadius: 4).fill(colors.surface).frame(height: 18)
        RoundedRectangle(cornerRadius: 4).fill(colors.surface).frame(height: 18)
      }
    }.padding(10).frame(height: 85).background(colors.page, in: RoundedRectangle(cornerRadius: 10))
  }
  var body: some View {
    VStack(spacing: 10) {
      if split {
        ZStack {
          mock.environment(\.colorScheme, .light)
          mock.environment(\.colorScheme, .dark)
            .mask { HStack(spacing: 0) { Color.clear; Color.black } }
        }
      } else {
        mock.environment(\.colorScheme, previewScheme ?? colorScheme)
      }
      Text(title).font(.caption.weight(.semibold)).foregroundStyle(colors.text)
      Image(systemName: selected ? "checkmark.circle.fill" : "circle").foregroundStyle(colors.primary)
    }.frame(maxWidth: .infinity).padding(8)
      .overlay { RoundedRectangle(cornerRadius: 12).strokeBorder(selected ? colors.primary : colors.border, lineWidth: selected ? 2 : 1) }
      .contentShape(Rectangle()).accessibilityElement(children: .ignore).accessibilityLabel(title)
  }
}

struct AccessibilitySettingsView: View {
  @Environment(\.journeyPalette) private var palette
  @EnvironmentObject var store: JourneyStore
  @AppStorage("journey.reducedMotion") private var motion = "system"
  var body: some View {
    JourneyForm {
      Section {
        Picker("减少动态效果", selection: Binding(get: { motion }, set: { value in
          store.saveAppearancePreference("reducedMotion", PreferenceChoice.json(value))
        })) { Text("跟随系统").tag("system"); Text("关").tag("false"); Text("开").tag("true") }.pickerStyle(.segmented)
      } header: { Text("减少动态效果") } footer: { Text("减少页面切换和界面动画。") }
      if let error = store.error {
        Section { Text(error).foregroundStyle(palette.danger).accessibilityIdentifier("settings.error") }
      }
    }.disabled(store.busy || store.savingAppearance).navigationTitle("辅助功能")
  }
}

struct NotificationSettingsView: View {
  var body: some View {
    JourneyForm {
      Section("同伴修改提醒") { Text("打开旅程后，同伴的修改会自动更新。") }
    }.navigationTitle("通知与提示")
  }
}

struct AccountSettingsView: View {
  @EnvironmentObject var store: JourneyStore
  @State private var name = ""
  var body: some View {
    JourneyForm {
      Section("个人资料") {
        TextField("你的称呼", text: $name)
        LabeledContent("登录账号", value: store.user["identifier"].string)
        Button("保存称呼") { store.perform { try await store.updateProfile(.object(["displayName": .string(name)])) } }
          .disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
      }
    }.navigationTitle("账号").onAppear { name = store.user["displayName"].string }
  }
}
struct SyncView: View {
  @Environment(\.journeyPalette) private var palette
  @EnvironmentObject var store: JourneyStore
  @State private var confirm: String?
  var body: some View {
    JourneyList {
      Section {
        Text(store.status)
        Button("重试并确认修改") { Task { await store.retryPending() } }
      }
      ForEach(Array(Set(store.cache.queue.map(\.tripID))).sorted(), id: \.self) { tripID in
        let ops = store.cache.queue.filter { $0.tripID == tripID }
        Section(store.cache.snapshots[tripID]?["trip"]["name"].string ?? "旅程") {
          ForEach(ops) { op in
            VStack(alignment: .leading) {
              Text(
                op.body["patch"]["title"].string.isEmpty ? "旅程修改" : op.body["patch"]["title"].string
              )
              Text(
                op.receiptUnknown
                  ? "正在等待服务器确认"
                  : op.blocked == "CLOCK_UNCERTAIN"
                    ? "需要确认重新应用" : op.blocked == nil ? "等待上传" : "暂时无法提交"
              ).font(.caption).foregroundStyle(palette.muted)
            }
          }
          if ops.first?.blocked == "CLOCK_UNCERTAIN" && !ops.contains(where: \.receiptUnknown) {
            Button("重新应用这些修改") { confirm = tripID }.disabled(store.recoveryBusy)
          }
        }
      }
      if store.cache.queue.isEmpty { Text("修改已保存并同步").foregroundStyle(palette.muted) }
    }.navigationTitle("保存与同步").confirmationDialog(
      "以现在的时间重新应用这些修改？",
      isPresented: Binding(get: { confirm != nil }, set: { if !$0 { confirm = nil } })
    ) {
      Button("确认重新应用") {
        if let id = confirm { store.perform { try await store.reapply(id) } }
        confirm = nil
      }
      Button("取消", role: .cancel) { confirm = nil }
    }
  }
}
