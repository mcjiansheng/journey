import SwiftUI

private struct JourneyPaletteKey: EnvironmentKey {
  static let defaultValue = DesignTokens.forest
}
private struct JourneyFlatKey: EnvironmentKey {
  static let defaultValue = false
}
extension EnvironmentValues {
  var journeyPalette: DesignTokens.Colors {
    get { self[JourneyPaletteKey.self] }
    set { self[JourneyPaletteKey.self] = newValue }
  }
  var journeyFlat: Bool {
    get { self[JourneyFlatKey.self] }
    set { self[JourneyFlatKey.self] = newValue }
  }
}
extension DesignTokens.Colors {
  var background: Color { page }
  var surfaceSolid: Color { surface }
  var secondarySurface: Color { elevated }
  var accent: Color { primary }
  var onAccent: Color { onPrimary }
  var mint: Color { ambientMint }
  var sky: Color { ambientSky }
  var low: Color { ambientLow }
}

struct JourneyAppearance: ViewModifier {
  var paletteName: String
  var transparency: String
  var motion: String
  @Environment(\.accessibilityReduceTransparency) private var systemFlat
  @Environment(\.accessibilityReduceMotion) private var systemMotion
  func body(content: Content) -> some View {
    content.environment(\.journeyPalette, DesignTokens.palette(paletteName))
      .environment(\.journeyFlat, systemFlat || transparency == "true")
      .transaction {
        if motion == "true" || (motion == "system" && systemMotion) { $0.disablesAnimations = true }
      }
  }
}

private struct JourneyNavigationAppearance: ViewModifier {
  @Environment(\.colorScheme) private var colorScheme
  func body(content: Content) -> some View {
    content.toolbarColorScheme(colorScheme, for: .navigationBar)
  }
}

struct JourneyBackground: View {
  @Environment(\.journeyPalette) private var palette
  @Environment(\.colorScheme) private var colorScheme
  var body: some View {
    GeometryReader { geometry in
      let radius = max(geometry.size.width, geometry.size.height) * (colorScheme == .dark ? 1.15 : 0.8)
      ZStack {
        palette.background
        RadialGradient(
          colors: [palette.mint, .clear], center: .topLeading, startRadius: 0, endRadius: radius)
        RadialGradient(
          colors: [palette.sky, .clear], center: .topTrailing, startRadius: 0, endRadius: radius)
        RadialGradient(
          colors: [palette.low, .clear], center: .bottom, startRadius: 0, endRadius: radius)
      }
    }.ignoresSafeArea().allowsHitTesting(false)
  }
}

struct JourneyCard: View {
  @Environment(\.journeyPalette) private var palette
  @Environment(\.journeyFlat) private var flat
  var body: some View {
    RoundedRectangle(cornerRadius: DesignTokens.radiusLg, style: .continuous)
      .fill(palette.surfaceSolid)
      .overlay {
        RoundedRectangle(cornerRadius: DesignTokens.radiusLg, style: .continuous).strokeBorder(
          palette.border, lineWidth: 0.5)
      }
      .overlay {
        if !flat {
          RoundedRectangle(cornerRadius: DesignTokens.radiusLg, style: .continuous)
            .strokeBorder(LinearGradient(colors: [palette.highlight, .clear], startPoint: .top, endPoint: .bottom), lineWidth: 0.5)
        }
      }
      .shadow(color: flat ? .clear : palette.shadow, radius: 12, y: 4)
  }
}

// Keep native scrolling, editing, pickers and form semantics, with one surface treatment.
struct JourneyList<Content: View>: View {
  @Environment(\.journeyPalette) private var palette
  @ViewBuilder var content: Content
  var body: some View {
    List {
      content
        .listRowBackground(JourneyCard())
        .listRowSeparator(.hidden)
        .listSectionSeparator(.hidden)
        .listRowInsets(EdgeInsets(top: 16, leading: 16, bottom: 16, trailing: 16))
    }
    .listStyle(.insetGrouped).listRowSpacing(12)
    .scrollContentBackground(.hidden).background { JourneyBackground() }
    .foregroundStyle(palette.text).tint(palette.accent)
      .modifier(JourneyNavigationAppearance())
  }
}

struct JourneyForm<Content: View>: View {
  @Environment(\.journeyPalette) private var palette
  @ViewBuilder var content: Content
  var body: some View {
    Form {
      content.listRowBackground(palette.surface)
        .listRowSeparatorTint(palette.border)
    }.scrollContentBackground(.hidden).background { JourneyBackground() }
      .foregroundStyle(palette.text).tint(palette.accent)
      .modifier(JourneyNavigationAppearance())
  }
}

