# Home-screen widget

Two iOS widgets (docs/ui-mock `P28`), both medium:

- **Your tags** — Home's first four tags as tiles in their own colours, each with a small
  cover when one is small enough to hand over. Tapping a tile opens the app on that tag and
  plays it (`selfmp3://tag/<name>?play=1`).
- **Now playing** — the song, and "Paused · 1:52 left" or a countdown the system keeps by
  itself while it plays. Tapping it opens Now Playing (`selfmp3://now-playing`).

Android and the web have none (iOS first, as the plan says).

## How it works

The widget is SwiftUI in its own process and can ask the app nothing. The app hands it a
snapshot — plain JSON, colours as hex, times as seconds — through the App Group
`group.com.selfmp3.app`, then asks the system to redraw.

| What | Where |
|---|---|
| The snapshot's shape, and when a new one is worth sending | `apps/app/src/features/widget/widget.model.ts` (+ test) |
| Keeping it in step with the library and the player | `apps/app/src/features/widget/WidgetSync.tsx`, mounted once in `app/_layout.tsx` |
| Writing it to the App Group | `apps/app/src/ports/widget.ios.ts` (`@bacons/apple-targets`' `ExtensionStorage`); `widget.ts` does nothing elsewhere |
| The widgets | `apps/app/targets/widget/SelfMp3Widget.swift`, target settings in `expo-target.config.js` |
| Playing a tag from a link | `apps/app/src/features/tag/TagScreen.tsx` (`?play=1`, once) |

A new snapshot is sent only when it has news — another song, play or pause, a seek, other
tiles — because the system rations how often an app may reload its widgets, and the
countdown needs none. Covers are kept at 640 points, so one goes along only when its file is
under 120 KB; otherwise the tile is drawn in its colours alone.

## Building it

`expo prebuild` makes the `SelfMp3Widget` target from `targets/widget` (the plugin is
`@bacons/apple-targets` in `app.config.js`). The widget target builds on its own for the
simulator without signing. A signed build needs, once:

1. `ios.appleTeamId` in `app.config.js` (the plugin warns without it).
2. The App Group `group.com.selfmp3.app` registered in the Apple Developer account and
   enabled for both `com.selfmp3.app` and `com.selfmp3.app.widget`.
3. A new dev client: the widget is part of the app bundle, so a build made before this has
   none.

Not built: a play button that plays without opening the app. That needs an App Intent
running in the app's process (iOS 17's `AudioPlaybackIntent`) wired to the player; the tap
opens the app instead.
