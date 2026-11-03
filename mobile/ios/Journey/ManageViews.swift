import SwiftUI

struct ManageView: View {
  @Environment(\.journeyPalette) private var palette
  @EnvironmentObject var store: JourneyStore
  @State private var name = ""
  @State private var destination = ""
  @State private var zone = ""
  @State private var profile = false
  @State private var leave = false
  @State private var archiveConfirm = false
  @State private var purge = false
  @FocusState private var focused: String?
  @State private var saved = false
  @State private var tripID = ""
  @State private var account = ""
  @State private var baselineInfo: JSON = .null
  @State private var dirtyInfo = Set<String>()
  var infoDraftKey: String { "\(tripID):trip-info" }
  var info: JSON {
    .object(["name": .string(name), "destination": .string(destination), "timezone": .string(zone)])
  }
  /// 与网页、Android 一致：按“除自己以外的同伴”计数；只有自己时给出邀请提示。
  var scopeText: String {
    let others = max(0, store.snapshot["members"].array.count - 1)
    return others > 0
      ? "修改会同步给其他 \(others) 位同伴"
      : "目前只有你一人。邀请同伴后，这里的修改会同步给他们"
  }
  var body: some View {
    JourneyForm {
      Section {
        // 范围说明是标题下的普通说明文字，不放进白色卡片，避免看起来像输入框
        Text(scopeText)
          .font(.subheadline).foregroundStyle(palette.muted)
          .listRowBackground(Color.clear)
          .listRowInsets(EdgeInsets(top: 0, leading: 4, bottom: 0, trailing: 4))
      }
      Section("基本信息") {
        LabeledContent("名称") {
          TextField("旅程名称", text: $name).focused($focused, equals: "name")
            .multilineTextAlignment(.trailing)
        }
        LabeledContent("目的地") {
          TextField("目的地", text: $destination).focused($focused, equals: "destination")
            .multilineTextAlignment(.trailing)
        }
        NavigationLink {
          JourneyTimeZonePicker(selection: $zone, destination: destination)
        } label: {
          LabeledContent("旅程时区", value: JourneyTimeZone.label(zone))
        }
        if saved {
          Label("已保存", systemImage: "checkmark").font(.caption).foregroundStyle(palette.muted)
        }
      }
      Section("日程") {
        NavigationLink("日期 · \(store.trip["dayCount"].number.formatted()) 天") { RescheduleView() }
      }
      Section("成员与权限") {
        NavigationLink { TeamView() } label: {
          LabeledContent("成员与邀请", value: store.snapshot["members"].array.count <= 1 ? "仅你一人" : "\(store.snapshot["members"].array.count) 人")
        }

      }
      if store.isOwner {
        Section {
          TeamModeCards(
            selection: Binding(
              get: { store.trip["teamMode"].string },
              set: { mode in
                store.perform {
                  try await store.change(
                    "/api/trips/\(store.trip.id)/team", method: "PATCH",
                    body: .object(["teamMode": .string(mode)]))
                }
              }))
        } header: { Text("团队类型") } footer: {
          Text("大家都能添加和编辑行程。")
        }
      }
      Section {
        NavigationLink("已删除的内容 · \(store.objects.filter { $0["state"].string == "deleted" }.count)") { DeletedView() }
        Button(
          store.cache.trips.first(where: { $0.id == store.trip.id })?["archived"].bool == true
            ? "取消归档" : "归档旅程"
        ) {
          archiveConfirm = true
        }
      } header: { Text("整理") } footer: { Text("归档后从我的旅程列表收起，可随时取消。") }
      Section {
        if store.isOwner { LifecycleActions(object: store.trip) }
        Button(store.snapshot["members"].array.count == 1 ? "退出并删除旅程" : "退出旅程", role: .destructive) { leave = true }
      }
      Section {
        Text("想改主题色或提醒方式？点右上角头像打开我的设置。")
          .font(.caption).foregroundStyle(palette.muted)
        Button("我的设置") { profile = true }
        NavigationLink("保存与同步") { SyncView() }
        Button("返回我的旅程") { store.selectedTrip = nil }
      }
    }.navigationTitle("旅程设置").navigationBarTitleDisplayMode(.large)
      .confirmationDialog("归档状态", isPresented: $archiveConfirm) {
        Button(store.cache.trips.first(where: { $0.id == store.trip.id })?["archived"].bool == true ? "取消归档" : "归档旅程") {
          store.perform {
            let archived =
              store.cache.trips.first(where: { $0.id == store.trip.id })?["archived"].bool ?? false
            try await store.change(
              "/api/trips/\(store.trip.id)/archive", body: .object(["archived": .bool(!archived)]))
          }

        }
      }

      .onChange(of: info) { _, value in
        guard !tripID.isEmpty else { return }
        for key in ["name", "destination", "timezone"] where value[key] != baselineInfo[key] {
          dirtyInfo.insert(key)
        }
        do {
          try store.setDraft(
            infoDraftKey, .object(["form": value, "dirty": .array(dirtyInfo.map(JSON.string))]))
        } catch {
          store.error = error.localizedDescription
        }
        saved = false
      }
      .onChange(of: focused) { old, _ in if old != nil { saveInfo() } }
      .onChange(of: zone) { old, _ in if !old.isEmpty { saveInfo() } }
      .onDisappear { saveInfo() }
      .onAppear {
        name = store.trip["name"].string
        destination = store.trip["destination"].string
        zone = store.trip["timezone"].string
        baselineInfo = info
        tripID = store.trip.id
        account = store.user.id
        let draft = store.draft(infoDraftKey)
        if !draft.isNull {
          dirtyInfo = Set(draft["dirty"].array.map(\.string))
          if dirtyInfo.contains("name") { name = draft["form"]["name"].string }
          if dirtyInfo.contains("destination") { destination = draft["form"]["destination"].string }
          if dirtyInfo.contains("timezone") { zone = draft["form"]["timezone"].string }
        }
      }.sheet(isPresented: $profile) { ProfileView() }.sheet(isPresented: $leave) {
        NavigationStack {
          JourneyForm {
            if store.snapshot["members"].array.count == 1 {
              Text("你是最后一位成员，退出后旅程及其内容将永久清除。")
              Toggle("确认永久清除旅程及内容", isOn: $purge)
            } else {
              Text("退出后将无法继续查看和编辑这段旅程。")
            }
            Button("确认退出", role: .destructive) {
              store.perform {
                _ = try await store.api(
                  "/api/trips/\(store.trip.id)/leave", method: "POST",
                  body: .object(["confirmPurge": .bool(purge)]))
                store.selectedTrip = nil
                try await store.refreshTrips()
                leave = false
              }
            }.disabled(store.snapshot["members"].array.count == 1 && !purge)
          }.navigationTitle("退出旅程").toolbar { Button("取消") { leave = false } }
        }
      }
  }
  func saveInfo() {
    guard store.selectedTrip == tripID else { return }
    guard !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
    var patch: [String: JSON] = [:]
    if dirtyInfo.contains("name"), name != store.trip["name"].string {
      patch["name"] = .string(name)
    }
    if dirtyInfo.contains("destination"), destination != store.trip["destination"].string {
      patch["destination"] = .string(destination)
    }
    if dirtyInfo.contains("timezone"), zone != store.trip["timezone"].string {
      patch["timezone"] = .string(zone)
    }
    guard !patch.isEmpty else { return }
    let trip = store.trip
    store.perform {
      try await store.mutate(
        object: trip, kind: "patch", patch: .object(patch), expectedTrip: tripID,
        expectedAccount: account)
      try store.removeDraft(infoDraftKey)
      baselineInfo = info
      dirtyInfo.removeAll()
      saved = true
    }
  }

}
struct DeletedView: View {
  @Environment(\.journeyPalette) private var palette
  @EnvironmentObject var store: JourneyStore
  var body: some View {
    JourneyList {
      ForEach(store.objects.filter { $0["state"].string == "deleted" }) { o in
        VStack(alignment: .leading, spacing: 12) {
          Text(
            o["payload"]["title"].string.isEmpty
              ? o["payload"]["name"].string.isEmpty
                ? o["payload"]["date"].string.isEmpty ? "计划内容" : o["payload"]["date"].string
                : o["payload"]["name"].string : o["payload"]["title"].string)
          LifecycleActions(object: o)
        }.padding(.vertical, 8)
      }
    }.navigationTitle("已删除的内容")
  }
}
struct TeamView: View {
  @Environment(\.journeyPalette) private var palette
  @EnvironmentObject var store: JourneyStore
  @State private var invites: [JSON] = []
  @State private var invite: JSON = .null
  @State private var hours = 24
  var body: some View {
    JourneyList {
      Section("同行的伙伴") {
        ForEach(store.snapshot["members"].array, id: \.id) { member in
          VStack(alignment: .leading, spacing: 10) {
            HStack {
              Image(systemName: "person.crop.circle.fill").font(.title2).foregroundStyle(
                palette.accent)
              VStack(alignment: .leading) {
                Text(member["displayName"].string)
                Text(
                  member["userId"].string == store.trip["ownerId"].string
                    ? "创建者" : member["isAdmin"].bool ? "管理员" : "成员"
                ).font(.caption).foregroundStyle(palette.muted)
              }
            }
            if store.isOwner && member["userId"].string != store.trip["ownerId"].string {
              Toggle("管理员", isOn: memberBinding(member, "isAdmin"))
              Toggle("可邀请", isOn: memberBinding(member, "canInvite"))
            }
            if store.canManage && member["userId"].string != store.trip["ownerId"].string
              && member["userId"].string != store.user.id
            {
              Button("移除成员", role: .destructive) {
                store.perform {
                  try await store.change(
                    "/api/trips/\(store.trip.id)/members/\(member["userId"].string)",
                    method: "DELETE")
                }
              }
            }
          }.padding(.vertical, 8)
        }
      }
      if store.isOwner
        || store.snapshot["members"].array.contains(where: {
          $0["userId"].string == store.user.id && $0["canInvite"].bool
        })
      {
        Section("邀请同伴") {
          Picker("有效期", selection: $hours) {
            Text("1 小时").tag(1)
            Text("1 天").tag(24)
            Text("3 天").tag(72)
            Text("7 天").tag(168)
          }
          Button("生成邀请") {
            store.perform {
              invite = try await store.api(
                "/api/trips/\(store.trip.id)/invites", method: "POST",
                body: .object(["expiresInHours": .integer(hours)]))
              await reload()
            }
          }
          if !invite.isNull {
            Text(invite["code"].string).font(.title2.monospaced()).textSelection(.enabled)
            if let url = URL(string: invite["url"].string) { ShareLink("分享邀请", item: url) }
            Text(
              "有效至 " + Date(timeIntervalSince1970: invite["expiresAt"].number / 1000).formatted()
            ).font(.caption).foregroundStyle(palette.muted)
          }
        }
      }
      if store.canManage {
        Section("发出的邀请") {
          ForEach(invites) { i in
            HStack {
              Text(
                i["revokedAt"].isNull
                  ? "有效至 " + Date(timeIntervalSince1970: i["expiresAt"].number / 1000).formatted()
                  : "已撤销"
              ).font(.caption)
              Spacer()
              if i["revokedAt"].isNull {
                Button("撤销", role: .destructive) {
                  store.perform {
                    _ = try await store.api(
                      "/api/trips/\(store.trip.id)/invites/\(i.id)", method: "DELETE")
                    await reload()
                  }
                }
              }
            }
          }
        }
      }
    }.navigationTitle("成员与邀请").task { await reload() }
  }
  func reload() async {
    if store.canManage {
      do {
        invites = try await store.api("/api/trips/\(store.trip.id)/invites")["invites"].array
      } catch { store.error = error.localizedDescription }
    }
  }
  func memberBinding(_ m: JSON, _ key: String) -> Binding<Bool> {
    Binding(
      get: { m[key].bool },
      set: { value in
        store.perform {
          try await store.change(
            "/api/trips/\(store.trip.id)/members/\(m["userId"].string)", method: "PATCH",
            body: .object([key: .bool(value)]))
        }
      })
  }
}
struct RescheduleView: View {
  @EnvironmentObject var store: JourneyStore
  @Environment(\.dismiss) var dismiss
  @State private var start = Date()
  @State private var end = Date()
  @State private var reviewing = false
  @State private var choice = "move"
  @State private var individual: [String: Int] = [:]
  var count: Int { (JourneyDate.calendar.dateComponents([.day], from: JourneyDate.calendar.startOfDay(for: start), to: JourneyDate.calendar.startOfDay(for: end)).day ?? 0) + 1 }
  var activities: [JSON] { store.objects.filter { $0["kind"].string == "activity" && $0["state"].string == "active" } }
  func ordinal(_ activity: JSON) -> Int? {
    guard let day = store.allDays.first(where: { $0.id == activity["payload"]["dayId"].string }) else { return nil }
    let date = day["payload"]["date"].string, old = store.trip["startDate"].string
    let n = date.isEmpty || old.isEmpty ? Int(day["payload"]["ordinal"].number) : (JourneyDate.calendar.dateComponents([.day], from: JourneyDate.date(old), to: JourneyDate.date(date)).day ?? 0) + 1
    return date.isEmpty == old.isEmpty && (1...max(1, Int(store.trip["dayCount"].number))).contains(n) ? n : nil
  }
  var shifted: Bool { JourneyDate.string(start) != store.trip["startDate"].string }
  var affected: [JSON] { activities.filter { a in guard let n = ordinal(a) else { return false }; return shifted || n > count } }
  func target(_ activity: JSON) -> Int? {
    guard let n = ordinal(activity) else { return nil }
    if choice == "keep" { return nil }
    if choice == "individual" { return individual[activity.id] }
    return min(n, count)
  }
  var body: some View {
    JourneyForm {
      Section("选择日期") {
        TripRangeCalendar(start: $start, end: $end, originalStart: JourneyDate.date(store.trip["startDate"].string), originalCount: Int(store.trip["dayCount"].number))
          .onChange(of: start) { _, _ in reviewing = false }
          .onChange(of: end) { _, _ in reviewing = false }
        Text("\(JourneyDate.string(start)) – \(JourneyDate.string(end)) · \(count) 天")
        Text("原来 \(store.trip["startDate"].string) · \(Int(store.trip["dayCount"].number)) 天").font(.caption)
      }.environment(\.timeZone, TimeZone(secondsFromGMT: 0)!)
      if reviewing {
        Section("已有安排怎么办") {
          Picker("安排", selection: $choice) {
            Text(shifted ? "跟着一起移动" : "移到最后一天").tag("move")
            Text(shifted ? "留在原来的日期" : "放进行程外安排").tag("keep")
            Text("逐项选择…").tag("individual")
          }.pickerStyle(.inline)
          ForEach(choice == "individual" ? affected : Array(affected.prefix(3))) { activity in
            let n = target(activity)
            let oldDay = store.allDays.first { $0.id == activity["payload"]["dayId"].string }
            VStack(alignment: .leading) {
              Text(activity["payload"]["title"].string)
              Text("\(oldDay?["payload"]["date"].string ?? "日期待定") → \(n.map { JourneyDate.string(JourneyDate.calendar.date(byAdding: .day, value: $0 - 1, to: start)!) } ?? "保留原日期")").font(.caption)
              if choice == "individual" {
                Picker("移到", selection: Binding(get: { individual[activity.id] ?? 0 }, set: { individual[activity.id] = $0 == 0 ? nil : $0 })) {
                  Text("保留原日期").tag(0)
                  ForEach(1...max(1, min(count, 365)), id: \.self) { Text("第 \($0) 天").tag($0) }
                }
              }
            }
          }
        }
      }
      Button(!reviewing && !affected.isEmpty ? "下一步" : "完成") {
        guard reviewing || affected.isEmpty else { choice = "move"; reviewing = true; return }
        store.perform {
          guard (1...365).contains(count) else { throw APIError(message: "请选择 1 至 365 天的日期范围") }
          let moves = activities.compactMap { activity -> JSON? in
            guard let n = target(activity) else { return nil }
            return .object(["activityId": .string(activity.id), "ordinal": .integer(n), "date": .string(JourneyDate.string(JourneyDate.calendar.date(byAdding: .day, value: n - 1, to: start)!))])
          }
          try await store.mutate(object: store.trip, kind: "reschedule", patch: .object(["startDate": .string(JourneyDate.string(start)), "dayCount": .integer(count), "moves": .array(moves)]))
          dismiss()
        }
      }.disabled(!(1...365).contains(count))
    }.navigationTitle("调整日期").onAppear {
      start = JourneyDate.date(store.trip["startDate"].string)
      end = JourneyDate.calendar.date(byAdding: .day, value: max(0, Int(store.trip["dayCount"].number) - 1), to: start)!
    }
  }
}

