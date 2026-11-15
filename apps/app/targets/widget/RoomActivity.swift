import ActivityKit
import SwiftUI
import WidgetKit

// The room on the Lock Screen and in the Dynamic Island: who is in it, and what
// is playing (docs/features/listen-together.md, "On the Lock Screen"). The app
// starts and updates it (modules/room-activity); this only draws what it was
// handed. The bar moves by itself from `startedAt`, so the app sends nothing
// while a song simply plays.

private let appGroup = "group.com.selfmp3.app"
private let roomLink = URL(string: "selfmp3://room")

private let ink = Color("inkPrimary")
private let inkSoft = Color("inkSecondary")
private let accent = Color("$accent")

/// "#RRGGBB" as a colour, or the app's raised grey for anything else.
private func hex(_ value: String) -> Color {
  var text = value.trimmingCharacters(in: .whitespaces)
  if text.hasPrefix("#") { text.removeFirst() }
  guard text.count == 6, let number = UInt32(text, radix: 16) else { return Color("raised") }
  return Color(
    red: Double((number >> 16) & 0xFF) / 255,
    green: Double((number >> 8) & 0xFF) / 255,
    blue: Double(number & 0xFF) / 255)
}

/// The cover the app left in the App Group, made small; nil when there is none.
private func roomCover(_ name: String) -> UIImage? {
  guard !name.isEmpty,
    let folder = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup)
  else { return nil }
  return UIImage(contentsOfFile: folder.appendingPathComponent(name).path)
}

struct RoomCoverView: View {
  let state: RoomActivityAttributes.ContentState
  let size: CGFloat

  var body: some View {
    Group {
      if let image = roomCover(state.cover) {
        Image(uiImage: image).resizable().scaledToFill()
      } else {
        hex(state.tone)
          .overlay(
            Image(systemName: "music.note")
              .font(.system(size: size * 0.4, weight: .semibold))
              .foregroundStyle(.white.opacity(0.7)))
      }
    }
    .frame(width: size, height: size)
    .clipShape(RoundedRectangle(cornerRadius: size * 0.2, style: .continuous))
  }
}

/// The room's faces, overlapping as the room's sheet stacks them.
struct RoomFaces: View {
  let faces: [RoomActivityAttributes.Face]
  let size: CGFloat

  var body: some View {
    HStack(spacing: -size * 0.18) {
      ForEach(Array(faces.enumerated()), id: \.offset) { _, face in
        Text(face.letter)
          .font(.system(size: size * 0.46, weight: .bold))
          .foregroundStyle(hex(face.ink))
          .frame(width: size, height: size)
          .background(Circle().fill(hex(face.fill)))
          .overlay(Circle().stroke(Color("$widgetBackground"), lineWidth: 2))
      }
    }
  }
}

/// How far into the song: moving by itself while it plays, standing while paused.
struct RoomProgress: View {
  let state: RoomActivityAttributes.ContentState

  var body: some View {
    if state.duration > 0 {
      let start = Date(timeIntervalSince1970: state.startedAt)
      let end = start.addingTimeInterval(state.duration)
      Group {
        if state.playing && end > .now && start <= .now {
          ProgressView(timerInterval: start...end, countsDown: false) {
            EmptyView()
          } currentValueLabel: {
            EmptyView()
          }
        } else {
          ProgressView(value: min(state.position, state.duration), total: state.duration)
        }
      }
      .progressViewStyle(.linear)
      .tint(accent)
    }
  }
}

/// The song's second line: the room's news, or the artist and who added it.
private func detail(_ state: RoomActivityAttributes.ContentState) -> String {
  if !state.status.isEmpty { return state.status }
  return [state.artist, state.by].filter { !$0.isEmpty }.joined(separator: " · ")
}

struct RoomLockScreenView: View {
  let context: ActivityViewContext<RoomActivityAttributes>

  var body: some View {
    let state = context.state
    VStack(alignment: .leading, spacing: 10) {
      HStack(spacing: 12) {
        RoomCoverView(state: state, size: 56)
        VStack(alignment: .leading, spacing: 2) {
          HStack(spacing: 5) {
            Image(systemName: "person.2.fill").font(.system(size: 10, weight: .semibold))
            Text("\(context.attributes.title) · \(context.attributes.codeLine)")
          }
          .font(.system(size: 12, weight: .semibold))
          .foregroundStyle(accent)
          .lineLimit(1)
          Text(state.title)
            .font(.system(size: 16, weight: .semibold))
            .foregroundStyle(ink)
            .lineLimit(1)
          Text(detail(state))
            .font(.system(size: 13))
            .foregroundStyle(inkSoft)
            .lineLimit(1)
        }
        Spacer(minLength: 0)
        VStack(alignment: .trailing, spacing: 4) {
          RoomFaces(faces: state.faces, size: 26)
          Text("\(state.here) here")
            .font(.system(size: 11, weight: .medium))
            .foregroundStyle(inkSoft)
        }
      }
      RoomProgress(state: state)
    }
    .padding(16)
    .activityBackgroundTint(Color("$widgetBackground"))
    .activitySystemActionForegroundColor(ink)
    .widgetURL(roomLink)
  }
}

struct RoomActivityWidget: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: RoomActivityAttributes.self) { context in
      RoomLockScreenView(context: context)
    } dynamicIsland: { context in
      let state = context.state
      return DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          RoomCoverView(state: state, size: 52).padding(.leading, 4)
        }
        DynamicIslandExpandedRegion(.trailing) {
          VStack(alignment: .trailing, spacing: 4) {
            RoomFaces(faces: state.faces, size: 24)
            Text("\(state.here) here")
              .font(.system(size: 11, weight: .medium))
              .foregroundStyle(inkSoft)
          }
          .padding(.trailing, 4)
        }
        DynamicIslandExpandedRegion(.center) {
          VStack(alignment: .leading, spacing: 2) {
            Text(state.title)
              .font(.system(size: 15, weight: .semibold))
              .foregroundStyle(ink)
              .lineLimit(1)
            Text(detail(state))
              .font(.system(size: 12))
              .foregroundStyle(inkSoft)
              .lineLimit(1)
          }
          .frame(maxWidth: .infinity, alignment: .leading)
        }
        DynamicIslandExpandedRegion(.bottom) {
          VStack(alignment: .leading, spacing: 6) {
            RoomProgress(state: state)
            HStack(spacing: 5) {
              Image(systemName: "person.2.fill").font(.system(size: 10, weight: .semibold))
              Text("\(context.attributes.title) · \(context.attributes.codeLine)")
            }
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(accent)
            .lineLimit(1)
          }
          .padding(.horizontal, 4)
        }
      } compactLeading: {
        RoomCoverView(state: state, size: 22)
      } compactTrailing: {
        HStack(spacing: 3) {
          Image(systemName: "person.2.fill").font(.system(size: 10, weight: .semibold))
          Text("\(state.here)").font(.system(size: 13, weight: .semibold))
        }
        .foregroundStyle(accent)
      } minimal: {
        Image(systemName: "person.2.fill")
          .font(.system(size: 11, weight: .semibold))
          .foregroundStyle(accent)
      }
      .widgetURL(roomLink)
      .keylineTint(accent)
    }
  }
}
