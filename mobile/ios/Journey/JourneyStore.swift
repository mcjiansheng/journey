import Foundation
import Security
import SwiftUI

@MainActor final class JourneyStore: ObservableObject {
  @Published var user: JSON = .null
  @Published var cache = AccountCache()
  @Published var selectedTrip: String?
  @Published var error: String?
  @Published var status = "正在连接…"
  @Published var ready = false
  @Published var busy = false
  @Published var recoveryBusy = false
  @Published var loadedTrips = false
  @Published var sessionExpired = false
  @Published var baseURL: String
  private var csrf = ""
  private var lease: TimeLease?
  private var flushing = false
  private var epoch = UUID()
  private let deviceID: String
  private let session: URLSession
  private let storageDirectory: URL?
  private var pollTask: Task<Void, Never>?
  private var accountID = ""
  private var storageFailure: String?
  var snapshot: JSON {
    guard let id = selectedTrip, let snap = cache.snapshots[id] else { return .null }
    return SnapshotProjection.apply(
      cache.queue.filter { $0.tripID == id }, to: snap, userID: accountID)
  }
  var trips: [JSON] {
    cache.trips.map { listed in
      guard let snapshot = cache.snapshots[listed.id] else { return listed }
      var value = SnapshotProjection.apply(
        cache.queue.filter { $0.tripID == listed.id }, to: snapshot, userID: accountID)["trip"]
      value["archived"] = listed["archived"]
      return value
    }
  }
  var trip: JSON { snapshot["trip"] }
  var objects: [JSON] { snapshot["objects"].array }
  var allDays: [JSON] {
    objects.filter { $0["kind"].string == "day" && $0["state"].string == "active" }.sorted {
      ($0["payload"]["date"].string, $0["payload"]["ordinal"].number) < (
        $1["payload"]["date"].string, $1["payload"]["ordinal"].number
      )
    }
  }
  var days: [JSON] {
    let start = trip["startDate"].string
    let count = Int(trip["dayCount"].number)
    let end = JourneyDate.string(
      JourneyDate.calendar.date(byAdding: .day, value: count, to: JourneyDate.date(start))!)
    return allDays.filter { day in
      let p = day["payload"]
      return start.isEmpty
        ? p["date"].isNull && p["ordinal"].number >= 1 && p["ordinal"].number <= Double(count)
        : p["date"].string >= start && p["date"].string < end
    }
  }
  var canManage: Bool {
    trip["ownerId"].string == accountID
      || snapshot["members"].array.contains {
        $0["userId"].string == accountID && $0["isAdmin"].bool
      }
  }
  var isOwner: Bool { trip["ownerId"].string == accountID }
  var origin: String {
    let u = URLComponents(string: baseURL)!
    return "\(u.scheme!)://\(u.host!)" + (u.port.map { ":\($0)" } ?? "")
  }
  init(urlSession: URLSession? = nil, serverURL: String? = nil, storageDirectory: URL? = nil) {
    self.storageDirectory = storageDirectory
    baseURL = serverURL ?? ProcessInfo.processInfo.environment["JOURNEY_SERVER_URL"] ?? "https://journey.jscloud.wang"
    deviceID = UserDefaults.standard.string(forKey: "journey.device") ?? UUID().uuidString
    UserDefaults.standard.set(deviceID, forKey: "journey.device")
    let c = URLSessionConfiguration.default
    c.httpCookieStorage = HTTPCookieStorage.shared
    c.httpShouldSetCookies = true
    c.timeoutIntervalForRequest = 20
    c.requestCachePolicy = .reloadIgnoringLocalCacheData
    session = urlSession ?? URLSession(configuration: c)
  }
  func api(_ path: String, method: String = "GET", body: JSON? = nil) async throws -> JSON {
    let captured = epoch
    guard
      let url = URL(string: baseURL.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + path)
    else { throw APIError(message: "服务器地址无效") }
    var r = URLRequest(url: url)
    r.httpMethod = method
    r.setValue("application/json", forHTTPHeaderField: "Accept")
    if method != "GET" {
      r.setValue(origin, forHTTPHeaderField: "Origin")
      r.setValue(csrf, forHTTPHeaderField: "X-CSRF-Token")
      r.setValue("application/json", forHTTPHeaderField: "Content-Type")
    }
    if let body { r.httpBody = try JSONEncoder().encode(body) }
    let data: Data
    let response: URLResponse
    do { (data, response) = try await session.data(for: r) } catch {
      throw APIError(message: "无法连接服务器，修改已保存在本机", code: "NETWORK")
    }
    guard captured == epoch else { throw APIError(message: "账号已切换", code: "SESSION_CHANGED") }
    guard let response = response as? HTTPURLResponse else {
      throw APIError(message: "未能确认服务器回复", code: "RECEIPT_UNKNOWN")
    }
    let json = try? JSONDecoder().decode(JSON.self, from: data)
    guard (200..<300).contains(response.statusCode) else {
      if response.statusCode == 401 { sessionExpired = true }
      throw APIError(
        message: json?["error"]["message"].string ?? "请求失败（\(response.statusCode)）",
        code: json?["error"]["code"].string ?? "HTTP", status: response.statusCode)
    }
    guard let json else { throw APIError(message: "未能确认服务器回复，请重试", code: "RECEIPT_UNKNOWN") }
    saveCookies()
    return json
  }
  func start() async {
    restoreCookies()
    do { try await establish(try await api("/api/session")) } catch let e as APIError {
      if e.status == 401 {
        clearVisibleAccount()
        sessionExpired = true
        status = "请登录"
      } else if e.code == "NETWORK" || e.status >= 500 {
        if let data = UserDefaults.standard.data(forKey: "journey.lastAccount:" + baseURL),
          let oldUser = try? JSONDecoder().decode(JSON.self, from: data)
        {
          do {
            let candidate = try readCache(for: oldUser.id)
            epoch = UUID()
            accountID = oldUser.id
            user = oldUser
            cache = candidate
            csrf = ""
            lease = nil
            sessionExpired = false
            status = "离线 · 显示本机保存的旅程"
          } catch {
            clearVisibleAccount()
            self.error = error.localizedDescription
          }
        } else {
          self.error = e.localizedDescription
          status = "连接失败"
        }
      } else {
        self.error = e.localizedDescription
      }
    } catch { self.error = error.localizedDescription }
    ready = true
  }
  private func clearVisibleAccount() {
    epoch = UUID()
    accountID = ""
    user = .null
    csrf = ""
    lease = nil
    cache = AccountCache()
    selectedTrip = nil
  }
  private func establish(_ response: JSON) async throws {
    guard !response["user"].id.isEmpty, !response["csrfToken"].string.isEmpty else {
      throw APIError(message: "未能确认登录信息，请重新登录", code: "RECEIPT_UNKNOWN")
    }
    let candidateID = response["user"].id
    let candidate: AccountCache
    do { candidate = try readCache(for: candidateID) } catch {
      clearVisibleAccount()
      throw error
    }
    epoch = UUID()
    accountID = candidateID
    user = response["user"]
    csrf = response["csrfToken"].string
    cache = candidate
    sessionExpired = false
    UserDefaults.standard.set(
      try JSONEncoder().encode(user), forKey: "journey.lastAccount:" + baseURL)
    loadedTrips = false
    selectedTrip = nil
    lease = nil
    try await refreshTrips()
    try await renewLease()
    await flush()
    startPolling()
  }
  func login(identifier: String, password: String, name: String, register: Bool) async throws {
    var body: [String: JSON] = ["identifier": .string(identifier), "password": .string(password)]
    if register { body["displayName"] = .string(name) }
    try await establish(
      try await api(
        register ? "/api/auth/register" : "/api/auth/login", method: "POST", body: .object(body)))
  }
  func logout() async throws {
    _ = try await api("/api/auth/logout", method: "POST", body: .object([:]))
    epoch = UUID()
    stopPolling()
    user = .null
    csrf = ""
    lease = nil
    selectedTrip = nil
    accountID = ""
    cache = AccountCache()
    sessionExpired = false
    UserDefaults.standard.removeObject(forKey: "journey.lastAccount:" + baseURL)
    deleteCookies()
  }
  func refreshTrips() async throws {
    let r = try await api("/api/trips")
    cache.trips = r["trips"].array
    cache.contexts.merge(r["navigation"]["contexts"].dictionary) { _, remote in remote }
    loadedTrips = true
    status = cache.queue.isEmpty ? "已同步" : "有修改等待同步"
    try persist()
  }
  func open(_ id: String) async throws {
    selectedTrip = id
    if cache.snapshots[id] != nil { status = "正在更新…" }
    let r = try await api("/api/trips/\(id)")
    accept(r)
    try persist()
    status = cache.queue.isEmpty ? "已同步" : "有修改等待同步"
    _ = try? await api("/api/navigation", method: "PUT", body: .object(["lastTripId": .string(id)]))
  }
  func refresh() async throws {
    guard let id = selectedTrip else {
      try await refreshTrips()
      return
    }
    let r = try await api("/api/trips/\(id)")
    accept(r)
    try persist()
    status = cache.queue.isEmpty ? "已同步" : "有修改等待同步"
  }
  func create(_ body: JSON) async throws {
    let r = try await api("/api/trips", method: "POST", body: body)
    accept(r)
    selectedTrip = r["trip"].id
    try await refreshTrips()
    try persist()
  }
  func join(_ code: String) async throws {
    let r = try await api(
      "/api/invites/accept", method: "POST", body: .object(["code": .string(code)]))
    accept(r)
    selectedTrip = r["trip"].id
    try await refreshTrips()
  }
  func accept(_ snapshot: JSON) {
    let id = snapshot["trip"].id
    guard !id.isEmpty, !snapshot["objects"].isNull, !snapshot["members"].isNull else { return }
    if let previous = cache.snapshots[id],
      previous["epoch"].number > snapshot["epoch"].number
        || (previous["epoch"] == snapshot["epoch"]
          && previous["cursor"].number > snapshot["cursor"].number)
    {
      return
    }
    cache.snapshots[id] = snapshot
    if let index = cache.trips.firstIndex(where: { $0.id == id }) {
      var trip = cache.trips[index]
      for (key, value) in snapshot["trip"].dictionary { trip[key] = value }
      cache.trips[index] = trip
    } else {
      cache.trips.append(snapshot["trip"])
    }
  }
  func renewLease() async throws {
    let start = ProcessInfo.processInfo.systemUptime
    let r = try await api(
      "/api/clock", method: "POST", body: .object(["deviceId": .string(deviceID)]))
    let end = ProcessInfo.processInfo.systemUptime
    let mid = (start + end) / 2
    lease = TimeLease(
      lease: r, midpoint: mid, wall: Date().timeIntervalSince1970 * 1000 - (end - mid) * 1000,
      uncertainty: ceil((end - start) * 500) + 2)
  }
  func mutate(
    object: JSON? = nil, kind: String, type: String? = nil, patch: JSON? = nil,
    expression: JSON? = nil, id: String? = nil, expectedTrip: String? = nil,
    expectedAccount: String? = nil
  ) async throws {
    guard let tripID = selectedTrip, !accountID.isEmpty,
      expectedTrip == nil || expectedTrip == tripID,
      expectedAccount == nil || expectedAccount == accountID
    else { throw APIError(message: "当前旅程或账号已切换，请重新打开编辑器") }
    var body: [String: JSON] = [
      "id": .string(UUID().uuidString), "objectId": .string(id ?? object?.id ?? UUID().uuidString),
      "kind": .string(kind),
      "clock": lease?.clock()
        ?? .object([
          "leaseId": .null, "elapsedMs": .integer(0), "uncertaintyMs": .integer(0),
          "uncertain": .bool(true),
        ]),
    ]
    if let type { body["objectType"] = .string(type) }
    if let patch { body["patch"] = patch }
    if let expression { body["expression"] = expression }
    if let object, kind != "create" { body["generation"] = object["generation"] }
    let previous = cache
    cache.queue.append(QueuedOperation(tripID: tripID, body: .object(body)))
    do { try persist() } catch {
      cache = previous
      throw error
    }
    status = "等待上传（\(cache.queue.count)）"
    Task { await self.flush() }
  }
  /// Each trip keeps its original sequence. A blocked trip does not prevent another trip uploading.
  func flush() async {
    guard !flushing, !recoveryBusy, !accountID.isEmpty, !csrf.isEmpty, !sessionExpired else {
      return
    }
    flushing = true
    let captured = epoch
    defer { flushing = false }
    var paused = Set<String>()
    while captured == epoch,
      let index = cache.queue.firstIndex(where: { !paused.contains($0.tripID) })
    {
      let op = cache.queue[index]
      if op.blocked != nil {
        paused.insert(op.tripID)
        continue
      }
      if op.body["clock"]["uncertain"].bool && !op.receiptUnknown {
        cache.queue[index].blocked = "CLOCK_UNCERTAIN"
        do { try persist() } catch {
          self.error = error.localizedDescription
          break
        }
        paused.insert(op.tripID)
        continue
      }
      do {
        let r = try await api("/api/trips/\(op.tripID)/operations", method: "POST", body: op.body)
        guard captured == epoch else { return }
        guard r["receipt"]["operationId"].string == op.id, r["snapshot"]["trip"].id == op.tripID,
          !r["snapshot"]["objects"].isNull
        else { throw APIError(message: "服务器回复未能确认，保留修改等待重试", code: "RECEIPT_UNKNOWN") }
        let previous = cache
        accept(r["snapshot"])
        cache.queue.removeAll { $0.id == op.id }
        do { try persist() } catch {
          cache = previous
          throw error
        }
        status = cache.queue.isEmpty ? "已同步" : "正在上传…"
      } catch {
        guard captured == epoch else { return }
        guard let i = cache.queue.firstIndex(where: { $0.id == op.id }) else { return }
        if let e = error as? APIError {
          if e.code == "NETWORK" || e.code == "RECEIPT_UNKNOWN" || e.status >= 500 {
            cache.queue[i].receiptUnknown = true
            status = "等待确认修改"
            try? persist()
            break
          }
          cache.queue[i].receiptUnknown = false
          cache.queue[i].blocked = e.code
          self.error = e.localizedDescription
        } else {
          self.error = error.localizedDescription
          break
        }
        try? persist()
        paused.insert(op.tripID)
      }
    }
  }
  func retryPending() async {
    guard !flushing, !recoveryBusy else { return }
    for i in cache.queue.indices where cache.queue[i].blocked != "CLOCK_UNCERTAIN" {
      cache.queue[i].blocked = nil
    }
    do {
      try persist()
      if csrf.isEmpty { try await restoreConnection() }
      if lease == nil { try await renewLease() }
      await flush()
      try await refresh()
    } catch { self.error = error.localizedDescription }
  }
  func reapply(_ tripID: String) async throws {
    guard !flushing, !recoveryBusy else { throw APIError(message: "正在确认修改，请稍后再试") }
    recoveryBusy = true
    defer { recoveryBusy = false }
    let captured = epoch
    let ops = cache.queue.filter { $0.tripID == tripID }
    guard let first = ops.first, first.blocked == "CLOCK_UNCERTAIN",
      !ops.contains(where: { $0.receiptUnknown })
    else { throw APIError(message: "请先重试，确认服务器是否已经保存") }
    if csrf.isEmpty { try await restoreConnection() }
    try await renewLease()
    guard captured == epoch, !flushing,
      cache.queue.filter({ $0.tripID == tripID }).map(\.id) == ops.map(\.id)
    else { throw APIError(message: "待处理的修改发生变化，请重新查看后确认") }
    let old = cache
    let prefix = UUID().uuidString
    let clock = lease!.clock()
    var n = 0
    for i in cache.queue.indices where cache.queue[i].tripID == tripID {
      cache.queue[i].body["id"] = .string(prefix + "-" + String(format: "%08d", n))
      n += 1
      cache.queue[i].body["clock"] = clock
      cache.queue[i].blocked = nil
    }
    do { try persist() } catch {
      cache = old
      throw error
    }
    recoveryBusy = false
    await flush()
  }
  func discard(_ tripID: String) throws {
    let ops = cache.queue.filter { $0.tripID == tripID }
    guard !flushing, !ops.contains(where: { $0.receiptUnknown }) else {
      throw APIError(message: "请先重试，确认服务器是否已经保存")
    }
    let old = cache
    // Keep complete operation bodies as recoverable drafts when the user explicitly discards a suffix.
    for op in ops { cache.drafts["recovery:\(tripID):\(op.id)"] = op.body }
    cache.queue.removeAll { $0.tripID == tripID }
    do { try persist() } catch {
      cache = old
      throw error
    }
  }
  func draft(_ key: String) -> JSON { cache.drafts[key] ?? .null }
  func setDraft(_ key: String, _ value: JSON) throws {
    let old = cache.drafts
    cache.drafts[key] = value
    do { try persist() } catch {
      cache.drafts = old
      throw error
    }
  }
  func removeDraft(_ key: String) throws {
    cache.drafts.removeValue(forKey: key)
    try persist()
  }
  func updateProfile(_ body: JSON) async throws {
    let r = try await api("/api/me", method: "PATCH", body: body)
    user = r["user"].isNull ? r : r["user"]
  }
  func change(_ path: String, method: String = "POST", body: JSON? = nil) async throws {
    _ = try await api(path, method: method, body: body)
    try await refresh()
    try await refreshTrips()
  }
  func perform(_ action: @escaping () async throws -> Void) {
    Task {
      busy = true
      defer { busy = false }
      do { try await action() } catch { self.error = error.localizedDescription }
    }
  }
  private func restoreConnection() async throws {
    let response = try await api("/api/session")
    guard response["user"].id == accountID else {
      try await establish(response)
      throw APIError(message: "已切换到当前登录账号，请重新打开旅程")
    }
    user = response["user"]
    csrf = response["csrfToken"].string
  }
  func startPolling() {
    guard pollTask == nil else { return }
    pollTask = Task { [weak self] in
      while !Task.isCancelled {
        try? await Task.sleep(for: .seconds(8))
        guard !Task.isCancelled, let self, !self.user.isNull else { continue }
        do {
          if self.csrf.isEmpty { try await self.restoreConnection() }
          if self.lease == nil || self.lease!.clock()["uncertain"].bool {
            try await self.renewLease()
          }
          await self.flush()
          try await self.refresh()
        } catch { self.status = "暂时离线" }
      }
    }
  }
  func stopPolling() {
    pollTask?.cancel()
    pollTask = nil
  }
  private var cacheURL: URL { cacheURL(for: accountID) }
  private func cacheURL(for owner: String) -> URL {
    let originKey = Data(baseURL.utf8).base64EncodedString().replacingOccurrences(
      of: "/", with: "_")
    return (storageDirectory ?? URL.applicationSupportDirectory).appending(
      path: "Journey/\(originKey)/\(owner).json")
  }
  private func readCache(for owner: String) throws -> AccountCache {
    storageFailure = nil
    let cacheURL = cacheURL(for: owner)
    guard FileManager.default.fileExists(atPath: cacheURL.path) else { return AccountCache() }
    do {
      return try JSONDecoder().decode(AccountCache.self, from: Data(contentsOf: cacheURL))
    } catch {
      storageFailure = error.localizedDescription
      throw APIError(message: "本机保存的修改读取失败：\(error.localizedDescription)", code: "LOCAL_STORAGE")
    }
  }
  private func persist() throws {
    if let failure = storageFailure {
      throw APIError(message: "本机保存的修改无法读取：" + failure, code: "LOCAL_STORAGE")
    }
    guard !accountID.isEmpty else { return }
    do {
      try FileManager.default.createDirectory(
        at: cacheURL.deletingLastPathComponent(), withIntermediateDirectories: true)
      try JSONEncoder().encode(cache).write(
        to: cacheURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    } catch {
      throw APIError(message: "本机保存失败：\(error.localizedDescription)", code: "LOCAL_STORAGE")
    }
  }
  private var cookieQuery: [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "Journey.Session",
      kSecAttrAccount as String: baseURL,
    ]
  }
  private func saveCookies() {
    guard let url = URL(string: baseURL) else { return }
    let cookies = (HTTPCookieStorage.shared.cookies(for: url) ?? []).compactMap {
      $0.properties?.reduce(into: [String: String]()) {
        $0[$1.key.rawValue] = String(describing: $1.value)
      }
    }
    guard let data = try? JSONEncoder().encode(cookies) else { return }
    SecItemDelete(cookieQuery as CFDictionary)
    var q = cookieQuery
    q[kSecValueData as String] = data
    q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    SecItemAdd(q as CFDictionary, nil)
  }
  private func restoreCookies() {
    var q = cookieQuery
    q[kSecReturnData as String] = true
    var result: CFTypeRef?
    guard SecItemCopyMatching(q as CFDictionary, &result) == errSecSuccess,
      let data = result as? Data,
      let cookies = try? JSONDecoder().decode([[String: String]].self, from: data)
    else { return }
    for c in cookies {
      if let cookie = HTTPCookie(
        properties: Dictionary(
          uniqueKeysWithValues: c.map { (HTTPCookiePropertyKey($0.key), $0.value as Any) }))
      {
        HTTPCookieStorage.shared.setCookie(cookie)
      }
    }
  }
  private func deleteCookies() {
    if let url = URL(string: baseURL) {
      for c in HTTPCookieStorage.shared.cookies(for: url) ?? [] {
        HTTPCookieStorage.shared.deleteCookie(c)
      }
    }
    SecItemDelete(cookieQuery as CFDictionary)
  }
}
