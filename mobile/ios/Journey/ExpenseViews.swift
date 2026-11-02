import SwiftUI

enum Money {
  static func digits(_ currency: String) -> Int {
    let f = NumberFormatter()
    f.numberStyle = .currency
    f.currencyCode = currency
    return f.maximumFractionDigits
  }
  static func factor(_ currency: String) -> Double { pow(10, Double(digits(currency))) }
  static func display(_ minor: JSON, currency: String) -> String {
    guard !minor.isNull else { return "金额未定" }
    return (minor.number / factor(currency)).formatted(.currency(code: currency))
  }
  static func parse(_ text: String, currency: String, paid: Bool) throws -> JSON {
    guard !text.trimmingCharacters(in: .whitespaces).isEmpty else {
      if paid { throw APIError(message: "请填写已支付金额") }
      return .null
    }
    let normalized = text.replacingOccurrences(of: ",", with: ".")
    guard let amount = Decimal(string: normalized, locale: Locale(identifier: "en_US_POSIX")),
      amount >= 0, normalized.range(of: #"^\d+(\.\d+)?$"#, options: .regularExpression) != nil
    else { throw APIError(message: "请填写有效的非负金额") }
    let scale = digits(currency)
    var minor = amount * Decimal(Int(factor(currency)))
    var rounded = Decimal()
    NSDecimalRound(&rounded, &minor, 0, .plain)
    guard minor == rounded, minor <= Decimal(9_007_199_254_740_991 as Int64) else {
      throw APIError(message: "\(currency) 最多支持 \(scale) 位小数，请检查金额")
    }
    return .number(NSDecimalNumber(decimal: minor).doubleValue)
  }
}
struct ExpensesView: View {
  @Environment(\.journeyPalette) private var palette
  @EnvironmentObject var store: JourneyStore
  @State private var adding = false
  @State private var editing: JSON?
  @State private var selectedDate = ""
  var expenses: [JSON] {
    store.objects.filter { $0["kind"].string == "expense" && $0["state"].string == "active" }
  }
  var totals: [String] {
    Array(Set(expenses.map { $0["payload"]["payment"]["currency"].string })).sorted()
  }
  func date(_ expense: JSON) -> String {
    if !expense["payload"]["date"].string.isEmpty { return expense["payload"]["date"].string }
    guard
      let activity = store.objects.first(where: { $0.id == expense["payload"]["activityId"].string }
      ),
      let day = store.days.first(where: { $0.id == activity["payload"]["dayId"].string })
    else { return "" }
    return day["payload"]["date"].string
  }
  var dateGroups: [String] {
    let dates = Set(expenses.map(date)).filter { selectedDate.isEmpty || $0 == selectedDate }
    return dates.sorted { $0.isEmpty ? false : $1.isEmpty ? true : $0 < $1 }
  }
  var body: some View {
    JourneyList {
      Section(store.trip["name"].string) {
        ForEach(totals, id: \.self) { currency in
          VStack(alignment: .leading, spacing: 7) {
            if totals.count > 1 { Text(currency).font(.caption).foregroundStyle(palette.muted) }
            Text(
              Money.display(
                .number(
                  expenses.filter {
                    $0["payload"]["payment"]["currency"].string == currency
                      && $0["payload"]["payment"]["status"].string == "paid"
                  }.reduce(0) { $0 + $1["payload"]["payment"]["amountMinor"].number }),
                currency: currency)
            ).font(.title2.bold())
            Text(
              "预计 "
                + Money.display(
                  .number(
                    expenses.filter {
                      $0["payload"]["payment"]["currency"].string == currency
                        && $0["payload"]["payment"]["status"].string == "estimated"
                    }.reduce(0) { $0 + $1["payload"]["payment"]["amountMinor"].number }),
                  currency: currency)
            ).font(.subheadline).foregroundStyle(palette.muted)
          }.padding(.vertical, 9)
        }
      }
      if expenses.isEmpty {
        ContentUnavailableView(
          "还没有费用", systemImage: "creditcard", description: Text("记下预算和已经支付的开支。"))
      }
      Section {
        ScrollView(.horizontal, showsIndicators: false) {
          HStack {
            dateButton("全部", date: "")
            ForEach(store.days.filter { !$0["payload"]["date"].string.isEmpty }) { day in
              dateButton(dayTitle(day, trip: store.trip), date: day["payload"]["date"].string)
            }
          }
        }
      }
      ForEach(dateGroups, id: \.self) { dateKey in
        Section(dateKey.isEmpty ? "日期未记录" : dateKey) {
          ForEach(expenses.filter { date($0) == dateKey }) { item in
            VStack(alignment: .leading, spacing: 9) {
              Button {
                editing = item
              } label: {
                HStack(alignment: .top) {
                  VStack(alignment: .leading, spacing: 6) {
                    Text(
                      item["payload"]["title"].string.isEmpty
                        ? "未命名费用" : item["payload"]["title"].string
                    ).foregroundStyle(palette.text)
                    if item["payload"]["payment"]["status"].string == "estimated" {
                      Text("预计").font(.caption).foregroundStyle(palette.muted)
                    }
                    if !item["payload"]["notes"].string.isEmpty {
                      Text(item["payload"]["notes"].string).font(.caption).foregroundStyle(
                        palette.muted
                      ).lineLimit(1)
                    }
                    if let activity = store.objects.first(where: {
                      $0.id == item["payload"]["activityId"].string
                    }) {
                      Text(activity["payload"]["title"].string).font(.caption).foregroundStyle(
                        palette.muted)
                    }
                  }
                  Spacer()
                  Text(
                    Money.display(
                      item["payload"]["payment"]["amountMinor"],
                      currency: item["payload"]["payment"]["currency"].string)
                  ).monospacedDigit().foregroundStyle(palette.accent)
                }
              }.buttonStyle(.plain)
              LifecycleActions(object: item, edit: { editing = item })
            }.padding(.vertical, 7).contextMenu {
              LifecycleMenu(object: item, edit: { editing = item })
            }
            .swipeActions {
              if store.canManage { Button("删除", role: .destructive) { store.deleteWithUndo(item) } }
            }
          }
        }
      }
    }.navigationTitle("费用").navigationBarTitleDisplayMode(.large)
      .toolbar {
        ToolbarItem(placement: .topBarTrailing) {
          Button {
            adding = true
          } label: {
            Label("添加费用", systemImage: "plus")
          }.tint(palette.accent)
        }
      }.sheet(isPresented: $adding) { ExpenseEditor() }.sheet(item: $editing) {
        ExpenseEditor(object: $0)
      }
  }
  func dateButton(_ title: String, date: String) -> some View {
    Button(title) { selectedDate = date }.font(.subheadline).padding(.horizontal, 12).padding(
      .vertical, 8
    )
    .background(selectedDate == date ? palette.accent.opacity(0.16) : .clear, in: Capsule())
    .fontWeight(selectedDate == date ? .semibold : .regular).buttonStyle(.plain)
    .foregroundStyle(selectedDate == date ? palette.accent : palette.muted)
  }

}
struct ExpenseEditor: View {
  @Environment(\.journeyPalette) private var palette
  @EnvironmentObject var store: JourneyStore
  @Environment(\.dismiss) var dismiss
  var object: JSON? = nil
  @State private var form: JSON = .null
  @State private var amount = ""
  @State private var dirty = Set<String>()
  @State private var restore: JSON = .null
  @State private var initialized = false
  @State private var finished = false
  @State private var createdID = UUID().uuidString
  @State private var key = ""
  @State private var account = ""
  @State private var tripID = ""
  func field(_ name: String) -> Binding<String> {
    Binding(
      get: { form[name].string },
      set: {
        form[name] = .string($0)
        changed(name)
      })
  }
  func payment(_ name: String) -> Binding<String> {
    Binding(
      get: { form["payment"][name].string },
      set: {
        form["payment"][name] = .string($0)
        changed("payment")
      })
  }
  func changed(_ group: String) {
    guard initialized, !finished else { return }
    dirty.insert(group)
    do {
      try store.setDraft(
        key,
        .object([
          "form": form, "amount": .string(amount), "objectId": .string(createdID),
          "dirty": .array(dirty.map(JSON.string)),
        ]))
    } catch { store.error = error.localizedDescription }
  }
  var body: some View {
    NavigationStack {
      JourneyForm {
        EditorSaveStatus(draftKey: key)
        if !restore.isNull {
          Section {
            Text("有上次未完成的输入")
            Button("恢复输入") {
              dirty = Set(restore["dirty"].array.map(\.string))
              form = store.objects.first { $0.id == (object?.id ?? createdID) }?["payload"] ?? form
              for group in dirty { form[group] = restore["form"][group] }
              if dirty.contains("payment") {
                amount = restore["amount"].string
              } else {
                updateAmount()
              }
              restore = .null
            }
            Button("使用当前内容") {
              if object == nil { createdID = UUID().uuidString }
              dirty.removeAll()
              restore = .null
              try? store.removeDraft(key)
            }
          }
        }
        TextField("费用名称（可不填）", text: field("title"))
        Section("金额") {
          Picker("状态", selection: payment("status")) {
            Text("已支付").tag("paid")
            Text("预计").tag("estimated")
          }
          TextField(
            "金额",
            text: Binding(
              get: { amount },
              set: {
                amount = $0
                changed("payment")
              })
          ).keyboardType(.decimalPad)
          Picker("币种", selection: payment("currency")) {
            ForEach(currencies, id: \.self) { Text($0).tag($0) }
          }
        }
        Section {
          Picker(
            "关联活动",
            selection: Binding(
              get: { form["activityId"].string },
              set: {
                form["activityId"] = $0.isEmpty ? .null : .string($0)
                changed("activityId")
              })
          ) {
            Text("不关联").tag("")
            ForEach(store.objects.filter { $0["kind"].string == "activity" }) {
              Text($0["payload"]["title"].string).tag($0.id)
            }
          }
          TextField("备注", text: field("notes"), axis: .vertical).lineLimit(3...8)
        }
      }.navigationTitle(object == nil ? "添加费用" : "编辑费用").toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("收起") { save(close: true, reportErrors: false) }
        }
        ToolbarItem(placement: .confirmationAction) {
          Button("完成") { save(close: true) }.lineLimit(1).fixedSize().disabled(
            !restore.isNull || (!hasInput && !hasExistingObject))
        }
      }.task(id: JSON.array([form, .string(amount)])) {
        guard initialized, !finished, restore.isNull, !dirty.isEmpty else { return }
        do { try await Task.sleep(for: .milliseconds(450)) } catch { return }
        await persist(reportErrors: false)
      }.onDisappear { save(close: false, reportErrors: false) }
        .onAppear { initialize() }.onChange(of: store.objects) { _, objects in
          guard let obj = objects.first(where: { $0.id == object?.id }) else { return }
          for (k, v) in obj["payload"].dictionary where !dirty.contains(k) {
            form[k] = v
            if k == "payment" { updateAmount() }
          }
        }
    }
  }
  var hasExistingObject: Bool { object != nil || store.objects.contains { $0.id == createdID } }
  var hasInput: Bool {
    !form["title"].string.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !amount.isEmpty
      || !form["notes"].string.isEmpty || !form["activityId"].string.isEmpty
  }
  func save(close: Bool, reportErrors: Bool = true) {
    Task {
      await persist(reportErrors: reportErrors)
      if close && (!reportErrors || dirty.isEmpty) {
        finished = true
        dismiss()
      }
    }
  }
  func persist(reportErrors: Bool) async {
    if initialized, object == nil, !hasInput,
      !store.objects.contains(where: { $0.id == createdID }), restore.isNull
    {
      do {
        try store.removeDraft(key)
        dirty.removeAll()
      } catch { store.error = error.localizedDescription }
      return
    }
    guard initialized, !finished, restore.isNull, !dirty.isEmpty, hasInput || hasExistingObject
    else { return }
    do {
      var payload = form
      if object == nil || dirty.contains("payment") {
        payload["payment"]["amountMinor"] = try Money.parse(
          amount, currency: payload["payment"]["currency"].string,
          paid: payload["payment"]["status"].string == "paid")
      }
      let target = store.objects.first { $0.id == (object?.id ?? createdID) } ?? object
      let patch =
        target == nil ? payload : .object(payload.dictionary.filter { dirty.contains($0.key) })
      try await store.mutate(
        object: target, kind: target == nil ? "create" : "patch",
        type: target == nil ? "expense" : nil,
        patch: patch, id: target == nil ? createdID : nil, expectedTrip: tripID,
        expectedAccount: account)
      dirty.removeAll()
      try store.removeDraft(key)
    } catch {
      if reportErrors || !(error is APIError) || (error as? APIError)?.code == "LOCAL_STORAGE" {
        store.error = error.localizedDescription
      }
    }
  }
  func updateAmount() {
    amount =
      form["payment"]["amountMinor"].isNull
      ? ""
      : NSDecimalNumber(
        value: form["payment"]["amountMinor"].number
          / Money.factor(form["payment"]["currency"].string)
      ).stringValue
  }
  func initialize() {
    guard !initialized else { return }
    initialized = true
    account = store.user.id
    tripID = store.selectedTrip ?? ""
    key = "\(tripID):expense:\(object?.id ?? "new")"
    form =
      object?["payload"]
      ?? .object([
        "title": .string(""), "date": .null,
        "payment": .object([
          "status": .string("paid"), "amountMinor": .null, "currency": store.trip["currency"],
        ]), "notes": .string(""), "activityId": .null,
      ])
    updateAmount()
    restore = store.draft(key)
    if !restore["objectId"].string.isEmpty { createdID = restore["objectId"].string }
  }
}
