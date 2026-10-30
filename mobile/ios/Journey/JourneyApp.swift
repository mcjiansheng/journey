import SwiftUI

@main struct JourneyApp: App {
  @StateObject private var store = JourneyStore()
  @Environment(\.scenePhase) private var phase
  @AppStorage("journey.theme") private var theme = "system"
  var body: some Scene {
    WindowGroup {
      RootView().environmentObject(store).environment(\.locale, Locale(identifier: "zh_CN")).tint(
        Palette.accent
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
  @EnvironmentObject var store: JourneyStore
  var body: some View {
    Group {
      if !store.ready {
        ProgressView("正在连接同行…").frame(maxWidth: .infinity, maxHeight: .infinity)
          .foregroundStyle(Palette.muted).background { JourneyBackground() }
      } else if store.user.isNull || store.sessionExpired {
        LoginView()
      } else if store.selectedTrip != nil {
        WorkspaceView()
      } else {
        HomeView()
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
            Image(systemName: "safari").font(.system(size: 34)).foregroundStyle(Palette.accent)
              .frame(width: 68, height: 68).background(
                Palette.iconBackground, in: RoundedRectangle(cornerRadius: 22))
            Text("同行").font(.largeTitle.bold())
            Text("JOURNEY").font(.caption).tracking(4)
            Text("和同伴一起，把旅行慢慢安排好。").foregroundStyle(Palette.muted)
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
  @EnvironmentObject var store: JourneyStore
  @State private var sheet: String?
  var body: some View {
    NavigationStack {
      JourneyList {
        Section {
          VStack(alignment: .leading, spacing: 12) {
            Label("同行 JOURNEY", systemImage: "safari").font(.headline).foregroundStyle(
              Palette.accent)
            Text("我的旅程").font(.largeTitle.bold())
            Text("把下一段好时光，留给彼此。").foregroundStyle(Palette.muted)
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
                Image(systemName: "safari").font(.title2).foregroundStyle(Palette.accent)
                  .frame(width: 52, height: 58)
                  .background(Palette.iconBackground, in: RoundedRectangle(cornerRadius: 17))
                VStack(alignment: .leading, spacing: 7) {
                  Text(trip["name"].string).font(.headline).foregroundStyle(Palette.text)
                  Text(
                    [
                      trip["destination"].string, trip["startDate"].string,
                      trip["archived"].bool
                        ? "已归档"
                        : trip["state"].string == "deleted"
                          ? "已删除" : "\(Int(trip["dayCount"].number)) 天",
                    ].filter { !$0.isEmpty }.joined(separator: " · ")
                  ).font(.subheadline).foregroundStyle(Palette.muted)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(
                  Palette.muted)
              }.padding(.vertical, 4)
            }.buttonStyle(.plain).accessibilityIdentifier("trip.open." + trip.id)
          }
        }
        Text(store.status).font(.caption).foregroundStyle(Palette.muted).listRowBackground(
          Color.clear)
      }.navigationTitle("").toolbar {
        Button {
          sheet = "profile"
        } label: {
          Image(systemName: "person.crop.circle")
        }.accessibilityLabel("个人设置")
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
  @EnvironmentObject var store: JourneyStore
  @Environment(\.dismiss) var dismiss
  @State private var name = ""
  @State private var destination = ""
  @State private var zone = ""
  @State private var mode = ""
  @State private var currency = "CNY"
  @State private var start = Date()
  @State private var end = Date()
  @State private var resolving = false
  var body: some View {
    NavigationStack {
      JourneyForm {
        Section {
          TextField("旅程名称", text: $name).accessibilityIdentifier("trip.name")
          TextField("目的地", text: $destination).accessibilityIdentifier("trip.destination")
          DatePicker("出发日期", selection: $start, displayedComponents: .date)
          DatePicker("结束日期", selection: $end, in: start..., displayedComponents: .date)
        }
        Section("同行方式") {
          Picker("团队模式", selection: $mode) {
            Text("请选择").tag("")
            Text("管理员团队").tag("admin")
            Text("平等团队").tag("equal")
          }
          Text(mode == "equal" ? "每位同伴都能共同管理旅程。" : "管理员负责旅程管理，同伴一起编辑安排。").font(.caption)
            .foregroundStyle(Palette.muted)
        }
        Section {
          Picker("记账币种", selection: $currency) { ForEach(currencies, id: \.self) { Text($0) } }
          Picker("旅程时区", selection: $zone) {
            Text("请选择目的地当地时区").tag("")
            ForEach(TimeZone.knownTimeZoneIdentifiers, id: \.self) { Text($0).tag($0) }
          }
          Button(resolving ? "正在确认…" : "按目的地确认时区") {
            Task {
              resolving = true
              defer { resolving = false }
              do { zone = try await PlaceSearch.timezone(destination, store: store) } catch {
                store.error = error.localizedDescription
              }
            }
          }.disabled(destination.isEmpty || resolving)
        }
        Button("创建旅程") {
          store.perform {
            let count =
              JourneyDate.calendar.dateComponents(
                [.day], from: JourneyDate.calendar.startOfDay(for: start),
                to: JourneyDate.calendar.startOfDay(for: end)
              ).day! + 1
            guard (1...365).contains(count) else { throw APIError(message: "请选择 1 至 365 天的日期范围") }
            try await store.create(
              .object([
                "id": .string(UUID().uuidString), "name": .string(name),
                "destination": .string(destination.trimmingCharacters(in: .whitespaces)),
                "startDate": .string(JourneyDate.string(start)), "dayCount": .integer(count),
                "teamMode": .string(mode), "timezone": .string(zone), "currency": .string(currency),
              ]))
            dismiss()
          }
        }.disabled(
          store.busy || name.isEmpty || destination.trimmingCharacters(in: .whitespaces).isEmpty
            || mode.isEmpty || zone.isEmpty
        ).journeyButton(prominent: true).accessibilityIdentifier("trip.create")
      }.navigationTitle("新旅程").toolbar { Button("取消") { dismiss() } }
    }
  }
}
let currencies = [
  "CNY", "USD", "EUR", "JPY", "GBP", "HKD", "KRW", "SGD", "THB", "TWD", "AUD", "CAD",
]
struct JoinView: View {
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
  @EnvironmentObject var store: JourneyStore
  @State private var tab = "itinerary"
  var body: some View {
    TabView(selection: $tab) {
      NavigationStack { ItineraryView() }.toolbar(.hidden, for: .tabBar).tag("itinerary")
      NavigationStack { TripMapView() }.toolbar(.hidden, for: .tabBar).tag("map")
      NavigationStack { ExpensesView() }.toolbar(.hidden, for: .tabBar).tag("ledger")
      NavigationStack { ManageView() }.toolbar(.hidden, for: .tabBar).tag("settings")
    }.safeAreaInset(edge: .bottom, spacing: 0) {
      JourneyTabBar(selection: $tab)
    }.safeAreaInset(edge: .top, spacing: 0) {
      if !store.cache.queue.isEmpty {
        Label("\(store.cache.queue.count) 项修改等待同步", systemImage: "arrow.triangle.2.circlepath")
          .font(.caption).padding(7).frame(maxWidth: .infinity).background(Palette.background)
      }
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
}
struct ProfileView: View {
  @EnvironmentObject var store: JourneyStore
  @Environment(\.dismiss) var dismiss
  @State private var name = ""
  @AppStorage("journey.theme") var theme = "system"
  var body: some View {
    NavigationStack {
      JourneyForm {
        Section("个人资料") {
          TextField("你的称呼", text: $name)
          Text(store.user["identifier"].string).foregroundStyle(Palette.muted)
          Button("保存称呼") {
            store.perform { try await store.updateProfile(.object(["displayName": .string(name)])) }
          }
        }
        Picker("外观", selection: $theme) {
          Text("跟随系统").tag("system")
          Text("浅色").tag("light")
          Text("深色").tag("dark")
        }
        NavigationLink("保存与同步") { SyncView() }
        Button("退出登录", role: .destructive) {
          store.perform {
            try await store.logout()
            dismiss()
          }
        }
      }.navigationTitle("个人设置").toolbar { Button("完成") { dismiss() } }.onAppear {
        name = store.user["displayName"].string
      }
    }
  }
}
struct SyncView: View {
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
              ).font(.caption).foregroundStyle(Palette.muted)
            }
          }
          if ops.first?.blocked == "CLOCK_UNCERTAIN" && !ops.contains(where: \.receiptUnknown) {
            Button("重新应用这些修改") { confirm = tripID }.disabled(store.recoveryBusy)
          }
        }
      }
      if store.cache.queue.isEmpty { Text("修改已保存并同步").foregroundStyle(Palette.muted) }
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
