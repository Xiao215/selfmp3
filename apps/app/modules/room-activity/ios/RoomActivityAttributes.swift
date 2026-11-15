import ActivityKit
import Foundation

// The room as a Live Activity: its shape, the same in the app (modules/room-activity)
// and in the widget target that draws it (targets/widget). ActivityKit matches the
// two by this type, so the two files are kept identical, which
// src/features/room/roomActivity.test.ts checks. The values are written by
// apps/app/src/features/room/roomActivity.model.ts.

public struct RoomActivityAttributes: ActivityAttributes {
  public struct Face: Codable, Hashable {
    public var letter: String
    public var fill: String
    public var ink: String
  }

  public struct ContentState: Codable, Hashable {
    public var title: String
    public var artist: String
    /// "Mia added it"; empty with nothing playing.
    public var by: String
    public var playing: Bool
    /// When the song's first second played, in seconds since 1970, on the phone's clock.
    public var startedAt: Double
    /// Seconds; 0 when it is not known.
    public var duration: Double
    /// Seconds in, while paused.
    public var position: Double
    /// How many are in the room.
    public var here: Int
    public var faces: [Face]
    /// The cover's colour, for a song with no picture here.
    public var tone: String
    /// A line in place of the song's: reconnecting, nothing playing.
    public var status: String
    /// The cover, made small, as a file in the App Group; empty for none.
    public var cover: String
  }

  public var code: String
  /// "Xiao's room".
  public var title: String
  /// "KQ7 482".
  public var codeLine: String
}
