import SwiftUI

struct ManageView: View {
  @EnvironmentObject var store: JourneyStore
  @State private var name = ""
  @State private var destination = ""
  @State private var zone = ""
  @State private var profile = false
  @State private var leave = false
  @State private var purge = false
  var body: some View {
    JourneyForm {
      Section("当前旅程") {
        TextField("旅程名称", text: $name)
        TextField("目的地", text: $destination)
        Picker("旅程时区", selection: $zone) {
          ForEach(TimeZone.knownTimeZoneIdentifiers, id: \.self) { Text($0).tag($0) }
        }
        Button("保存旅程信息") {
          store.perform {
            var patch: [String: JSON] = [:]
            if name != store.trip["name"].string { patch["name"] = .string(name) }
            if destination != store.trip["destination"].string {
              patch["destination"] = .string(destination)
            }
            if zone != store.trip["timezone"].string { patch["timezone"] = .string(zone) }
            if !patch.isEmpty {
              try await store.mutate(object: store.trip, kind: "patch", patch: .object(patch))
            }
          }
        }.journeyButton(prominent: true).disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
        NavigationLink("日期与计划天数") { RescheduleView() }
        NavigationLink("成员与邀请") { TeamView() }
        NavigationLink("已删除的内容") { DeletedView() }
      }
      if store.isOwner {
        Section {
          Picker(
            "团队模式",
            selection: Binding(
              get: { store.trip["teamMode"].string },
              set: { mode in
                store.perform {
                  try await store.change(
                    "/api/trips/\(store.trip.id)/team", method: "PATCH",
                    body: .object(["teamMode": .string(mode)]))
                }
              })
          ) {
            Text("管理员团队").tag("admin")
            Text("平等团队").tag("equal")
          }
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
        Button("个人设置") { profile = true }
        NavigationLink("保存与同步") { SyncView() }
        Button("返回我的旅程") { store.selectedTrip = nil }
      }
    }.navigationTitle("旅程管理")
      .onAppear {
        name = store.trip["name"].string
        destination = store.trip["destination"].string
        zone = store.trip["timezone"].string
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
}
struct DeletedView: View {
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
                Palette.accent)
              VStack(alignment: .leading) {
                Text(member["displayName"].string)
                Text(
                  member["userId"].string == store.trip["ownerId"].string
                    ? "创建者" : member["isAdmin"].bool ? "管理员" : "成员"
                ).font(.caption).foregroundStyle(Palette.muted)
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
            ).font(.caption).foregroundStyle(Palette.muted)
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