extension View {
  func journeyButton(prominent: Bool = false) -> some View {
    modifier(JourneyButtonModifier(prominent: prominent))
  }
}

private struct JourneyButtonModifier: ViewModifier {
  var prominent: Bool
  @Environment(\.journeyFlat) private var flat
  @Environment(\.journeyPalette) private var palette
  @ViewBuilder func body(content: Content) -> some View {
    if #available(iOS 26.0, *), !flat {
      if prominent { content.buttonStyle(JourneyGlassPrimaryStyle()) }
      else { content.buttonStyle(.glass).tint(palette.accent).foregroundStyle(palette.accent) }
    } else { content.buttonStyle(JourneyButtonStyle(prominent: prominent)) }
  }
}

private struct JourneyButtonStyle: ButtonStyle {
  @Environment(\.journeyPalette) private var palette
  var prominent: Bool
  @Environment(\.isEnabled) private var enabled
  func makeBody(configuration: Configuration) -> some View {
    configuration.label.font(.subheadline.weight(.semibold))
      .padding(.horizontal, 16).padding(.vertical, 12)
      .foregroundStyle(prominent ? palette.onAccent : palette.accent)
      .background(prominent ? palette.accent : palette.secondarySurface, in: Capsule())
      .opacity(enabled ? (configuration.isPressed ? 0.7 : 1) : 0.4)
  }
}

@available(iOS 26.0, *)
private struct JourneyGlassPrimaryStyle: ButtonStyle {
  @Environment(\.journeyPalette) private var palette
  @Environment(\.isEnabled) private var enabled
  func makeBody(configuration: Configuration) -> some View {
    configuration.label.font(.subheadline.weight(.semibold))
      .foregroundStyle(palette.onAccent)
      .padding(.horizontal, 16).frame(minHeight: 44)
      .background {
        Capsule().fill(.clear)
          .glassEffect(.regular.tint(palette.accent).interactive(), in: Capsule())
      }
      .opacity(enabled ? (configuration.isPressed ? 0.8 : 1) : 0.4)
  }
}

extension ToolbarContent {
  @ToolbarContentBuilder func journeyOwnGlass() -> some ToolbarContent {
    if #available(iOS 26.0, *) { self.sharedBackgroundVisibility(.hidden) } else { self }
  }
}

struct JourneyTabBar: View {
  @Environment(\.journeyPalette) private var palette
  @Environment(\.journeyFlat) private var flat
  @Binding var selection: String
  private let tabs = [
    ("itinerary", "行程", "list.bullet.rectangle"), ("map", "地图", "map"),
    ("ledger", "费用", "creditcard"), ("settings", "旅程设置", "slider.horizontal.3"),
  ]
  var body: some View {
    HStack(spacing: 4) {
      ForEach(tabs, id: \.0) { id, title, symbol in
        Button {
          selection = id
        } label: {
          VStack(spacing: 5) {
            Image(systemName: symbol).font(.system(size: 20, weight: .medium))
            Text(title).font(.caption2.weight(.semibold))
          }.foregroundStyle(selection == id ? palette.accent : palette.muted)
            .frame(maxWidth: .infinity).frame(minHeight: 54)
            .background(selection == id ? palette.selected : .clear, in: Capsule())
            .contentShape(Capsule())
        }.buttonStyle(.plain).accessibilityIdentifier("tab." + id)
          .accessibilityAddTraits(selection == id ? [.isSelected] : [])
      }
    }.padding(6).background { navigationGlass }
      .accessibilityElement(children: .contain).accessibilityLabel("页面导航")
      .padding(.horizontal, 20).padding(.bottom, 8)
  }
  @ViewBuilder private var navigationGlass: some View {
    if #available(iOS 26.0, *), !flat {
      Capsule().fill(.clear).glassEffect(.regular, in: Capsule())
    } else {
      Capsule().fill(palette.surfaceSolid).overlay { Capsule().strokeBorder(palette.border) }
    }
  }
}

struct EditorSaveStatus: View {
  @Environment(\.journeyPalette) private var palette
  var draftKey = ""
  @EnvironmentObject var store: JourneyStore
  var body: some View {
    let queued = store.cache.queue.contains { $0.tripID == store.selectedTrip }
    let local = queued || !store.draft(draftKey).isNull
    let syncing = queued && store.status == "正在上传…"
    Label(
      syncing ? "正在同步" : local ? "已保存到此设备" : "已同步",
      systemImage: local ? "internaldrive" : "checkmark.icloud"
    )
    .font(.caption).foregroundStyle(palette.muted)
  }
}