struct TripRangeCalendar: View {
  @Environment(\.journeyPalette) private var palette
  @Binding var start: Date
  @Binding var end: Date
  var originalStart: Date
  var originalCount: Int
  @State private var month = Date()
  @State private var selectingEnd = false
  var calendar: Calendar { JourneyDate.calendar }
  var first: Date { calendar.date(from: calendar.dateComponents([.year, .month], from: month))! }
  var offset: Int { (calendar.component(.weekday, from: first) + 5) % 7 }
  var body: some View {
    VStack(spacing: 12) {
      HStack {
        Button { month = calendar.date(byAdding: .month, value: -1, to: month)! } label: { Image(systemName: "chevron.left") }.accessibilityLabel("上个月")
        Spacer()
        Text("\(calendar.component(.year, from: first)) 年 \(calendar.component(.month, from: first)) 月")
        Spacer()
        Button { month = calendar.date(byAdding: .month, value: 1, to: month)! } label: { Image(systemName: "chevron.right") }.accessibilityLabel("下个月")
      }
      Text(selectingEnd ? "再点结束日期" : "点选开始日期").font(.caption).foregroundStyle(palette.muted)
      LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 2), count: 7), spacing: 5) {
        ForEach(Array(["一", "二", "三", "四", "五", "六", "日"].enumerated()), id: \.offset) { _, name in Text(name).font(.caption).foregroundStyle(palette.muted) }
        ForEach(0..<(offset + calendar.range(of: .day, in: .month, for: first)!.count), id: \.self) { index in
          if index < offset { Color.clear.frame(height: 40) }
          else {
            let date = calendar.date(byAdding: .day, value: index - offset, to: first)!
            let selected = date >= calendar.startOfDay(for: start) && date <= calendar.startOfDay(for: end)
            let oldEnd = calendar.date(byAdding: .day, value: max(0, originalCount - 1), to: originalStart)!
            let removed = date >= originalStart && date <= oldEnd && !selected
            Button {
              if selectingEnd { let previous = start; start = min(previous, date); end = max(previous, date) }
              else { start = date; end = date }
              selectingEnd.toggle()
            } label: {
              Text("\(index - offset + 1)").font(.subheadline).frame(maxWidth: .infinity).frame(height: 40)
                .background(selected ? palette.accent : .clear, in: RoundedRectangle(cornerRadius: 8))
                .foregroundStyle(selected ? palette.onAccent : palette.text)
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(removed ? palette.muted : .clear, style: StrokeStyle(lineWidth: 1, dash: [3, 3])))
            }.buttonStyle(.plain).accessibilityLabel(JourneyDate.string(date)).accessibilityAddTraits(selected ? .isSelected : [])
          }
        }
      }
    }.onAppear { month = start }
  }
}
