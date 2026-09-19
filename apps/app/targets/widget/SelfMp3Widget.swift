import SwiftUI
import WidgetKit

// The home-screen widgets (docs/ui-mock P28): four tag tiles that play on tap,
// and what is playing. They draw the snapshot the app leaves in the App Group
// (apps/app/src/features/widget/widget.model.ts is its shape) and ask for
// nothing; a tap is a link back into the app, which does the playing.

private let appGroup = "group.com.selfmp3.app"
private let snapshotKey = "widget.snapshot"

struct Snapshot: Decodable {
  let tiles: [Tile]
  let nowPlaying: NowPlaying?
  let madeAt: Double
}

struct Tile: Decodable, Identifiable {
  let name: String
  let fill: String
  let ink: String
  let songs: Int
  let link: String
  let cover: String
  var id: String { name }
}

struct NowPlaying: Decodable {
  let title: String
  let artist: String
  let playing: Bool
  let endsAt: Double
  let remaining: Double
  let cover: String
  let link: String
}

enum SnapshotStore {
  /// The last snapshot the app wrote, or nil before the app has run once.
  static func read() -> Snapshot? {
    guard
      let text = UserDefaults(suiteName: appGroup)?.string(forKey: snapshotKey),
      let data = text.data(using: .utf8)
    else { return nil }
    return try? JSONDecoder().decode(Snapshot.self, from: data)
  }
}

struct SnapshotEntry: TimelineEntry {
  let date: Date
  let snapshot: Snapshot?
}

/// One entry, kept until the app writes a new snapshot and reloads the widgets:
/// the countdown of a playing song is drawn by the system itself.
struct SnapshotProvider: TimelineProvider {
  func placeholder(in context: Context) -> SnapshotEntry {
    SnapshotEntry(date: .now, snapshot: nil)
  }

  func getSnapshot(in context: Context, completion: @escaping (SnapshotEntry) -> Void) {
    completion(SnapshotEntry(date: .now, snapshot: SnapshotStore.read()))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<SnapshotEntry>) -> Void) {
    let entry = SnapshotEntry(date: .now, snapshot: SnapshotStore.read())
    completion(Timeline(entries: [entry], policy: .never))
  }
}

extension Color {
  /// `#rrggbb` or `#rrggbbaa`, as the app's tokens write colours.
  init(hex: String) {
    var text = hex.trimmingCharacters(in: .whitespaces)
    if text.hasPrefix("#") { text.removeFirst() }
    var value: UInt64 = 0
    Scanner(string: text).scanHexInt64(&value)
    let hasAlpha = text.count == 8
    let r = Double((value >> (hasAlpha ? 24 : 16)) & 0xff) / 255
    let g = Double((value >> (hasAlpha ? 16 : 8)) & 0xff) / 255
    let b = Double((value >> (hasAlpha ? 8 : 0)) & 0xff) / 255
    let a = hasAlpha ? Double(value & 0xff) / 255 : 1
    self.init(.sRGB, red: r, green: g, blue: b, opacity: a)
  }
}

/// A cover the app handed over as base64, or nil when it sent none.
private func coverImage(_ base64: String) -> UIImage? {
  guard !base64.isEmpty, let data = Data(base64Encoded: base64) else { return nil }
  return UIImage(data: data)
}

private let inkPrimary = Color(hex: "#f4f5f9")
private let inkSecond = Color(hex: "#aeb1b9")

// MARK: - Tags

struct TagsView: View {
  let entry: SnapshotEntry

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack {
        Image(systemName: "music.note").foregroundStyle(Color("$accent"))
        Text("self.mp3").font(.system(size: 13, weight: .semibold)).foregroundStyle(inkPrimary)
        Spacer()
        Text("Tap a tag to play it").font(.system(size: 11)).foregroundStyle(inkSecond)
      }
      if let tiles = entry.snapshot?.tiles, !tiles.isEmpty {
        // Always two by two, as P28 draws it: fewer tags leave a slot empty
        // rather than stretching one tile across the widget.
        let slots = Array(tiles.prefix(4)).map { Optional($0) } + Array(repeating: nil, count: max(0, 4 - tiles.count))
        VStack(spacing: 8) {
          ForEach(0..<2, id: \.self) { row in
            HStack(spacing: 8) {
              ForEach(0..<2, id: \.self) { column in
                slot(slots[row * 2 + column])
              }
            }
          }
        }
      } else {
        Spacer()
        Text("Tag a few songs in self.mp3 and they turn up here.")
          .font(.system(size: 13))
          .foregroundStyle(inkSecond)
        Spacer()
      }
    }
    .containerBackground(for: .widget) { Color("$widgetBackground") }
  }
}

