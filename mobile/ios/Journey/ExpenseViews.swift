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
  @EnvironmentObject var store: JourneyStore
  @State private var adding = false
  @State private var editing: JSON?
  var expenses: [JSON] {
    store.objects.filter { $0["kind"].string == "expense" && $0["state"].string == "active" }
  }
  var totals: [String] {
    Array(Set(expenses.map { $0["payload"]["payment"]["currency"].string })).sorted()
  }
  var body: some View {
    List {
      Section("旅程开支") {
        ForEach(totals, id: \.self) { currency in
          VStack(alignment: .leading, spacing: 7) {
            Text(currency).font(.caption).foregroundStyle(.secondary)
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
            ).font(.subheadline).foregroundStyle(.secondary)
          }.padding(.vertical, 9)
        }
      }
      if expenses.isEmpty {
        ContentUnavailableView(
          "还没有费用", systemImage: "creditcard", description: Text("记下预算和已经支付的开支。"))
      }
      ForEach(["paid", "estimated"], id: \.self) { status in
        Section(status == "paid" ? "已支付" : "预计") {
          ForEach(expenses.filter { $0["payload"]["payment"]["status"].string == status }) { item in
            VStack(alignment: .leading, spacing: 9) {
              Button {
                editing = item
              } label: {
                HStack(alignment: .top) {
                  VStack(alignment: .leading, spacing: 6) {
                    Text(
                      item["payload"]["title"].string.isEmpty
                        ? "未命名费用" : item["payload"]["title"].string
                    ).foregroundStyle(.primary)
                    if !item["payload"]["notes"].string.isEmpty {
                      Text(item["payload"]["notes"].string).font(.caption).foregroundStyle(
                        .secondary)
                    }
                    if let activity = store.objects.first(where: {
                      $0.id == item["payload"]["activityId"].string
                    }) {
                      Text(activity["payload"]["title"].string).font(.caption).foregroundStyle(
                        .secondary)
                    }
                  }
                  Spacer()
                  Text(
                    Money.display(
                      item["payload"]["payment"]["amountMinor"],
                      currency: item["payload"]["payment"]["currency"].string)
                  ).foregroundStyle(Palette.accent)
                }
              }
              LifecycleActions(object: item)
            }.padding(.vertical, 7)
          }
        }
      }
    }.scrollContentBackground(.hidden).background(Palette.background).navigationTitle("旅程费用")
      .toolbar {
        Button {
          adding = true
        } label: {
          Label("添加费用", systemImage: "plus")
        }
      }.sheet(isPresented: $adding) { ExpenseEditor() }.sheet(item: $editing) {
        ExpenseEditor(object: $0)
      }
  }
}
struct ExpenseEditor: View {
  @EnvironmentObject var store: JourneyStore
  @Environment(\.dismiss) var dismiss
  var object: JSON? = nil
  @State private var form: JSON = .null
  @State private var amount = ""
  @State private var dirty = Set<String>()
  @State private var restore: JSON = .null
  @State private var initialized = false
  @State private var finished = false
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
        .object(["form": form, "amount": .string(amount), "dirty": .array(dirty.map(JSON.string))]))
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
              amount = restore["amount"].string
              dirty = Set(restore["dirty"].array.map(\.string))
              restore = .null
            }
            Button("使用当前内容") {
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
        ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) {
          Button("保存") {
            store.perform {
              if object == nil || dirty.contains("payment") {
                form["payment"]["amountMinor"] = try Money.parse(
                  amount, currency: form["payment"]["currency"].string,
                  paid: form["payment"]["status"].string == "paid")
              }
              let patch =
                object == nil ? form : .object(form.dictionary.filter { dirty.contains($0.key) })
              if object == nil || !patch.dictionary.isEmpty {
                try await store.mutate(
                  object: object, kind: object == nil ? "create" : "patch",
                  type: object == nil ? "expense" : nil, patch: patch, expectedTrip: tripID,
                  expectedAccount: account)
              }
              finished = true
              try store.removeDraft(key)
              dismiss()
            }
          }.disabled(store.busy || !restore.isNull)
        }
      }.onAppear { initialize() }.onChange(of: store.objects) { _, objects in
        guard let obj = objects.first(where: { $0.id == object?.id }) else { return }
        for (k, v) in obj["payload"].dictionary where !dirty.contains(k) {
          form[k] = v
          if k == "payment" { updateAmount() }
        }
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
  }
}
