import SwiftUI

struct ManageView: View {
  @Environment(\.journeyPalette) private var palette
  @EnvironmentObject var store: JourneyStore
  @State private var name = ""
  @State private var destination = ""
  @State private var zone = ""
  @State private var profile = false
  @State private var leave = false
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
          JourneyTimeZonePicker(selection: $zone)
        } label: {
          LabeledContent("旅程时区", value: JourneyTimeZone.label(zone))
        }
        if saved {
          Label("已保存", systemImage: "checkmark").font(.caption).foregroundStyle(palette.muted)
        }
        NavigationLink("日期与计划天数") { RescheduleView() }
        NavigationLink("成员与邀请") { TeamView() }
        NavigationLink("已删除的内容") { DeletedView() }
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
        } footer: {
          Text("大家都能添加和编辑行程。")
        }
      }
      Section {
        LifecycleActions(object: store.trip)
        Button(
          store.cache.trips.first(where: { $0.id == store.trip.id })?["archived"].bool == true
            ? "取消归档" : "归档旅程"
        ) {
          store.perform {
            let archived =
              store.cache.trips.first(where: { $0.id == store.trip.id })?["archived"].bool ?? false
            try await store.change(
              "/api/trips/\(store.trip.id)/archive", body: .object(["archived": .bool(!archived)]))
          }
        }
        Button("退出旅程", role: .destructive) { leave = true }
      }
      Section {
        Text("想改主题色或提醒方式？点右上角头像打开我的设置。")
          .font(.caption).foregroundStyle(palette.muted)
        Button("我的设置") { profile = true }
        NavigationLink("保存与同步") { SyncView() }
        Button("返回我的旅程") { store.selectedTrip = nil }
      }
    }.navigationTitle("旅程设置").navigationBarTitleDisplayMode(.large)
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
  @Environment(\.journeyPalette) private var palette
  @EnvironmentObject var store: JourneyStore
  @Environment(\.dismiss) var dismiss
  @State private var start = Date()
  @State private var end = Date()
  @State private var moveActivities = false
  var body: some View {
    JourneyForm {
      DatePicker("出发日期", selection: $start, displayedComponents: .date)
      DatePicker("结束日期", selection: $end, in: start..., displayedComponents: .date)
      Toggle("活动随原计划日一起移动", isOn: $moveActivities)
      Button("保存日期") {
        store.perform {
          let count =
            JourneyDate.calendar.dateComponents(
              [.day], from: JourneyDate.calendar.startOfDay(for: start),
              to: JourneyDate.calendar.startOfDay(for: end)
            ).day! + 1
          guard (1...365).contains(count) else { throw APIError(message: "请选择 1 至 365 天的日期范围") }
          let moves: [JSON] =
            moveActivities
            ? store.objects.filter { $0["kind"].string == "activity" }.compactMap { activity in
              guard
                let day = store.allDays.first(where: {
                  $0.id == activity["payload"]["dayId"].string
                })
              else { return nil }
              return .object([
                "activityId": .string(activity.id), "ordinal": day["payload"]["ordinal"],
              ])
            } : []
          try await store.mutate(
            object: store.trip, kind: "reschedule",
            patch: .object([
              "startDate": .string(JourneyDate.string(start)), "dayCount": .integer(count),
              "moves": .array(moves),
            ]))
          dismiss()
        }
      }
    }.navigationTitle("日期与计划天数").onAppear {
      start = JourneyDate.date(store.trip["startDate"].string)
      end = JourneyDate.calendar.date(
        byAdding: .day, value: max(0, Int(store.trip["dayCount"].number) - 1), to: start)!
    }
  }
}
