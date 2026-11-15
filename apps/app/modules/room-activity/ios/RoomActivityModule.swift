import ActivityKit
import ExpoModulesCore
import UIKit

/// The room on the Lock Screen and in the Dynamic Island (src/ports/roomActivity.ts).
///
/// One activity at a time, for the room this iPhone is in: shown again with
/// the same room's code it is updated, with another room's it replaces the
/// old one. The app runs while a room plays (background audio), so it is the
/// app that updates it; no push is involved.
public class RoomActivityModule: Module {
  public func definition() -> ModuleDefinition {
    Name("RoomActivity")

    Function("enabled") { () -> Bool in
      if #available(iOS 16.2, *) {
        return ActivityAuthorizationInfo().areActivitiesEnabled
      }
      return false
    }

    AsyncFunction("show") { (head: String, state: String, cover: String?) async throws in
      if #available(iOS 16.2, *) {
        try await RoomActivities.show(head: head, state: state, cover: cover)
      }
    }

    AsyncFunction("end") { () async in
      if #available(iOS 16.2, *) {
        await RoomActivities.end()
      }
    }
  }
}

@available(iOS 16.2, *)
enum RoomActivities {
  static func show(head: String, state: String, cover: String?) async throws {
    let attributes = try JSONDecoder().decode(RoomActivityAttributes.self, from: Data(head.utf8))
    // The state as the app wrote it, with the cover's file put in: only this
    // side can write into the App Group's folder.
    var fields = (try JSONSerialization.jsonObject(with: Data(state.utf8)) as? [String: Any]) ?? [:]
    fields["cover"] = RoomCover.keep(cover) ?? ""
    let content = try JSONDecoder().decode(
      RoomActivityAttributes.ContentState.self,
      from: JSONSerialization.data(withJSONObject: fields)
    )
    let shown = ActivityContent(state: content, staleDate: nil)

    let running = Activity<RoomActivityAttributes>.activities
    let same = running.first {
      $0.attributes.code == attributes.code && $0.activityState == .active
    }
    for other in running where other.id != same?.id {
      await other.end(nil, dismissalPolicy: .immediate)
    }
    if let same {
      await same.update(shown)
    } else {
      _ = try Activity.request(attributes: attributes, content: shown, pushType: nil)
    }
  }

  static func end() async {
    for activity in Activity<RoomActivityAttributes>.activities {
      await activity.end(nil, dismissalPolicy: .immediate)
    }
    RoomCover.clear(keeping: nil)
  }
}

/// The playing song's cover, made small enough for the Lock Screen and left
/// in the App Group for the widget target to read. The app's own copy is 640
/// points; a Live Activity draws it at 52, and its process may not hold much.
enum RoomCover {
  static let group = "group.com.selfmp3.app"
  static let prefix = "room-cover-"
  static let side: CGFloat = 156

  static var folder: URL? {
    FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group)
  }

  /// The small copy's file name, made once per cover; nil when there is none to make.
  static func keep(_ source: String?) -> String? {
    guard let source, let url = URL(string: source), url.isFileURL, let folder else {
      clear(keeping: nil)
      return nil
    }
    let name = prefix + url.deletingPathExtension().lastPathComponent + ".jpg"
    let target = folder.appendingPathComponent(name)
    if FileManager.default.fileExists(atPath: target.path) { return name }
    guard let image = UIImage(contentsOfFile: url.path), let data = small(image) else {
      return nil
    }
    do {
      try data.write(to: target, options: .atomic)
    } catch {
      return nil
    }
    clear(keeping: name)
    return name
  }

  /// The cover filled into a square, as the app draws covers.
  static func small(_ image: UIImage) -> Data? {
    let size = CGSize(width: side, height: side)
    let scale = max(side / image.size.width, side / image.size.height)
    let drawn = CGSize(width: image.size.width * scale, height: image.size.height * scale)
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    let made = UIGraphicsImageRenderer(size: size, format: format).image { _ in
      image.draw(
        in: CGRect(
          x: (side - drawn.width) / 2, y: (side - drawn.height) / 2,
          width: drawn.width, height: drawn.height))
    }
    return made.jpegData(compressionQuality: 0.85)
  }

  /// Every earlier song's copy goes: the Lock Screen only ever draws one.
  static func clear(keeping name: String?) {
    guard let folder,
      let names = try? FileManager.default.contentsOfDirectory(atPath: folder.path)
    else { return }
    for each in names where each.hasPrefix(prefix) && each != name {
      try? FileManager.default.removeItem(at: folder.appendingPathComponent(each))
    }
  }
}
