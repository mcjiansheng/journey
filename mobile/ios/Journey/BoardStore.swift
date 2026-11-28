import Combine
import Foundation
import UIKit

/// The open board's items: `useBoard` in app/src/board-sync.js without presence (B8).
///
/// The main snapshot lists the trip's `board` objects but never their items. Items come
/// from `GET /api/trips/:id/boards/:boardId/items?since=<cursor>`, are cached per account,
/// trip and board, and are refreshed when a board opens, when the app returns to the
/// foreground and after this device's own board operations are accepted. `refresh()` is
/// also the entry for the trip's `change` events (SSE). Writes go through the trip's
/// operation queue, so they wait offline and upload in order with the other changes.
@MainActor final class BoardStore: ObservableObject {
  @Published private(set) var tripID = ""
  @Published private(set) var boardID = ""
  @Published private(set) var items: [JSON] = []
  @Published private(set) var cursor: Double = 0
  @Published private(set) var epoch: Double?
  @Published private(set) var loading = false

  /// Local changes the server has not echoed back yet (`pendingRef` in useBoard).
  private(set) var pending = BoardPending.Changes()
  /// Weak: a refresh still running when its JourneyStore goes away just stops.
  private weak var journey: JourneyStore?
  private var account = ""
  /// Changes whenever another board (or account) opens, so late answers are dropped.
  private var token = UUID()
  private var running: (token: UUID, task: Task<Void, Never>)?
  private var fetchAgain = false
  private var observers: [AnyCancellable] = []
  var now: () -> Double = { Date().timeIntervalSince1970 * 1000 }

  init(journey: JourneyStore) {
    self.journey = journey
    NotificationCenter.default.publisher(for: UIApplication.willEnterForegroundNotification)
      .sink { [weak self] _ in Task { await self?.refresh() } }.store(in: &observers)
    // A board belongs to one account and one trip: forget it when either changes.
    journey.$selectedTrip.sink { [weak self] trip in
      guard let self, !self.tripID.isEmpty, trip != self.tripID else { return }
      self.close()
    }.store(in: &observers)
    journey.$user.sink { [weak self] user in
      guard let self, !self.tripID.isEmpty, user.id != self.account else { return }
      self.close()
    }.store(in: &observers)
  }

  var activeItems: [JSON] { BoardItems.active(items) }
  var deletedItems: [JSON] { BoardItems.deleted(items) }

  /// Show `boardID` of the selected trip: the cached copy at once, then the server's.
  func open(_ boardID: String) async {
    guard let journey, let trip = journey.selectedTrip, !journey.user.id.isEmpty, !boardID.isEmpty
    else { return }
    if trip != tripID || boardID != self.boardID || journey.user.id != account {
      close()
      tripID = trip
      self.boardID = boardID
      account = journey.user.id
      loading = true
    }
    await load()
  }

  func close() {
    token = UUID()
    fetchAgain = false
    tripID = ""
    boardID = ""
    account = ""
    items = []
    cursor = 0
    epoch = nil
    loading = false
    pending.removeAll()
  }

  /// useBoard's `loadData`: the cached copy first, then what changed since its cursor.
  private func load() async {
    await serialized { await self.loadOnce() }
  }

  /// The trip changed on the server (a `change` event, the app returning to the
  /// foreground, or this device's own board operation): read what changed since the
  /// cursor on screen.
  func refresh() async {
    guard !tripID.isEmpty, !boardID.isEmpty else { return }
    await serialized { await self.refreshOnce() }
  }

  /// One read per board at a time. A refresh asked for meanwhile runs once more
  /// afterwards and its caller waits for it, so when a call returns the board is at least
  /// as new as the server was when it was called. Reads of a board that has since been
  /// closed finish on their own and are dropped.
  private func serialized(_ body: @escaping () async -> Void) async {
    let token = token
    if let running, running.token == token {
      fetchAgain = true
      await running.task.value
      return
    }
    let task = Task { @MainActor in
      await body()
      while self.fetchAgain && token == self.token {
        self.fetchAgain = false
        await self.refreshOnce()
      }
      if self.running?.token == token { self.running = nil }
    }
    running = (token, task)
    await task.value
  }

