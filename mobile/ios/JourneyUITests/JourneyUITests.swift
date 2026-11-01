import XCTest

final class JourneyUITests: XCTestCase {
  func testLocalBackendLoginAndNativeTabs() throws {
    try verifyNativeScreens(theme: "dark", edit: true)
  }

  func testLightAppearance() throws {
    try verifyNativeScreens(theme: "light", edit: false)
  }

  func testCreateTripWithAutomaticBeijingTimezone() throws {
    continueAfterFailure = false
    let fixtureURL = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
      .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
      .appendingPathComponent(".local/mobile-acceptance/fixture.json")
    let data =
      ProcessInfo.processInfo.environment["JOURNEY_FIXTURE_JSON"].map { Data($0.utf8) }
      ?? (try? Data(contentsOf: fixtureURL))
    guard let data, let fixture = try JSONSerialization.jsonObject(with: data) as? [String: String]
    else { throw XCTSkip("Local backend fixture is required") }
    let app = XCUIApplication()
    app.launchEnvironment["JOURNEY_SERVER_URL"] = fixture["serverURL"]
    app.launchArguments = ["-journey.theme", "light"]
    app.launch()
    let account = app.textFields["auth.identifier"]
    let ready = XCTNSPredicateExpectation(
      predicate: NSPredicate { _, _ in
        account.exists || app.buttons["创建旅程"].exists || app.buttons["我的旅程"].exists
      }, object: app)
    XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 20), .completed)
    if account.exists {
      account.tap()
      account.typeText(fixture["identifier"]!)
      let password = app.secureTextFields["auth.password"]
      password.tap()
      password.typeText(fixture["password"]!)
      app.buttons["auth.submit"].tap()
    }
    if app.buttons["我的旅程"].exists { app.buttons["我的旅程"].tap() }
    XCTAssertTrue(app.buttons["创建旅程"].waitForExistence(timeout: 20))
    app.buttons["创建旅程"].tap()
    let title = app.textFields["trip.name"]
    XCTAssertTrue(title.waitForExistence(timeout: 5))
    title.tap()
    title.typeText("北京时区验收 " + String(Int(Date().timeIntervalSince1970)))
    let destination = app.textFields["trip.destination"]
    destination.tap()
    destination.typeText("北京")
    XCTAssertTrue(app.buttons["team.mode.admin"].isSelected)
    XCTAssertFalse(app.buttons["按目的地确认时区"].exists)
    app.buttons["team.mode.equal"].tap()
    XCTAssertTrue(app.buttons["team.mode.equal"].isSelected)
    app.buttons["team.mode.admin"].tap()
    XCTAssertFalse(app.keyboards.firstMatch.exists)
    app.swipeUp()
    let screenshot = XCTAttachment(screenshot: app.screenshot())
    screenshot.name = "create-trip-beijing-team-cards"
    screenshot.lifetime = .keepAlways
    add(screenshot)
    let create = app.buttons["trip.create"]
    XCTAssertTrue(create.isEnabled)
    create.tap()
    XCTAssertTrue(app.buttons["tab.itinerary"].waitForExistence(timeout: 20))
  }

  func testPaletteSettingsScreenshots() throws {
    try verifyPaletteSettingsScreenshots(flatOnly: false)
  }

  func testFlatPaletteSettingsScreenshots() throws {
    try verifyPaletteSettingsScreenshots(flatOnly: true)
  }

  private func verifyPaletteSettingsScreenshots(flatOnly: Bool) throws {
    continueAfterFailure = false
    let fixtureURL = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
      .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
      .appendingPathComponent(".local/mobile-acceptance/fixture.json")
    let data = ProcessInfo.processInfo.environment["JOURNEY_FIXTURE_JSON"].map { Data($0.utf8) }
      ?? (try? Data(contentsOf: fixtureURL))
    guard let data, let fixture = try JSONSerialization.jsonObject(with: data) as? [String: String]
    else { throw XCTSkip("Local backend fixture is required") }
    let app = XCUIApplication()
    app.launchEnvironment["JOURNEY_SERVER_URL"] = fixture["serverURL"]
    app.launch()
    let account = app.textFields["auth.identifier"]
    let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
      account.exists || app.buttons["创建旅程"].exists || app.buttons["tab.itinerary"].exists
    }, object: app)
    XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 30), .completed)
    if app.buttons["tab.itinerary"].exists {
      app.buttons["tab.itinerary"].tap(); app.buttons["我的旅程"].tap()
    }
    let fixtureTrip = app.buttons["trip.open." + fixture["tripId"]!]
    if !account.exists && !fixtureTrip.waitForExistence(timeout: 3) {
      app.buttons["settings.personal"].tap()
      app.buttons["退出登录"].tap()
      XCTAssertTrue(account.waitForExistence(timeout: 10))
    }
    if account.exists {
      account.tap(); account.typeText(fixture["identifier"]!)
      let password = app.secureTextFields["auth.password"]
      password.tap(); password.typeText(fixture["password"]!)
      app.buttons["auth.submit"].tap()
      XCTAssertTrue(app.buttons["创建旅程"].waitForExistence(timeout: 20))
    }
    XCTAssertTrue(fixtureTrip.waitForExistence(timeout: 20))
    func capture(_ name: String) {
      let shot = XCTAttachment(screenshot: app.screenshot())
      shot.name = "ios-palettes-" + name; shot.lifetime = .keepAlways; add(shot)
    }
    for palette in ["forest", "atlas"] {
      for theme in ["light", "dark"] {
        for flat in flatOnly ? [true] : [false, true] {
          let prefix = palette + "-" + theme + (flat ? "-flat" : "-glass")
          app.buttons["settings.personal"].tap()
          XCTAssertTrue(app.buttons["settings.appearance"].waitForExistence(timeout: 5))
          app.buttons["settings.appearance"].tap()
          let paletteButton = app.buttons["settings.palette." + palette]
          XCTAssertTrue(paletteButton.waitForExistence(timeout: 5)); paletteButton.tap()
          let themeButton = app.buttons["settings.theme." + theme]
          XCTAssertTrue(themeButton.waitForExistence(timeout: 5))
          let enabled = NSPredicate(format: "enabled == true")
          expectation(for: enabled, evaluatedWith: themeButton); waitForExpectations(timeout: 10)
          themeButton.tap()
          let segment = app.segmentedControls["settings.transparency"].buttons[flat ? "开" : "关"]
          if !segment.isHittable { app.swipeUp() }
          expectation(for: enabled, evaluatedWith: segment); waitForExpectations(timeout: 10)
          segment.tap()
          capture(prefix + "-appearance")
          app.navigationBars["外观"].buttons["BackButton"].tap()
          capture(prefix + "-settings")
          app.buttons["完成"].tap()
          capture(prefix + "-home")
          app.buttons["trip.open." + fixture["tripId"]!].tap()
          XCTAssertTrue(app.buttons["tab.itinerary"].waitForExistence(timeout: 10))
          capture(prefix + "-itinerary")
          app.buttons["tab.settings"].tap()
          XCTAssertTrue(app.navigationBars["旅程设置"].waitForExistence(timeout: 5))
          capture(prefix + "-trip-settings")
          app.buttons["settings.personal"].tap()
          XCTAssertTrue(app.navigationBars["我的设置"].waitForExistence(timeout: 5))
          app.buttons["完成"].tap()
          app.buttons["tab.itinerary"].tap(); app.buttons["我的旅程"].tap()
        }
      }
    }
    app.terminate()
  }

  func testR3NativeScreenshots() throws {
    continueAfterFailure = false
    let fixtureURL = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
      .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
      .appendingPathComponent(".local/mobile-acceptance/fixture.json")
    let data =
      ProcessInfo.processInfo.environment["JOURNEY_FIXTURE_JSON"].map { Data($0.utf8) }
      ?? (try? Data(contentsOf: fixtureURL))
    guard let data, let fixture = try JSONSerialization.jsonObject(with: data) as? [String: String]
    else { throw XCTSkip("Local backend fixture is required for native screenshots") }
    let app = XCUIApplication()
    app.launchEnvironment["JOURNEY_SERVER_URL"] = fixture["serverURL"]
    for theme in ["light", "dark"] {
      app.launchArguments = ["-journey.theme", theme]
      app.launch()
      let account = app.textFields["auth.identifier"]
      let ready = XCTNSPredicateExpectation(
        predicate: NSPredicate { _, _ in
          account.exists || app.buttons["创建旅程"].exists || app.buttons["tab.itinerary"].exists
        }, object: app)
      XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 30), .completed)
      if app.buttons["tab.itinerary"].exists {
        app.buttons["tab.itinerary"].tap()
        app.buttons["我的旅程"].tap()
      }
      let trip = app.buttons["trip.open." + fixture["tripId"]!]
      if !account.exists && !trip.exists {
        app.buttons["我的设置"].tap()
        app.buttons["退出登录"].tap()
        XCTAssertTrue(account.waitForExistence(timeout: 10))
      }
      if account.exists {
        account.tap()
        account.typeText(fixture["identifier"]!)
        let password = app.secureTextFields["auth.password"]
        password.tap()
        password.typeText(fixture["password"]!)
        app.buttons["auth.submit"].tap()
      }
      XCTAssertTrue(trip.waitForExistence(timeout: 20))
      chooseAppearance(theme, in: app)
      func capture(_ name: String) {
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = "ios-" + theme + "-" + name
        shot.lifetime = .keepAlways
        add(shot)
      }
      capture("home")
      trip.tap()
      XCTAssertTrue(app.buttons["tab.itinerary"].waitForExistence(timeout: 15))
      for (id, title, name) in [
        ("itinerary", "行程", "itinerary"), ("map", "地图", "map"),
        ("ledger", "费用", "ledger"), ("settings", "旅程设置", "management"),
      ] {
        app.buttons["tab." + id].tap()
        XCTAssertTrue(app.buttons["tab." + id].isSelected)
        XCTAssertTrue(app.navigationBars[title].waitForExistence(timeout: 5))
        capture(name)
      }
      app.buttons["tab.itinerary"].tap()
      let activity = app.buttons.containing(.staticText, identifier: "逛南京博物院").firstMatch
      XCTAssertTrue(activity.waitForExistence(timeout: 5))
      activity.tap()
      XCTAssertTrue(app.buttons["activity.save"].waitForExistence(timeout: 5))
      XCTAssertEqual(app.buttons["activity.save"].label, "完成")
      XCTAssertTrue(app.buttons["activity.save"].isEnabled)
      capture("activity-editor")
      app.navigationBars.buttons["收起"].tap()
      app.terminate()
    }
  }

  private func chooseAppearance(_ theme: String, in app: XCUIApplication) {
    app.buttons["settings.personal"].tap()
    XCTAssertTrue(app.buttons["settings.appearance"].waitForExistence(timeout: 5))
    app.buttons["settings.appearance"].tap()
    let choice = app.buttons["settings.theme." + theme]
    XCTAssertTrue(choice.waitForExistence(timeout: 5)); choice.tap()
    expectation(for: NSPredicate(format: "enabled == true"), evaluatedWith: choice)
    waitForExpectations(timeout: 10)
    app.navigationBars["外观"].buttons["BackButton"].tap()
    app.buttons["完成"].tap()
  }

  private func verifyNativeScreens(theme: String, edit: Bool) throws {
    continueAfterFailure = false
    let fixtureURL = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
      .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
      .appendingPathComponent(".local/mobile-acceptance/fixture.json")
    let fixtureData =
      ProcessInfo.processInfo.environment["JOURNEY_FIXTURE_JSON"]
      .map { Data($0.utf8) } ?? (try? Data(contentsOf: fixtureURL))
    guard let data = fixtureData,
      let fixture = try JSONSerialization.jsonObject(with: data) as? [String: String]
    else {
      throw XCTSkip(
        "Run node mobile/tools/dev-server.mjs --seed and provide JOURNEY_FIXTURE_JSON for device UI tests"
      )
    }
    let app = XCUIApplication()
    app.launchEnvironment["JOURNEY_SERVER_URL"] = fixture["serverURL"]
    app.launchArguments = ["-journey.theme", theme]
    app.launch()
    let identifier = app.textFields["auth.identifier"]
    if identifier.waitForExistence(timeout: 20) {
      identifier.tap()
      identifier.typeText(fixture["identifier"]!)
      let password = app.secureTextFields["auth.password"]
      password.tap()
      password.typeText(fixture["password"]!)
      app.buttons["auth.submit"].tap()
    }
    if app.buttons["我的旅程"].waitForExistence(timeout: 2) { app.buttons["我的旅程"].tap() }
    let trip = app.buttons["trip.open." + fixture["tripId"]!]
    XCTAssertTrue(trip.waitForExistence(timeout: 20))
    chooseAppearance(theme, in: app)
    let homeShot = XCTAttachment(screenshot: app.screenshot())
    homeShot.name = theme + "-home"
    homeShot.lifetime = .keepAlways
    add(homeShot)
    trip.staticTexts["南京周末"].tap()
    XCTAssertTrue(app.buttons["tab.itinerary"].waitForExistence(timeout: 15))
    for (id, name) in [("map", "地图"), ("ledger", "费用"), ("settings", "旅程设置"), ("itinerary", "行程")] {
      app.buttons["tab." + id].tap()
      XCTAssertTrue(app.buttons["tab." + id].isSelected)
      if name == "地图" { sleep(5) }
      let shot = XCTAttachment(screenshot: app.screenshot())
      shot.name = theme + "-" + name
      shot.lifetime = .keepAlways
      add(shot)
    }
    if !edit { return }
    app.buttons["添加活动"].tap()
    if app.buttons["使用当前内容"].waitForExistence(timeout: 1) { app.buttons["使用当前内容"].tap() }
    let title = app.textFields["活动名称"]
    XCTAssertTrue(title.waitForExistence(timeout: 5))
    let editorShot = XCTAttachment(screenshot: app.screenshot())
    editorShot.name = theme + "-activity-editor"
    editorShot.lifetime = .keepAlways
    add(editorShot)
    // An incomplete activity stays a draft and reopens without creating a blank row.
    let notes = app.textViews.firstMatch.exists ? app.textViews.firstMatch : app.textFields["备注"]
    notes.tap()
    notes.typeText("收起后保留的输入")
    app.navigationBars.buttons["收起"].tap()
    XCTAssertTrue(app.buttons["添加活动"].waitForExistence(timeout: 10))
    app.buttons["添加活动"].tap()
    XCTAssertTrue(app.buttons["恢复输入"].waitForExistence(timeout: 5))
    app.buttons["恢复输入"].tap()
    XCTAssertEqual(notes.value as? String, "收起后保留的输入")
    let stamp = String(Int(Date().timeIntervalSince1970))
    let firstTitle = "原生 UI 活动 A " + stamp
    let secondTitle = "原生 UI 活动 B " + stamp
    title.tap()
    title.typeText(firstTitle)
    sleep(1)  // Allow automatic creation before leaving an incomplete edit in the draft.
    title.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: firstTitle.count))
    app.navigationBars.buttons["收起"].tap()
    app.buttons["添加活动"].tap()
    XCTAssertTrue(app.buttons["使用当前内容"].waitForExistence(timeout: 5))
    app.buttons["使用当前内容"].tap()
    title.tap()
    title.typeText(secondTitle)
    app.buttons["activity.save"].tap()
    XCTAssertTrue(title.waitForNonExistence(timeout: 10))
    XCTAssertTrue(app.buttons["添加活动"].waitForExistence(timeout: 10))
    app.swipeUp()
    XCTAssertTrue(app.buttons.containing(.staticText, identifier: firstTitle).firstMatch.exists)
    XCTAssertTrue(app.buttons.containing(.staticText, identifier: secondTitle).firstMatch.exists)
    app.buttons["排序"].tap()
    let routes = app.buttons.matching(NSPredicate(format: "label == %@", "添加路程"))
    if routes.count > 1 {
      routes.element(boundBy: 1).tap()
      let routeMinutes = app.textFields["路程时间（分钟）"]
      XCTAssertTrue(routeMinutes.waitForExistence(timeout: 5))
      routeMinutes.tap()
      routeMinutes.typeText("12")
      app.navigationBars.buttons["完成"].tap()
      XCTAssertTrue(routeMinutes.waitForNonExistence(timeout: 10))
    }
    app.buttons["tab.ledger"].tap()
    app.buttons["添加费用"].tap()
    if app.buttons["使用当前内容"].waitForExistence(timeout: 1) { app.buttons["使用当前内容"].tap() }
    let expenseName = app.textFields["费用名称（可不填）"]
    XCTAssertTrue(expenseName.waitForExistence(timeout: 5))
    expenseName.tap()
    expenseName.typeText("原生午餐 " + String(Int(Date().timeIntervalSince1970)))
    let amount = app.textFields["金额"]
    amount.tap()
    amount.typeText("23.50")
    app.navigationBars.buttons["完成"].tap()
    XCTAssertTrue(app.buttons["添加费用"].waitForExistence(timeout: 10))
    let shot = XCTAttachment(screenshot: app.screenshot())
    shot.name = "native-itinerary"
    shot.lifetime = .keepAlways
    add(shot)
  }
}
