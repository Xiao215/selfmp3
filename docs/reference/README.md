# The reference set

The old web app, photographed before it is deleted.

`docs/UNIVERSAL.md` — *The reference set* — asks for this: every screen of the
new universal app is checked against these images, at **1280** for the desktop
layout and **375** for the phone layout, and phase 5 deletes `apps/web`, so
after that these are the only record of what the app looked like.

```
docs/reference/<short-sha>/desktop/<state>.png     1280 × 900
docs/reference/<short-sha>/phone/<state>.png        375 × 812
```

The sha is the commit the old app was captured from. The current set is
`fb882e0`.

## Reproducing it

```bash
npm run dev                    # server 4600, web 4601
npm run verify:reference       # both widths
```

It is a script — `verify/reference.spec.ts` — rather than a session with a
screenshot key, so it can be re-run when something needs recapturing. The
library it photographs is the thirteen-song dev library, with the playlists and
second tag that `verify/reference/seed.ts` adds, because half the states in the
plan's table (a smart playlist with its rules open, an empty playlist, one tag
filtered and another excluded) cannot exist without them. Seeding is idempotent
and everything it creates is named `Reference — …`.

Three things are held fixed so that the two widths differ by layout and nothing
else: the same song plays in every state that has one (アイドル), the accent is
pinned for the run and put back afterwards (it is a *server* setting, so the
capture that demonstrates changing it would otherwise recolour everything taken
after it), and the pointer is parked where it reveals nothing before each shot
(rows show their controls on hover, and dismissing the resume toast leaves the
pointer sitting on the bottom row).

## What is here

| Screen | States |
|---|---|
| Library | at rest · search · one tag filtered and one excluded · sort open · selection with two rows · a row's ⋯ menu · a song playing |
| Playlists | list · empty |
| Playlist detail | manual · smart with its rules open · empty |
| Now playing | stage (desktop) / art (phone) · lyrics · romanisation on · up next · about (desktop) · focus (desktop) · nothing playing |
| Player bar / mini player | playing · paused · progress at ~40% |
| Settings | top · bottom · accent changed · light theme |
| Import | at rest (the queue) · a link's review, fetched and not imported |
| Migrate a playlist | at rest · two songs' matches, found and not imported |
| Stats | top · bottom (last 30 days) |
| Wrapped | top · bottom (last 30 days) |
| Practice | the side panel, opened from the player bar (desktop) |
| Fix metadata | a song's suggestions and changes, looked up and not applied (desktop) |
| Tag inbox | the list · one song's tagging, with one song untagged for the capture |
| Devices | popover · resume toast |
| Sheets and popovers | sleep timer · speed (desktop) · practice (phone) |

Import, Migrate, Stats, Wrapped, Practice, Fix metadata and the tag inbox were added in phase 5, from the same app: the one commit to `apps/web`
after `fb882e0` (2df5771) touched devices and nothing the Import screen draws.
Their reviews need yt-dlp on the server and YouTube to answer; the songs are ones
the dev library already has, and the captures back out rather than import.
Stats and Wrapped show what has been played on this server, so their numbers are
those of the day they were taken (2026-09-13).

Where the two widths carry the same thing under different names, the name here
is the one that describes what was captured: the phone has no About tab (the
song's details are on the art face) and no speed sheet (speed lives inside
Practice), and the desktop has no separate art face because Stage shows the
cover beside the words.

## What is missing, and why

Four rows of the plan's table are not here. None of them is an oversight.

- **Sign-in and onboarding** (idle · waiting · code entry). These only appear in
  the cloud build — `VITE_CLOUD=1`, a different bundle from the one the dev
  server serves — and reaching "waiting" and "code entry" means signing in to
  Google. The runbook lists credentials as a stop-and-ask, so they are left for
  Xiao. Everything else on the list is captured.
- **The remote device chip** on the player bar. It shows when this device is
  driving another one, which needs a second device actually playing; a script
  on one machine cannot produce it honestly. The devices popover and the resume
  toast, which are the rest of that row, are both captured.
- **Volume (compact)**. There is no such surface to photograph: the desktop
  player bar has an inline slider rather than a popover, and the phone has no
  volume control at all, because a phone's volume is its own.
- **A genuinely empty Playlists screen.** `playlists-empty` is captured by
  removing the three seeded playlists and putting them straight back. It only
  ever removes those three, so on a library with playlists of its own the image
  would honestly not be empty.

## Using them

The plan's check 2 is a review, not a pixel diff — fonts render differently
under `react-native-web` and a diff would fail on every run. What has to match
is layout and order, touch-target sizes, colours, type weights, which controls
are visible at rest versus on hover, and what a long title does. A screen
passes when someone who knows the old app cannot tell which is which.