  /// A cached cursor may sit on a previous server epoch (restart, deploy, backup
  /// restore); the incremental answer is then not a complete board, so the board is read
  /// again without `since` and the cache replaced.
  private func loadOnce() async {
    let token = token
    defer { if token == self.token { loading = false } }
    let cached = readCache()
    if let cached {
      items = cached["items"].array.map(BoardItems.normalize)
      cursor = JSRules.truthy(cached["cursor"]) ? cached["cursor"].number : 0
      epoch = JSRules.truthy(cached["epoch"]) ? cached["epoch"].number : nil
    }
    let since = JSRules.truthy(cached?["cursor"]) ? cached!["cursor"].number : 0
    do {
      guard let journey else { return }
      var response = try await journey.api(itemsPath(since: since))
      guard token == self.token else { return }
      var replace = cached == nil || since == 0
      if let cached,
        JSRules.number(response.dictionary["epoch"]) != JSRules.number(cached.dictionary["epoch"])
      {
        response = try await journey.api(itemsPath(since: 0))
        guard token == self.token else { return }
        replace = true
      }
      let fromServer =
        replace
        ? response["items"].array.map(BoardItems.normalize)
        : Self.merging(cached!["items"].array, response["items"].array)
      accept(response, items: fromServer)
    } catch {
      // Offline: the cached items stay on screen.
    }
  }

  private func refreshOnce() async {
    let token = token
    guard !tripID.isEmpty else { return }
    let since = cursor
    do {
      guard let journey else { return }
      var response = try await journey.api(itemsPath(since: since))
      guard token == self.token else { return }
      // Every request is answered on its own; one that arrives after a newer one must
      // not put older copies back.
      if BoardPending.isStaleResponse(response, cursor: cursor, epoch: epoch) { return }
      let answered = JSRules.number(response.dictionary["epoch"])
      let merged: [JSON]
      if since != 0, let epoch, answered == epoch {
        merged = Self.merging(items, response["items"].array)
      } else if since != 0 && answered != (epoch ?? 0) {
        // A new epoch: the incremental answer only holds changed items, never replace
        // the whole board with it; read the complete board instead.
        response = try await journey.api(itemsPath(since: 0))
        guard token == self.token else { return }
        merged = response["items"].array.map(BoardItems.normalize)
      } else {
        merged = response["items"].array.map(BoardItems.normalize)
      }
      accept(response, items: merged)
    } catch {
      // A transient failure; the next refresh catches up.
    }
  }

  private func accept(_ response: JSON, items fromServer: [JSON]) {
    items = BoardPending.reconcile(fromServer, local: items, pending: &pending, now: now())
    cursor = JSRules.truthy(response["cursor"]) ? response["cursor"].number : 0
    epoch = JSRules.truthy(response["epoch"]) ? response["epoch"].number : 0
    writeCache()
  }

  /// The items on screen with the answer's items put in place (new ones appended).
  static func merging(_ base: [JSON], _ updates: [JSON]) -> [JSON] {
    var order: [String] = []
    var byID: [String: JSON] = [:]
    for item in base + updates {
      let normalized = BoardItems.normalize(item)
      let id = normalized["id"].string
      if byID[id] == nil { order.append(id) }
      byID[id] = normalized
    }
    return order.map { byID[$0]! }
  }

  private func itemsPath(since: Double) -> String {
    let path = "/api/trips/\(tripID)/boards/\(boardID)/items"
    return since != 0 ? path + "?since=\(Self.integer(since))" : path
  }
  private static func integer(_ n: Double) -> String {
    n == n.rounded() && abs(n) < 1e15 ? String(Int64(n)) : String(n)
  }

  // MARK: - Operations (useBoard's add / patch / delete / restore)

  private func journeyStore() throws -> JourneyStore {
    guard let journey else { throw APIError(message: "当前旅程或账号已切换，请重新打开白板") }
    return journey
  }

  private func expectLocal(_ id: String, _ expect: JSON) {
    pending.set(
      id, .init(expect: BoardPending.mergeExpected(pending[id]?.expect ?? .object([:]), expect), at: now()))
  }