extension TagsView {
  @ViewBuilder
  fileprivate func slot(_ tile: Tile?) -> some View {
    if let tile, let url = URL(string: tile.link) {
      Link(destination: url) { TileView(tile: tile) }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    } else {
      Color.clear.frame(maxWidth: .infinity, maxHeight: .infinity)
    }
  }
}

struct TileView: View {
  let tile: Tile

  var body: some View {
    ZStack(alignment: .bottomLeading) {
      RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color(hex: tile.fill))
      if let image = coverImage(tile.cover) {
        Image(uiImage: image)
          .resizable()
          .scaledToFill()
          .frame(width: 30, height: 30)
          .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
          .rotationEffect(.degrees(8))
          .offset(x: 6, y: -6)
          .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
      }
      Text(tile.name)
        .font(.system(size: 15, weight: .semibold, design: .rounded))
        .foregroundStyle(Color(hex: tile.ink))
        .lineLimit(1)
        .padding(10)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
  }
}

struct TagsWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "SelfMp3Tags", provider: SnapshotProvider()) { entry in
      TagsView(entry: entry)
    }
    .configurationDisplayName("Your tags")
    .description("Four of your tags. Tap one to play it.")
    .supportedFamilies([.systemMedium])
  }
}

// MARK: - Now playing

struct NowPlayingView: View {
  let entry: SnapshotEntry

  var body: some View {
    Group {
      if let now = entry.snapshot?.nowPlaying {
        HStack(spacing: 12) {
          cover(now)
          VStack(alignment: .leading, spacing: 2) {
            Text(now.title)
              .font(.system(size: 15, weight: .semibold))
              .foregroundStyle(inkPrimary)
              .lineLimit(1)
            status(now).font(.system(size: 12)).foregroundStyle(inkSecond).lineLimit(1)
          }
          Spacer(minLength: 0)
          ZStack {
            Circle().fill(inkPrimary).frame(width: 40, height: 40)
            Image(systemName: now.playing ? "pause.fill" : "play.fill")
              .font(.system(size: 16, weight: .bold))
              .foregroundStyle(Color(hex: "#0b0d13"))
          }
        }
        .widgetURL(URL(string: now.link))
      } else {
        Text("Nothing playing. Open self.mp3 to start something.")
          .font(.system(size: 13))
          .foregroundStyle(inkSecond)
      }
    }
    .containerBackground(for: .widget) { Color("$widgetBackground") }
  }

  @ViewBuilder
  private func cover(_ now: NowPlaying) -> some View {
    if let image = coverImage(now.cover) {
      Image(uiImage: image)
        .resizable()
        .scaledToFill()
        .frame(width: 52, height: 52)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    } else {
      RoundedRectangle(cornerRadius: 10, style: .continuous)
        .fill(Color(hex: "#1f2330"))
        .frame(width: 52, height: 52)
        .overlay(Image(systemName: "music.note").foregroundStyle(inkSecond))
    }
  }

  /// "Paused · 1:52 left", or, while playing, a countdown the system keeps
  /// itself, so the app does not have to redraw the widget every second.
  @ViewBuilder
  private func status(_ now: NowPlaying) -> some View {
    if now.playing {
      let end = Date(timeIntervalSince1970: now.endsAt)
      if end > .now {
        // One Text: a timer on its own takes all the width it is offered,
        // which pushed "left" to the far edge.
        Text(timerInterval: Date.now...end, countsDown: true) + Text(" left")
      } else {
        Text(now.artist)
      }
    } else {
      let seconds = Int(now.remaining)
      Text("Paused · \(seconds / 60):\(String(format: "%02d", seconds % 60)) left")
    }
  }
}

struct NowPlayingWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "SelfMp3NowPlaying", provider: SnapshotProvider()) { entry in
      NowPlayingView(entry: entry)
    }
    .configurationDisplayName("Now playing")
    .description("What is playing, and how long is left.")
    .supportedFamilies([.systemMedium])
  }
}

@main
struct SelfMp3Widgets: WidgetBundle {
  var body: some Widget {
    TagsWidget()
    NowPlayingWidget()
  }
}
