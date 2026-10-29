import XCTest

final class JourneyUITests: XCTestCase {
  func testLocalBackendLoginAndNativeTabs() throws {
    continueAfterFailure = false
    let fixtureURL = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
      .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
      .appendingPathComponent(".local/mobile-acceptance/fixture.json")
    let fixtureData = ProcessInfo.processInfo.environment["JOURNEY_FIXTURE_JSON"]
      .map { Data($0.utf8) } ?? (try? Data(contentsOf: fixtureURL))
    guard let data = fixtureData,
      let fixture = try JSONSerialization.jsonObject(with: data) as? [String: String]
    else {
      throw XCTSkip(
        "Run node mobile/tools/dev-server.mjs --seed and provide JOURNEY_FIXTURE_JSON for device UI tests")
    }
    let app = XCUIApplication()
    app.launchEnvironment["JOURNEY_SERVER_URL"] = fixture["serverURL"]
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
    let trip = app.buttons["trip.open." + fixture["tripId"]!]
    XCTAssertTrue(trip.waitForExistence(timeout: 20))
    let homeShot = XCTAttachment(screenshot: app.screenshot())
    homeShot.name = "native-home"
    homeShot.lifetime = .keepAlways
    add(homeShot)
    trip.staticTexts["南京周末"].tap()
    XCTAssertTrue(app.tabBars.buttons["行程"].waitForExistence(timeout: 15))
    for name in ["地图", "费用", "管理", "行程"] {
      app.tabBars.buttons[name].tap()
      XCTAssertTrue(app.tabBars.buttons[name].isSelected)
      if name == "地图" { sleep(5) }
      let shot = XCTAttachment(screenshot: app.screenshot())
      shot.name = "native-" + name
      shot.lifetime = .keepAlways
      add(shot)
    }
    app.buttons["添加活动"].tap()
    if app.buttons["使用当前内容"].waitForExistence(timeout: 1) { app.buttons["使用当前内容"].tap() }
    let title = app.textFields["活动名称"]
    XCTAssertTrue(title.waitForExistence(timeout: 5))
    title.tap()
    title.typeText("原生 UI 活动 " + String(Int(Date().timeIntervalSince1970)))
    app.buttons["activity.save"].tap()
    XCTAssertTrue(title.waitForNonExistence(timeout: 10))
    XCTAssertTrue(app.buttons["添加活动"].waitForExistence(timeout: 10))
    let routes = app.buttons.matching(NSPredicate(format: "label == %@", "前往这一站"))
    if routes.count > 1 {
      routes.element(boundBy: 1).tap()
      let routeMinutes = app.textFields["路程时间（分钟）"]
      XCTAssertTrue(routeMinutes.waitForExistence(timeout: 5))
      routeMinutes.tap()
      routeMinutes.typeText("12")
      app.navigationBars.buttons["保存"].tap()
      XCTAssertTrue(routeMinutes.waitForNonExistence(timeout: 10))
    }
    app.tabBars.buttons["费用"].tap()
    app.buttons["添加费用"].tap()
    if app.buttons["使用当前内容"].waitForExistence(timeout: 1) { app.buttons["使用当前内容"].tap() }
    let expenseName = app.textFields["费用名称（可不填）"]
    XCTAssertTrue(expenseName.waitForExistence(timeout: 5))
    expenseName.tap()
    expenseName.typeText("原生午餐 " + String(Int(Date().timeIntervalSince1970)))
    let amount = app.textFields["金额"]
    amount.tap()
    amount.typeText("23.50")
    app.navigationBars.buttons["保存"].tap()
    XCTAssertTrue(app.buttons["添加费用"].waitForExistence(timeout: 10))
    let shot = XCTAttachment(screenshot: app.screenshot())
    shot.name = "native-itinerary"
    shot.lifetime = .keepAlways
    add(shot)
  }
}