  /// Queue an operation for the open board; on failure the local change is undone.
  private func submit(
    _ id: String, previous: [JSON], previousPending: BoardPending.Entry?,
    _ operation: () async throws -> Void
  ) async throws {
    do { try await operation() } catch {
      items = previous
      if let previousPending { pending.set(id, previousPending) } else { pending.remove(id) }
      writeCache()
      throw error
    }
  }

  /// Add an item (`{ content, frame, z, style?, linkedActivityId? }`) to the open board.
  @discardableResult func add(_ data: JSON) async throws -> JSON {
    guard !tripID.isEmpty, !boardID.isEmpty else { throw APIError(message: "请先打开白板") }
    let at = now()
    let id = data["id"].string.isEmpty ? UUID().uuidString.lowercased() : data["id"].string
    var fields: [String: JSON] = [
      "id": .string(id), "tripId": .string(tripID), "boardId": .string(boardID),
      "createdBy": .string(account), "createdAt": .number(at), "updatedAt": .number(at),
      "state": .string("active"), "generation": .number(0),
    ]
    for (key, value) in data.dictionary { fields[key] = value }
    let item = BoardItems.normalize(.object(fields))
    let previous = items
    let previousPending = pending[id]
    expectLocal(id, .object(["state": .string("active")]))
    items.append(item)
    writeCache()
    let patch: JSON = .object([
      "boardId": .string(boardID), "content": item["content"], "style": item["style"],
      "frame": item["frame"], "z": JSRules.truthy(item["z"]) ? item["z"] : .number(0),
      "linkedActivityId": JSRules.truthy(item["linkedActivityId"]) ? item["linkedActivityId"] : .null,
    ])
    let (trip, account) = (tripID, account)
    try await submit(id, previous: previous, previousPending: previousPending) {
      try await self.journeyStore().mutate(
        kind: "create", type: "boardItem", patch: patch, id: id, expectedTrip: trip,
        expectedAccount: account)
    }
    return item
  }

  /// Change one or more of an item's groups (frame, z, content, style, linkedActivityId;
  /// `locked` is shorthand for the style's lock). Content must be the complete new
  /// content; style is merged into the current style unless `replaceStyle`.
  @discardableResult func patch(_ itemID: String, _ patch: JSON, replaceStyle: Bool = false)
    async throws -> JSON?
  {
    guard let index = items.firstIndex(where: { $0["id"].string == itemID }) else { return nil }
    let target = items[index]
    let replace = replaceStyle && JSRules.truthy(patch["style"])
    var source = patch.dictionary
    if let style = BoardItems.nextStyle(target["style"], patch: patch, replace: replace) {
      source["style"] = style
    }
    let cleaned = BoardItems.cleanPatch(.object(source))
    let updated = BoardItems.applying(cleaned, to: target, replaceStyle: replace, now: now())
    let previous = items
    let previousPending = pending[itemID]
    expectLocal(itemID, cleaned)
    items[index] = updated
    writeCache()
    let (trip, account) = (tripID, account)
    try await submit(itemID, previous: previous, previousPending: previousPending) {
      try await self.journeyStore().mutate(
        kind: "patch", type: "boardItem", patch: cleaned, id: itemID, expectedTrip: trip,
        expectedAccount: account)
    }
    return updated
  }

  /// Any member deletes or restores board items directly (no voting). A request whose
  /// generation a peer has already moved on is answered `receipt.changed = false` when
  /// the item is already in the wanted state, and counts as done.
  func delete(_ itemID: String) async throws { try await lifecycle(itemID, state: "deleted") }
  func restore(_ itemID: String) async throws { try await lifecycle(itemID, state: "active") }

  private func lifecycle(_ itemID: String, state: String) async throws {
    guard let index = items.firstIndex(where: { $0["id"].string == itemID }) else { return }
    let target = items[index]
    let generation = target["generation"].number
    let previous = items
    let previousPending = pending[itemID]
    expectLocal(itemID, .object(["state": .string(state)]))
    items[index]["state"] = .string(state)
    items[index]["generation"] = .number(generation + 1)
    items[index]["updatedAt"] = .number(now())
    writeCache()
    let (trip, account) = (tripID, account)
    try await submit(itemID, previous: previous, previousPending: previousPending) {
      try await self.journeyStore().mutate(
        object: .object(["id": .string(itemID), "generation": .number(generation)]),
        kind: state == "deleted" ? "delete" : "restore", type: "boardItem", id: itemID,
        expectedTrip: trip, expectedAccount: account)
    }
  }

