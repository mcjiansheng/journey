import SwiftUI

struct ItineraryView: View {
  var focusedActivity: JSON? = nil
  @State private var highlighted = ""
  @State private var swapping = false
  @Environment(\.journeyPalette) private var palette
  @EnvironmentObject var store: JourneyStore
  @State private var dayID = ""
  @State private var editing: JSON?
  @State private var adding = false
  @State private var routeSelection: RouteSelection?
  @State private var editMode: EditMode = .inactive
  var activities: [JSON] { ActivityOrder.ordered(store.objects, dayID: dayID) }
  var body: some View {
    ScrollViewReader { scroll in
    JourneyList {
      Section(store.trip["name"].string) {
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
      if editMode == .active { Section { Text("按住 ⋮⋮ 拖动调整顺序；有具体时间的安排会按时间自动排列").font(.caption) } }
      if activities.isEmpty {
        ContentUnavailableView(
          "这一天还很自由", systemImage: "sun.horizon", description: Text("添加想去的地方和想做的事。"))
      }
      ForEach(activities) { activity in
        VStack(alignment: .leading, spacing: 12) {
          if editMode != .active, let route = routeFor(activity) {
            Button {
              openRoute(activity)
            } label: {
              Label(
                RouteSignature.description(route, objects: store.objects),
                systemImage: "point.topleft.down.curvedto.point.bottomright.up"
              )
              .font(.caption).foregroundStyle(palette.muted)
            }.buttonStyle(.plain).listRowBackground(Color.clear)
          }
          VStack(alignment: .leading, spacing: 9) {
            Button {
              editing = activity
            } label: {
              (editMode == .active ? AnyLayout(HStackLayout(alignment: .center, spacing: 8)) : AnyLayout(VStackLayout(alignment: .leading, spacing: 7))) {
                let p = activity["payload"]
                Text(
                  p["time"]["mode"].string == "precise"
                    ? [p["time"]["start"].string, p["time"]["end"].string].filter { !$0.isEmpty }
                      .joined(separator: " – ")
                    : p["time"]["period"].string.isEmpty ? "时间灵活" : p["time"]["period"].string
                ).font(.caption).foregroundStyle(palette.accent)
                Text(p["title"].string).lineLimit(editMode == .active ? 1 : nil).font(.headline).foregroundStyle(palette.text)
                let placeName = p["place"]["name"].string
                let trimmedPlace = placeName.trimmingCharacters(in: .whitespacesAndNewlines)
                if !trimmedPlace.isEmpty,
                  trimmedPlace != p["title"].string.trimmingCharacters(in: .whitespacesAndNewlines)
                {
                  Label(placeName, systemImage: "mappin").font(.subheadline)
                    .foregroundStyle(palette.muted)
                }
                if editMode != .active && !p["notes"].string.isEmpty {
                  Text(p["notes"].string).font(.subheadline).foregroundStyle(palette.muted)
                    .lineLimit(
                      1)
                }
                if editMode != .active, let url = URL(string: p["url"].string),
                  ["https", "http"].contains(url.scheme ?? "")
                {
                  Link("查看链接", destination: url).font(.caption)
                }
              }
            }.buttonStyle(.plain)
            if editMode != .active { LifecycleActions(
              object: activity, edit: { editing = activity }, route: { openRoute(activity) }) }
          }.contextMenu {
            LifecycleMenu(
              object: activity, edit: { editing = activity }, route: { openRoute(activity) })
          }.swipeActions {
            if store.canManage {
              Button("删除", role: .destructive) { store.deleteWithUndo(activity) }
            }
          }.padding(16).background(JourneyCard())
        }.id(activity.id).listRowBackground(Color.clear)
          .overlay(RoundedRectangle(cornerRadius: 16).stroke(highlighted == activity.id ? palette.accent : .clear, lineWidth: 3))
          .moveDisabled(activity["payload"]["time"]["mode"].string == "precise")
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
    }.navigationTitle(
      "行程"
    ).navigationBarTitleDisplayMode(.large).toolbar {
      ToolbarItem(placement: .topBarLeading) {
        Button {
          store.selectedTrip = nil
        } label: {
          Image(systemName: "house")
        }.accessibilityLabel("我的旅程")
      }
      ToolbarItem(placement: .topBarTrailing) {
        if editMode == .active { Button("完成") { editMode = .inactive } }
        else { Menu { Button("调整顺序") { editMode = .active }; Button("与另一天交换") { swapping = true } } label: { Image(systemName: "ellipsis.circle") } }
      }
      ToolbarItem(placement: .topBarTrailing) {
        Button {
          adding = true
        } label: {
          Label("添加活动", systemImage: "plus")
        }.tint(palette.accent).disabled(dayID.isEmpty).accessibilityLabel("添加活动")
      }
    }.sheet(item: $routeSelection) { selection in
      RouteEditor(object: selection.object, from: selection.from, to: selection.to)
    }.environment(\.editMode, $editMode).onAppear { selectDay() }.onChange(of: store.days.map(\.id))
    { _, _ in selectDay() }.sheet(
      isPresented: $adding
    ) { ActivityEditor(dayID: dayID) }.sheet(item: $editing) {
      ActivityEditor(object: $0, dayID: $0["payload"]["dayId"].string)
    }.sheet(isPresented: $swapping) {
      NavigationStack {
        JourneyList { ForEach(store.days.filter { $0.id != dayID }) { day in Button(dayTitle(day, trip: store.trip)) {
          store.perform {
            let moves = store.objects.filter { $0["kind"].string == "activity" && $0["state"].string == "active" && [dayID, day.id].contains($0["payload"]["dayId"].string) }.map { activity in JSON.object(["activityId": .string(activity.id), "dayId": .string(activity["payload"]["dayId"].string == dayID ? day.id : dayID)]) }
            try await store.mutate(object: store.trip, kind: "reschedule", patch: .object(["startDate": store.trip["startDate"], "dayCount": store.trip["dayCount"], "moves": .array(moves)])); swapping = false
          }
        } } }.navigationTitle("与哪一天交换").toolbar { Button("取消") { swapping = false } }
      }
    }.onChange(of: focusedActivity) { _, activity in
      guard let activity else { return }
      dayID = activity["payload"]["dayId"].string
      highlighted = activity.id
      Task { @MainActor in try? await Task.sleep(for: .milliseconds(100)); scroll.scrollTo(activity.id, anchor: .center); try? await Task.sleep(for: .seconds(1)); highlighted = "" }
    }.onAppear {
      if let activity = focusedActivity { dayID = activity["payload"]["dayId"].string; highlighted = activity.id; Task { @MainActor in try? await Task.sleep(for: .milliseconds(100)); scroll.scrollTo(activity.id, anchor: .center); try? await Task.sleep(for: .seconds(1)); highlighted = "" } }
    }.refreshable {
      do { try await store.refresh() } catch { store.error = error.localizedDescription }
    }
  }
    }
  func routeFor(_ activity: JSON) -> JSON? {
    store.objects.first {
      $0["kind"].string == "route" && $0["state"].string == "active"
        && $0["payload"]["toId"].string == activity.id
    }
  }
  func openRoute(_ activity: JSON) {
    let route = routeFor(activity)
    let index = activities.firstIndex { $0.id == activity.id } ?? 0
    let previous =
      route == nil
      ? (index > 0 ? activities[index - 1] : nil)
      : store.objects.first { $0.id == route!["payload"]["fromId"].string }
    routeSelection = RouteSelection(object: route, from: previous, to: activity)
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
struct LifecycleMenu: View {
  @Environment(\.journeyPalette) private var palette
  @EnvironmentObject var store: JourneyStore
  let object: JSON
  var edit: (() -> Void)? = nil
  var route: (() -> Void)? = nil
  var body: some View {
    if let edit { Button("编辑", systemImage: "pencil", action: edit) }
    if let place = object["payload"]["place"].isNull ? nil : object["payload"]["place"],
      let url = URL(
        string: "http://maps.apple.com/?q=" + place["name"].string.addingPercentEncoding(
          withAllowedCharacters: .urlQueryAllowed)!)
    {
      Link(destination: url) { Label("在地图查看", systemImage: "map") }
    }
    if let route {
      Button("编辑路程", systemImage: "arrow.triangle.turn.up.right.diamond", action: route)
    }
    if object["kind"].string == "activity" { expression("notParticipating", "我不参加") }
    expression(
      object["state"].string == "deleted" ? "wishRestore" : "wishDelete",
      object["state"].string == "deleted" ? "希望恢复" : "希望删除")
    if store.canManage {
      Divider()
      if object["state"].string == "deleted" {
        Button("恢复", systemImage: "arrow.uturn.backward") {
          store.perform { try await store.mutate(object: object, kind: "restore") }
        }
      } else {
        Button("删除", systemImage: "trash", role: .destructive) { store.deleteWithUndo(object) }
      }
    }
  }
  func expression(_ key: String, _ title: String) -> some View {
    let active =
      object["expressions"].array.first { $0["userId"].string == store.user.id }?[key].bool ?? false
    return Button(active ? "取消\(title)" : title) {
      store.perform {
        try await store.mutate(
          object: object, kind: "express", expression: .object([key: .bool(!active)]))
      }
    }
  }
}
struct LifecycleActions: View {
  @Environment(\.journeyPalette) private var palette
  @EnvironmentObject var store: JourneyStore
  let object: JSON
  var edit: (() -> Void)? = nil
  var route: (() -> Void)? = nil
  var body: some View {
    HStack {
      let absent = object["expressions"].array.filter { $0["notParticipating"].bool }.count
      let wishes = object["expressions"].array.filter { $0["wishDelete"].bool }.count
      if absent > 0 { Text("\(absent) 人不参加").foregroundStyle(palette.muted) }
      if wishes > 0 { Text("\(wishes) 人希望删除").foregroundStyle(palette.muted) }
      Spacer()
      Menu {
        LifecycleMenu(object: object, edit: edit, route: route)
      } label: {
        Image(systemName: "ellipsis").frame(minWidth: 44, minHeight: 44)
      }.accessibilityLabel("更多操作").buttonStyle(.plain).foregroundStyle(palette.accent)
    }.font(.caption)
  }
}
struct ActivityEditor: View {
  @Environment(\.journeyPalette) private var palette
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
  @State private var createdID = UUID().uuidString
  @State private var linkError: String?
  @FocusState private var linkFocused: Bool
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
        .object([
          "form": form, "baseline": baseline, "objectId": .string(createdID),
          "dirty": .array(dirty.map(JSON.string)),
        ]))
    } catch { store.error = error.localizedDescription }
  }
  var body: some View {
    NavigationStack {
      JourneyForm {
        EditorSaveStatus(draftKey: draftKey)
        if !restore.isNull {
          Section {
            Text("有上次未完成的输入")
            Button("恢复输入") {
              dirty = Set(restore["dirty"].array.map(\.string))
              let current =
                store.objects.first { $0.id == (object?.id ?? createdID) }?["payload"] ?? form
              form = current
              for key in dirty { form[key] = restore["form"][key] }
              restore = .null
            }
            Button("使用当前内容") {
              if object == nil { createdID = UUID().uuidString }
              dirty.removeAll()
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
            Text(form["place"]["address"].string).font(.caption).foregroundStyle(palette.muted)
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
            .accessibilityIdentifier("activity.notes")
          VStack(alignment: .leading, spacing: 4) {
            TextField("相关链接", text: text("url")).keyboardType(.URL)
              .textInputAutocapitalization(.never).autocorrectionDisabled().focused($linkFocused)
              .onChange(of: form["url"].string) { _, _ in linkError = nil }
            if let linkError {
              Text(linkError).font(.caption).foregroundStyle(palette.danger)
            }
          }
        }
      }.navigationTitle(object == nil ? "添加活动" : "编辑活动").toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("收起") { save(close: true, reportErrors: false) }
        }
        ToolbarItem(placement: .confirmationAction) {
          Button("完成") { save(close: true) }.lineLimit(1).fixedSize().disabled(
            form["title"].string.trimmingCharacters(in: .whitespaces).isEmpty || store.busy
              || !restore.isNull
          ).accessibilityIdentifier("activity.save")
        }
      }.task(id: form) {
        guard initialized, !finished, restore.isNull, !dirty.isEmpty else { return }
        do { try await Task.sleep(for: .milliseconds(450)) } catch { return }
        await persist(reportErrors: false)
      }.onDisappear { save(close: false, reportErrors: false) }
        .onAppear { initialize() }.onChange(of: store.objects) { _, objects in
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
    if saved.isNull && object == nil && !initialPlace.isNull { changed("place") }
    if !saved.isNull {
      restore = saved
      if !saved["objectId"].string.isEmpty { createdID = saved["objectId"].string }
    }
  }
  func save(close: Bool, reportErrors: Bool = true) {
    Task {
      await persist(reportErrors: reportErrors)
      if close
        && (!reportErrors
          || form["title"].string.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
            && dirty.isEmpty)
      {
        finished = true
        dismiss()
      }
    }
  }
  func persist(reportErrors: Bool) async {
    if initialized, object == nil, initialPlace.isNull, form == baseline,
      !store.objects.contains(where: { $0.id == createdID }), restore.isNull
    {
      do {
        try store.removeDraft(draftKey)
        dirty.removeAll()
      } catch { store.error = error.localizedDescription }
      return
    }
    guard initialized, !finished, restore.isNull, !dirty.isEmpty,
      !form["title"].string.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    else { return }
    var payload = form
    do {
      payload["url"] = .string(try ActivityLink.normalize(form["url"].string))
    } catch {
      if reportErrors {
        linkError = error.localizedDescription
        linkFocused = true
      }
      return
    }
    do {
      if payload["time"]["mode"].string == "precise" {
        let pattern = #"^([01]\d|2[0-3]):[0-5]\d$"#
        guard payload["time"]["start"].string.range(of: pattern, options: .regularExpression) != nil
        else { throw APIError(message: "开始时间请填写 HH:mm") }
        if !payload["time"]["end"].string.isEmpty,
          payload["time"]["end"].string.range(of: pattern, options: .regularExpression) == nil
        {
          throw APIError(message: "结束时间请填写 HH:mm")
        }
      } else {
        payload["time"]["start"] = .null
        payload["time"]["end"] = .null
      }
      for key in ["start", "end"] where payload["time"][key].string.isEmpty {
        payload["time"][key] = .null
      }
      let target = store.objects.first { $0.id == (object?.id ?? createdID) } ?? object
      let patch =
        target == nil ? payload : .object(payload.dictionary.filter { dirty.contains($0.key) })
      try await store.mutate(
        object: target, kind: target == nil ? "create" : "patch",
        type: target == nil ? "activity" : nil,
        patch: patch, id: target == nil ? createdID : nil, expectedTrip: tripID,
        expectedAccount: account)
      dirty.removeAll()
      try store.removeDraft(draftKey)
    } catch {
      if reportErrors || !(error is APIError) || (error as? APIError)?.code == "LOCAL_STORAGE" {
        store.error = error.localizedDescription
      }
    }
  }
}
