// Home screen widget: the Moldavite mark and today's date, opening the app on
// today's daily note through `moldavite://today` (routed in
// src-tauri/src/deep_link.rs). WidgetKit widgets cannot take typed input, so
// the tap is the whole interaction. Colours mirror the Cream tokens in
// src/index.css for light and dark.

import SwiftUI
import WidgetKit

private enum Palette {
    static let background = dynamic(light: 0xF9F6ED, dark: 0x14120C)
    static let ink = dynamic(light: 0x0E0D0A, dark: 0xF9F6ED)
    static let green = dynamic(light: 0x2E5B3C, dark: 0x7FB58C)
    static let muted = Color(UIColor { trait in
        trait.userInterfaceStyle == .dark
            ? UIColor(hex: 0xF9F6ED).withAlphaComponent(0.34)
            : UIColor(hex: 0x0E0D0A).withAlphaComponent(0.34)
    })
    static let hairline = Color(UIColor { trait in
        trait.userInterfaceStyle == .dark
            ? UIColor(hex: 0xF9F6ED).withAlphaComponent(0.14)
            : UIColor(hex: 0x0E0D0A).withAlphaComponent(0.13)
    })

    private static func dynamic(light: UInt32, dark: UInt32) -> Color {
        Color(UIColor { trait in
            trait.userInterfaceStyle == .dark ? UIColor(hex: dark) : UIColor(hex: light)
        })
    }
}

private extension UIColor {
    convenience init(hex: UInt32) {
        self.init(
            red: CGFloat((hex >> 16) & 0xFF) / 255,
            green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255,
            alpha: 1
        )
    }
}

/// The Moldavite monogram from public/monogram.svg, drawn as a path so the
/// widget needs no image asset and tints with the palette. The SVG is a single
/// polygon in a 1074.5 square, flipped and offset by its transform.
struct MonogramShape: Shape {
    private static let points: [CGPoint] = [
        CGPoint(x: 208, y: 426.25), CGPoint(x: 421.25, y: 65), CGPoint(x: 634.5, y: 426.25),
        CGPoint(x: 682.5, y: 0), CGPoint(x: 805, y: 0), CGPoint(x: 708.75, y: 735),
        CGPoint(x: 421.25, y: 260.25), CGPoint(x: 133.75, y: 735), CGPoint(x: 37.5, y: 0),
        CGPoint(x: 160, y: 0),
    ]
    private static let viewBox: CGFloat = 1074.5
    private static let offset = CGPoint(x: 116.0, y: 904.8)

    func path(in rect: CGRect) -> Path {
        let scale = min(rect.width, rect.height) / Self.viewBox
        var path = Path()
        for (index, point) in Self.points.enumerated() {
            let x = rect.minX + (Self.offset.x + point.x) * scale
            let y = rect.minY + (Self.offset.y - point.y) * scale
            if index == 0 { path.move(to: CGPoint(x: x, y: y)) } else { path.addLine(to: CGPoint(x: x, y: y)) }
        }
        path.closeSubpath()
        return path
    }
}

struct TodayEntry: TimelineEntry {
    let date: Date
}

struct TodayProvider: TimelineProvider {
    func placeholder(in context: Context) -> TodayEntry {
        TodayEntry(date: Date())
    }

    func getSnapshot(in context: Context, completion: @escaping (TodayEntry) -> Void) {
        completion(TodayEntry(date: Date()))
    }

    // One entry now and one at midnight, then ask again: the widget only ever
    // shows the date, so it needs to change exactly once a day.
    func getTimeline(in context: Context, completion: @escaping (Timeline<TodayEntry>) -> Void) {
        let now = Date()
        let calendar = Calendar.current
        let tomorrow = calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: now)) ?? now
        completion(Timeline(entries: [TodayEntry(date: now), TodayEntry(date: tomorrow)], policy: .after(tomorrow)))
    }
}

struct MoldaviteTodayView: View {
    let entry: TodayEntry
    @Environment(\.widgetFamily) private var family

    private var dayNumber: String {
        entry.date.formatted(.dateTime.day())
    }

    private var monthName: String {
        entry.date.formatted(.dateTime.month(.wide))
    }

    private var weekday: String {
        entry.date.formatted(.dateTime.weekday(.wide)).uppercased()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                MonogramShape()
                    .fill(Palette.ink)
                    .frame(width: 18, height: 18)
                Text("Moldavite")
                    .font(.system(size: 14, weight: .medium))
                Spacer(minLength: 0)
                Image(systemName: "arrow.up.right")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Palette.muted)
            }
            .foregroundStyle(Palette.ink)

            Spacer(minLength: 6)

            if family == .systemMedium {
                HStack(alignment: .lastTextBaseline, spacing: 10) {
                    Text(dayNumber)
                        .font(.system(size: 44, weight: .regular, design: .monospaced))
                    Text(monthName)
                        .font(.system(size: 22, weight: .regular, design: .monospaced))
                    Spacer(minLength: 0)
                }
                .foregroundStyle(Palette.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            } else {
                Text(dayNumber)
                    .font(.system(size: 40, weight: .regular, design: .monospaced))
                    .foregroundStyle(Palette.ink)
                Text(monthName)
                    .font(.system(size: 15, weight: .regular, design: .monospaced))
                    .foregroundStyle(Palette.ink)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }

            Rectangle()
                .fill(Palette.hairline)
                .frame(height: 1)
                .padding(.vertical, 6)

            HStack(spacing: 6) {
                Circle().fill(Palette.green).frame(width: 5, height: 5)
                Text(weekday)
                    .font(.system(size: 10, weight: .medium))
                    .tracking(1.4)
                    .foregroundStyle(Palette.muted)
                Spacer(minLength: 0)
                if family == .systemMedium {
                    Text("OPEN TODAY'S NOTE")
                        .font(.system(size: 10, weight: .medium))
                        .tracking(1.4)
                        .foregroundStyle(Palette.muted)
                }
            }
            .lineLimit(1)
        }
        .containerBackground(for: .widget) { Palette.background }
        .widgetURL(URL(string: "moldavite://today"))
    }
}

struct MoldaviteTodayWidget: Widget {
    let kind = "MoldaviteToday"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: TodayProvider()) { entry in
            MoldaviteTodayView(entry: entry)
        }
        .configurationDisplayName("Today")
        .description("Opens Moldavite on today's note.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

@main
struct MoldaviteWidgetBundle: WidgetBundle {
    var body: some Widget {
        MoldaviteTodayWidget()
    }
}
