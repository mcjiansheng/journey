import SwiftUI

struct ItineraryView: View {
  @EnvironmentObject var store: JourneyStore
  @State private var dayID = ""
  @State private var editing: JSON?
  @State private var adding = false
  @State private var routeSelection: RouteSelection?
  @State private var editMode: EditMode = .inactive
  var activities: [JSON] { ActivityOrder.ordered(store.objects, dayID: dayID) }
  var body: some View {
    List {
      Section {
        Picker("计划日", selection: $dayID) {
          ForEach(store.days) { day in Text(dayTitle(day, trip: store.trip)).tag(day.id) }
        }.pickerStyle(.menu)
      }
      if store.trip["state"].string == "deleted" {
        Section {
          Text("旅程已删除")
          LifecycleActions(object: store.trip)
        }
      }
      if activities.isEmpty {
        ContentUnavailableView(
          "这一天还很自由", systemImage: "sun.horizon", description: Text("添加想去的地方和想做的事。"))
      }
      ForEach(activities) { activity in
        VStack(alignment: .leading, spacing: 9) {
          Button {
            editing = activity
          } label: {
            VStack(alignment: .leading, spacing: 7) {
              let p = activity["payload"]
              Text(
                p["time"]["mode"].string == "precise"
                  ? [p["time"]["start"].string, p["time"]["end"].string].filter { !$0.isEmpty }
                    .joined(separator: " – ")
                  : p["time"]["period"].string.isEmpty ? "时间灵活" : p["time"]["period"].string
              ).font(.caption).foregroundStyle(Palette.accent)
              Text(p["title"].string).font(.headline).foregroundStyle(.primary)
              if !p["place"]["name"].string.isEmpty {
                Label(p["place"]["name"].string, systemImage: "mappin").font(.subheadline)
                  .foregroundStyle(.secondary)
              }
              if !p["notes"].string.isEmpty {
                Text(p["notes"].string).font(.subheadline).foregroundStyle(.secondary).lineLimit(3)
              }
              if let url = URL(string: p["url"].string),
                ["https", "http"].contains(url.scheme ?? "")
              {
                Link("查看链接", destination: url).font(.caption)
              }
            }
          }.buttonStyle(.plain)
          LifecycleActions(object: activity)
          Button {
            let route = store.objects.first {
              $0["kind"].string == "route" && $0["state"].string == "active"
                && $0["payload"]["toId"].string == activity.id
            }
            let index = activities.firstIndex { $0.id == activity.id } ?? 0
            let previous =
              route == nil
              ? (index > 0 ? activities[index - 1] : nil)
              : store.objects.first { $0.id == route!["payload"]["fromId"].string }
            routeSelection = RouteSelection(object: route, from: previous, to: activity)
          } label: {
            let route = store.objects.first {
              $0["kind"].string == "route" && $0["state"].string == "active"
                && $0["payload"]["toId"].string == activity.id
            }
            Label(
              route.map { RouteSignature.description($0, objects: store.objects) } ?? "前往这一站",
              systemImage: "point.topleft.down.curvedto.point.bottomright.up"
            )
            .font(.caption).foregroundStyle(Palette.accent)
          }.buttonStyle(.borderless)
        }.padding(.vertical, 8).listRowBackground(Palette.surface)
      }.onMove { offsets, dest in
        var items = activities
        items.move(fromOffsets: offsets, toOffset: dest)
        store.perform {
          for (index, item) in items.enumerated() {
            if item["payload"]["order"].number != Double(index * 1024) {
              try await store.mutate(
                object: item, kind: "patch", patch: .object(["order": .integer(index * 1024)]))
            }
          }
        }
      }
      let outside = store.objects.filter { activity in
        activity["kind"].string == "activity" && activity["state"].string == "active"
          && !store.days.contains(where: { day in day.id == activity["payload"]["dayId"].string })
      }
      if !outside.isEmpty {
        Section("其他安排") {
          ForEach(outside) { item in Button(item["payload"]["title"].string) { editing = item } }
        }
      }
    }.scrollContentBackground(.hidden).background(Palette.background).navigationTitle(
      store.trip["name"].string
    ).navigationBarTitleDisplayMode(.inline).toolbar {
      ToolbarItem(placement: .topBarLeading) {
        Button {
          store.selectedTrip = nil
        } label: {
          Image(systemName: "house")
        }.accessibilityLabel("我的旅程")
      }
      ToolbarItemGroup(placement: .topBarTrailing) {
        Button(editMode == .active ? "完成" : "排序") {
          editMode = editMode == .active ? .inactive : .active
        }
        Button {
          adding = true
        } label: {
          Image(systemName: "plus")
        }.disabled(dayID.isEmpty).accessibilityLabel("添加活动")
      }
    }.sheet(item: $routeSelection) { selection in
      RouteEditor(object: selection.object, from: selection.from, to: selection.to)
    }.environment(\.editMode, $editMode).onAppear { selectDay() }.onChange(of: store.days.map(\.id))
    { _, _ in selectDay() }.sheet(
      isPresented: $adding
    ) { ActivityEditor(dayID: dayID) }.sheet(item: $editing) {
      ActivityEditor(object: $0, dayID: $0["payload"]["dayId"].string)
    }.refreshable {
      do { try await store.refresh() } catch { store.error = error.localizedDescription }
    }
  }
  func selectDay() {
    if !store.days.contains(where: { $0.id == dayID }) { dayID = store.days.first?.id ?? "" }
  }
}
func dayTitle(_ day: JSON, trip: JSON = .null) -> String {
  let date = day["payload"]["date"].string
  let start = trip["startDate"].string
  let ordinal =
    !start.isEmpty && !date.isEmpty
    ? (JourneyDate.calendar.dateComponents(
      [.day], from: JourneyDate.date(start), to: JourneyDate.date(date)
    ).day ?? 0) + 1 : Int(day["payload"]["ordinal"].number)
  return "第 \(ordinal) 天" + (date.isEmpty ? "" : " · \(date)")
}
struct LifecycleActions: View {
  @EnvironmentObject var store: JourneyStore
  let object: JSON
  var expressionChoices: [(String, String)] {
    var choices: [(String, String)] = []
    if object["kind"].string == "activity" { choices.append(("notParticipating", "不参与")) }
    choices.append(
      object["state"].string == "deleted" ? ("wishRestore", "希望恢复") : ("wishDelete", "希望删除"))
    return choices
  }
  var body: some View {
    HStack(spacing: 18) {
      if store.canManage {
        Button(
          object["state"].string == "deleted" ? "恢复" : "删除",
          role: object["state"].string == "deleted" ? nil : .destructive
        ) {
          store.perform {
            try await store.mutate(
              object: object, kind: object["state"].string == "deleted" ? "restore" : "delete")
          }
        }
      }
      Menu("表态") {
        ForEach(expressionChoices, id: \.0) { key, title in
          let active =
            object["expressions"].array.first { $0["userId"].string == store.user.id }?[key].bool
            ?? false
          Button(active ? "取消\(title)" : title) {
            store.perform {
              try await store.mutate(
                object: object, kind: "express", expression: .object([key: .bool(!active)]))
            }
          }
        }
      }
      let count = object["expressions"].array.filter {
        $0["wishDelete"].bool || $0["wishRestore"].bool || $0["notParticipating"].bool
      }.count
      if count > 0 { Text("\(count) 位同伴已表态").foregroundStyle(.secondary) }
    }.font(.caption).buttonStyle(.borderless)
  }
}
struct ActivityEditor: View {
  @EnvironmentObject var store: JourneyStore
  @Environment(\.dismiss) var dismiss
  var object: JSON? = nil
  var dayID: String
  var initialPlace: JSON = .null
  @State private var form: JSON = .null
  @State private var baseline: JSON = .null
  @State private var account = ""
  @State private var tripID = ""
  @State private var draftKey = ""
  @State private var dirty = Set<String>()
  @State private var restore: JSON = .null
  @State private var search = false
  @State private var initialized = false
  @State private var finished = false
  func text(_ key: String) -> Binding<String> {
    Binding(
      get: { form[key].string },
      set: {
        form[key] = .string($0)
        changed(key)
      })
  }
  func nested(_ key: String, _ field: String) -> Binding<String> {
    Binding(
      get: { form[key][field].string },
      set: {
        form[key][field] = .string($0)
        changed(key)
      })
  }
  func changed(_ key: String) {
    guard initialized, !finished else { return }
    dirty.insert(key)
    do {
      try store.setDraft(
        draftKey,
        .object(["form": form, "baseline": baseline, "dirty": .array(dirty.map(JSON.string))]))
    } catch { store.error = error.localizedDescription }
  }
  var body: some View {
    NavigationStack {
      Form {
        if !restore.isNull {
          Section {
            Text("有上次未完成的输入")
            Button("恢复输入") {
              form = restore["form"]
              dirty = Set(restore["dirty"].array.map(\.string))
              restore = .null
            }
            Button("使用当前内容") {
              restore = .null
              try? store.removeDraft(draftKey)
            }
          }
        }
        Section {
          TextField("活动名称", text: text("title"))
          Picker("计划日", selection: text("dayId")) {
            ForEach(store.days) { Text(dayTitle($0, trip: store.trip)).tag($0.id) }
          }
        }
        Section("时间") {
          Picker("时间安排", selection: nested("time", "mode")) {
            Text("灵活安排").tag("flexible")
            Text("明确时间").tag("precise")
          }
          if form["time"]["mode"].string == "precise" {
            TextField("开始 HH:mm", text: nested("time", "start")).keyboardType(
              .numbersAndPunctuation)
            TextField("结束 HH:mm", text: nested("time", "end")).keyboardType(.numbersAndPunctuation)
            Stepper(
              "结束于 \(Int(form["time"]["endDayOffset"].number)) 天后",
              value: Binding(
                get: { Int(form["time"]["endDayOffset"].number) },
                set: {
                  form["time"]["endDayOffset"] = .integer($0)
                  changed("time")
                }), in: 0...7)
          } else {
            Picker("时段", selection: nested("time", "period")) {
              Text("不限").tag("")
              Text("上午").tag("morning")
              Text("下午").tag("afternoon")
              Text("晚上").tag("evening")
            }
          }
        }
        Section("地点") {
          Button(form["place"].isNull ? "搜索地点" : form["place"]["name"].string) { search = true }
          if !form["place"].isNull {
            Text(form["place"]["address"].string).font(.caption).foregroundStyle(.secondary)
            Button("移除地点", role: .destructive) {
              form["place"] = .null
              changed("place")
            }
          }
        }
        Section("缓冲时间") {
          buffer("before", "提前（分钟）")
          buffer("after", "结束后（分钟）")
        }
        Section {
          TextField("备注", text: text("notes"), axis: .vertical).lineLimit(3...8)
          TextField("相关链接", text: text("url")).keyboardType(.URL).textInputAutocapitalization(
            .never
          ).autocorrectionDisabled()
        }
      }.navigationTitle(object == nil ? "添加活动" : "编辑活动").toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) {
          Button("保存") { save() }.disabled(
            form["title"].string.trimmingCharacters(in: .whitespaces).isEmpty || store.busy
              || !restore.isNull
          ).accessibilityIdentifier("activity.save")
        }
      }.onAppear { initialize() }.onChange(of: store.objects) { _, objects in
        guard let obj = objects.first(where: { $0.id == object?.id }) else { return }
        for (key, value) in obj["payload"].dictionary where !dirty.contains(key) {
          form[key] = value
        }
      }.sheet(isPresented: $search) {
        PlacePicker { place in
          form["place"] = place
          changed("place")
        }
      }
    }
  }
  func buffer(_ key: String, _ label: String) -> some View {
    TextField(
      label,
      text: Binding(
        get: { form["buffers"][key].isNull ? "" : String(Int(form["buffers"][key].number)) },
        set: {
          form["buffers"][key] = Double($0).map(JSON.number) ?? .null
          changed("buffers")
        })
    ).keyboardType(.numberPad)
  }
  func initialize() {
    guard !initialized else { return }
    initialized = true
    tripID = store.selectedTrip ?? ""
    account = store.user.id
    draftKey = "\(tripID):activity:\(object?.id ?? "new")"
    form =
      object?["payload"]
      ?? .object([
        "title": .string(""), "dayId": .string(dayID),
        "order": .number(
          (store.objects.filter { $0["kind"].string == "activity" }.map {
            $0["payload"]["order"].number
          }.max() ?? 0) + 1024),
        "time": .object([
          "mode": .string("flexible"), "period": .string(""), "start": .null, "end": .null,
          "endDayOffset": .integer(0),
        ]), "place": initialPlace, "buffers": .object(["before": .null, "after": .null]),
        "notes": .string(""), "url": .string(""),
      ])
    baseline = form
    let saved = store.draft(draftKey)
    if !saved.isNull { restore = saved }
  }
  func save() {
    store.perform {
      if form["time"]["mode"].string == "precise" {
        let pattern = #"^([01]\d|2[0-3]):[0-5]\d$"#
        guard form["time"]["start"].string.range(of: pattern, options: .regularExpression) != nil
        else { throw APIError(message: "开始时间请填写 HH:mm") }
        if !form["time"]["end"].string.isEmpty,
          form["time"]["end"].string.range(of: pattern, options: .regularExpression) == nil
        {
          throw APIError(message: "结束时间请填写 HH:mm")
        }
      }
      if form["time"]["mode"].string == "flexible" {
        form["time"]["start"] = .null
        form["time"]["end"] = .null
      }
      for key in ["start", "end"] where form["time"][key].string.isEmpty {
        form["time"][key] = .null
      }
      let patch = object == nil ? form : .object(form.dictionary.filter { dirty.contains($0.key) })
      if object == nil || !patch.dictionary.isEmpty {
        try await store.mutate(
          object: object, kind: object == nil ? "create" : "patch",
          type: object == nil ? "activity" : nil, patch: patch, expectedTrip: tripID,
          expectedAccount: account)
      }
      finished = true
      try store.removeDraft(draftKey)
      dismiss()
    }
  }
}
