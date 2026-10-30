import SwiftUI

// Shared roles for every native screen. Light keeps the web's mint / sky / cream family.
enum Palette {
  private static func adaptive(
    _ light: UInt32, _ dark: UInt32, lightAlpha: CGFloat = 1, darkAlpha: CGFloat = 1
  ) -> Color {
    Color(
      uiColor: UIColor { traits in
        let value = traits.userInterfaceStyle == .dark ? dark : light
        return UIColor(
          red: CGFloat((value >> 16) & 255) / 255,
          green: CGFloat((value >> 8) & 255) / 255,
          blue: CGFloat(value & 255) / 255,
          alpha: traits.userInterfaceStyle == .dark ? darkAlpha : lightAlpha)
      })
  }
  static let background = adaptive(0xEEF2EC, 0x0F1613)
  static let surface = adaptive(0xFFFFFF, 0xFFFFFF, lightAlpha: 0.68, darkAlpha: 0.06)
  static let surfaceSolid = adaptive(0xFAFCF9, 0x1D2521)
  static let secondarySurface = adaptive(0xFFFFFF, 0xFFFFFF, lightAlpha: 0.85, darkAlpha: 0.08)
  static let border = adaptive(0xB5C6BB, 0xFFFFFF, lightAlpha: 0.30, darkAlpha: 0.08)
  static let iconBackground = adaptive(0xD9E4D2, 0x22302A)
  static let text = adaptive(0x22332B, 0xE6EEE9)
  static let muted = adaptive(0x6B7A72, 0x93A39B)
  static let accent = adaptive(0x3A6B5A, 0x7FCBA5)
  static let onAccent = adaptive(0xFFFFFF, 0x0E1F17)
  static let selected = adaptive(0xFFFFFF, 0x7FCBA5, darkAlpha: 0.16)
  static let danger = adaptive(0xC9594F, 0xE5857D)
  static let mint = adaptive(0xDCEEE5, 0x14261C, lightAlpha: 0.65, darkAlpha: 0.60)
  static let sky = adaptive(0xDCEBF7, 0x14201F, lightAlpha: 0.63)
  static let warm = adaptive(0xFFF8E7, 0x1A1D14, lightAlpha: 0.60)
  static let shadow = adaptive(0x294B3B, 0x000000, lightAlpha: 0.04, darkAlpha: 0.12)
}

struct JourneyBackground: View {
  var body: some View {
    GeometryReader { geometry in
      let radius = max(geometry.size.width, geometry.size.height) * 0.8
      ZStack {
        Palette.background
        RadialGradient(
          colors: [Palette.mint, .clear], center: .topLeading, startRadius: 0, endRadius: radius)
        RadialGradient(
          colors: [Palette.sky, .clear], center: .topTrailing, startRadius: 0, endRadius: radius)
        RadialGradient(
          colors: [Palette.warm, .clear], center: .bottom, startRadius: 0, endRadius: radius)
      }
    }.ignoresSafeArea().allowsHitTesting(false)
  }
}

struct JourneyCard: View {
  @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
  var body: some View {
    RoundedRectangle(cornerRadius: 22, style: .continuous)
      .fill(reduceTransparency ? Palette.surfaceSolid : Palette.surface)
      .overlay {
        RoundedRectangle(cornerRadius: 22, style: .continuous).strokeBorder(
          Palette.border, lineWidth: 0.5)
      }
      .shadow(color: Palette.shadow, radius: 12, y: 4)
  }
}

// Keep native scrolling, editing, pickers and form semantics, with one surface treatment.
struct JourneyList<Content: View>: View {
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
    .foregroundStyle(Palette.text).tint(Palette.accent)
  }
}

struct JourneyForm<Content: View>: View {
  @ViewBuilder var content: Content
  var body: some View {
    Form {
      content.listRowBackground(Palette.surface)
        .listRowSeparatorTint(Palette.border)
    }.scrollContentBackground(.hidden).background { JourneyBackground() }
      .foregroundStyle(Palette.text).tint(Palette.accent)
  }
}

extension View {
  @ViewBuilder func journeyButton(prominent: Bool = false) -> some View {
    if #available(iOS 26.0, *) {
      if prominent {
        self.buttonStyle(JourneyGlassPrimaryStyle())
      } else {
        self.buttonStyle(.glass).tint(Palette.accent).foregroundStyle(Palette.accent)
      }
    } else {
      self.buttonStyle(JourneyButtonStyle(prominent: prominent))
    }
  }
}

private struct JourneyButtonStyle: ButtonStyle {
  var prominent: Bool
  @Environment(\.isEnabled) private var enabled
  func makeBody(configuration: Configuration) -> some View {
    configuration.label.font(.subheadline.weight(.semibold))
      .padding(.horizontal, 16).padding(.vertical, 12)
      .foregroundStyle(prominent ? Palette.onAccent : Palette.accent)
      .background(prominent ? Palette.accent : Palette.secondarySurface, in: Capsule())
      .opacity(enabled ? (configuration.isPressed ? 0.7 : 1) : 0.4)
  }
}

@available(iOS 26.0, *)
private struct JourneyGlassPrimaryStyle: ButtonStyle {
  @Environment(\.isEnabled) private var enabled
  func makeBody(configuration: Configuration) -> some View {
    configuration.label.font(.subheadline.weight(.semibold))
      .foregroundStyle(Palette.onAccent)
      .padding(.horizontal, 16).frame(minHeight: 44)
      .background {
        Capsule().fill(.clear)
          .glassEffect(.regular.tint(Palette.accent).interactive(), in: Capsule())
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
  @Binding var selection: String
  private let tabs = [
    ("itinerary", "行程", "list.bullet.rectangle"), ("map", "地图", "map"),
    ("ledger", "费用", "creditcard"), ("settings", "管理", "slider.horizontal.3"),
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
          }.foregroundStyle(selection == id ? Palette.accent : Palette.muted)
            .frame(maxWidth: .infinity).frame(minHeight: 54)
            .background(selection == id ? Palette.selected : .clear, in: Capsule())
            .contentShape(Capsule())
        }.buttonStyle(.plain).accessibilityIdentifier("tab." + id)
          .accessibilityAddTraits(selection == id ? [.isSelected] : [])
      }
    }.padding(6).background { navigationGlass }
      .accessibilityElement(children: .contain).accessibilityLabel("页面导航")
      .padding(.horizontal, 20).padding(.bottom, 8)
  }
  @ViewBuilder private var navigationGlass: some View {
    if #available(iOS 26.0, *) {
      Capsule().fill(.clear).glassEffect(.regular, in: Capsule())
    } else {
      Capsule().fill(Palette.surfaceSolid).overlay { Capsule().strokeBorder(Palette.border) }
    }
  }
}