  // MARK: - Hooks from JourneyStore

  /// The server accepted one of this device's board operations for `tripID`.
  func operationAccepted(tripID: String) {
    guard tripID == self.tripID else { return }
    Task { [weak self] in await self?.refresh() }
  }

  /// The trip's queued changes were discarded: the cached boards may still show them,
  /// so forget the local changes and read the boards again in full.
  func queueDiscarded(tripID: String) {
    if let directory = directory(tripID: tripID) { try? FileManager.default.removeItem(at: directory) }
    guard tripID == self.tripID, !boardID.isEmpty else { return }
    let board = boardID
    close()
    Task { [weak self] in await self?.open(board) }
  }

  // MARK: - Cache (`board:<tripId>:<boardId>` in the web client's IndexedDB)

  private func directory(tripID: String) -> URL? {
    guard let account = journey?.boardCacheDirectory() else { return nil }
    return account.appending(path: tripID, directoryHint: .isDirectory)
  }
  private func cacheURL() -> URL? {
    guard !boardID.isEmpty, account == journey?.user.id else { return nil }
    return directory(tripID: tripID)?.appending(path: boardID + ".json")
  }
  private func readCache() -> JSON? {
    guard let url = cacheURL(), let data = try? Data(contentsOf: url),
      let cached = try? JSONDecoder().decode(JSON.self, from: data),
      case .array = cached["items"]
    else { return nil }
    return cached
  }
  private func writeCache() {
    guard let url = cacheURL() else { return }
    let value: JSON = .object([
      "cursor": .number(cursor), "epoch": epoch.map(JSON.number) ?? .null, "items": .array(items),
    ])
    // A failed cache write only costs a full read next time; the server holds the truth.
    try? FileManager.default.createDirectory(
      at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    try? JSONEncoder().encode(value).write(
      to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
  }
}

// MARK: - The trip's boards

extension JourneyStore {
  /// The boards to list (at most 20 active ones), or the default board when the trip has
  /// none yet.
  var boardList: [JSON] { BoardList.boards(objects, tripID: trip.id) }
  var deletedBoards: [JSON] { BoardList.deleted(objects) }
  func currentBoardID(selected: String?) -> String {
    BoardList.currentID(objects, selected: selected)
  }
  var canDeleteBoard: Bool { BoardList.canDelete(snapshot, userID: user.id) }
  var canRestoreBoard: Bool { BoardList.canRestore(snapshot, userID: user.id) }

  /// A new board after the others, named 「白板 N」 (Board.jsx `createBoard`).
  @discardableResult func createBoard(title: String? = nil) async throws -> String {
    let boards = BoardList.active(objects)
    let id = UUID().uuidString.lowercased()
    try await mutate(
      kind: "create", type: "board",
      patch: .object([
        "title": .string(title ?? BoardList.newTitle(boards)),
        "order": .number(BoardList.nextOrder(boards)),
      ]), id: id)
    return id
  }
  func renameBoard(_ board: JSON, title: String) async throws {
    try await mutate(object: board, kind: "patch", type: "board", patch: .object(["title": .string(title)]))
  }
  func setBoardBackground(_ board: JSON, _ background: String) async throws {
    try await mutate(
      object: board, kind: "patch", type: "board", patch: .object(["background": .string(background)]))
  }
  /// Deleting needs the owner (or an admin of an admin-run team) and keeps one board.
  func deleteBoard(_ board: JSON) async throws {
    guard BoardList.active(objects).count > 1, canDeleteBoard else { return }
    try await mutate(object: Self.lifecycleTarget(board), kind: "delete", type: "board")
  }
  func restoreBoard(_ board: JSON) async throws {
    try await mutate(object: Self.lifecycleTarget(board), kind: "restore", type: "board")
  }
  private static func lifecycleTarget(_ board: JSON) -> JSON {
    var target = board
    if target["generation"].isNull { target["generation"] = .number(0) }
    return target
  }
}
