# Devices, handoff and remote control

Your computer and your phone stop being two separate players. Each open tab announces
itself, and any of them can pick up where another left off, push what it is
playing somewhere else, or drive another one from across the room.

Spotify Connect, except the switchboard is your own server and nothing plays on
it.

**Which is also the limit.** All of this lives on `/api/devices` — the server is
the switchboard, and a bucket cannot be one, so a device whose library is the
bucket's has nowhere to send its heartbeat: `packages/replica/src/routes.ts`
answers the library, the playlists and the edits, and has no `/api/devices` at
all. Every surface now signs in to the bucket, so **none of what follows is
reachable today.** The server's side is built, tested and running; what is
missing is a device that talks to it. The same gap holds Stats and metadata
lookup ([SYNC.md](../SYNC.md), "What this gives up").

---

## What you get

**A devices button in the player bar** (and in the now-playing screen on a
phone). It opens a list of every device that currently has self.mp3 open, and
what each one is playing right now.

**Play here.** Takes the other device's queue and position and continues it on
this one, then pauses the other. You walk in the door, tap once, and the song
carries on out of the speakers mid-bar.

**Play on \<device\>.** The mirror image: pushes this device's queue and
position over there and pauses here. You leave the house, tap once, and it is
in your headphones.

**A "Playing on iPhone" chip** in the player bar when something is playing
somewhere else and nothing is playing here. It is a status, not a prompt —
tapping it opens the popover.

**Remote control.** A switch in the popover, offered when this device is idle
and another one is playing. While it is on, the transport at the bottom of the
screen — play/pause, next, previous, the scrubber, the volume slider — acts on
that device, and the progress bar shows *its* position, extrapolated between
heartbeats so it moves smoothly rather than in ten-second steps.

**Continue where you left off.** Open the app on a device that has nothing
playing, and if another device has a state from the last 24 hours you get one
tap: *Continue — Nocturne Study in E — from iPhone*. It loads the song and the
queue at the right position, **paused**. It never starts playing on its own.

**Settings → Devices** lists everything the server knows about, online or not,
lets you rename this device, and lets you forget a device you are done with.

---

## How it works

### The heartbeat

Every open app or tab has a `deviceId` — generated once and kept on the device
(`ports/device.ts`; `localStorage` in a browser) — and a name guessed from the
user agent (`iPhone · Safari`, `Mac · Chrome`), editable in Settings.

It posts to `POST /api/devices/heartbeat` every 10 seconds, and immediately
whenever the playback state materially changes — a play, a pause, a track
change, a seek. "Materially" is decided by `playbackStateChanged` in
`packages/shared/src/devices.ts` rather than by a hand-maintained list of React
dependencies, so nothing has to remember to fire a beat.

The payload is the whole playback state: song, position, playing, queue, queue
index, shuffle, repeat, volume, and the client's clock.

Heartbeats land in a `devices` table, so a state survives a server restart and a
phone that has been asleep since last night can still be resumed from.

A device counts as **online** if it has been seen in the last 30 seconds
(`DEVICE_ONLINE_MS`). Nothing has to say goodbye — closing a tab is just the
absence of the next beat.

### The event stream

`GET /api/events?deviceId=…` is a Server-Sent Events stream. On connect it sends
a `retry:` hint and replays the current device list and library version, so a
client is correct from its first frame rather than after its first poll.

Three event types travel over it, all as JSON in the `data:` line:

| type | meaning |
|---|---|
| `devices` | the full device list, whenever presence or any state changes |
| `command` | a command addressed to one device |
| `library` | the library version changed; refetch |

SSE rather than WebSockets: it is one-directional (clients already talk back
over plain HTTP), it reconnects by itself, it survives `tailscale serve` and any
proxy without special handling, and it needs no dependency.

Two things had to be arranged for it to actually stream: the compression
middleware skips `/api/events` (a buffered stream is not a stream), and the
service worker never intercepts it (a network-first handler would sit forever
awaiting a response that never completes).

Polling `GET /api/devices` remains the fallback, and switches itself off while
the stream is up.

### Commands

`POST /api/devices/:id/command?from=<senderId>` with a discriminated union:

```
{ type: "play" | "pause" | "toggle" | "next" | "prev" }
{ type: "seek", position }
{ type: "playSong", songId, queueIds?, queueIndex?, position?, play? }
{ type: "setVolume", volume }
{ type: "transfer", fromDeviceId }
```

The server does not interpret them. It looks the device up, forwards the command
down that device's stream, and answers with how many live connections received
it — `404` if there is no such device, `409` if it exists but nothing is
listening.

On the receiving side `apps/app/src/features/devices/DevicesProvider.tsx` is the
only place that turns a command into player calls, as an exhaustive switch.
Adding a variant to the shared schema makes that file stop compiling until it is
handled.

`transfer` is the "take over from that one" primitive: the receiving device
adopts the named device's state and then tells that device to pause. "Play here"
in the UI does the same thing locally, without a round trip.

### Where the code lives

```
packages/shared/src/schemas/devices.ts   the wire contract
packages/shared/src/devices.ts           presence, resume and extrapolation rules

apps/server/src/repositories/devices.ts  the devices table
apps/server/src/services/events.ts       the SSE hub and frame encoder
apps/server/src/services/devices.ts      presence sweep, command forwarding
apps/server/src/routes/devices.ts        /api/devices, /command, /events

packages/client/src/devices/handoff.ts   state → playable queue/index/position
packages/client/src/devices/deviceList.ts   the list as the sheet shows it
packages/client/src/devices/userAgent.ts    a name guessed from the user agent
packages/client/src/devices/translate.ts    song ids across the wire, and what is refused

apps/app/src/ports/device.ts             this device's id and name (+ .web.ts)
apps/app/src/ports/events.ts             the event stream, parsed through the schema
                                         (.web.ts: EventSource; native: an SSE reader)
apps/app/src/features/devices/DevicesProvider.tsx  heartbeats in, events out, commands executed locally
apps/app/src/features/devices/usePresenceServer.ts which server presence talks to, and how hard it looks
apps/app/src/features/devices/DevicesSheet.tsx     the list and its actions
apps/app/src/features/devices/ResumeToast.tsx      "continue from your phone"
apps/app/src/features/settings/SettingsScreen.tsx  the Settings panel
```

The provider sits *inside* `PlayerProvider`, not around it. That is what keeps
the player itself free of any of this: presence reads it through `usePlayer()`,
commands call back into it, and the player never learns that other devices
exist.

---

## When the library is the bucket's

The server is the switchboard, and it is the only thing that can be: plain
storage cannot hold a connection open between two devices. So a device signed
in to the cloud (docs/SYNC.md) still needs the server awake for this one
feature — but it no longer sits it out. It finds the server by the addresses in
the last snapshot, the same way Import and Stats do
(`packages/client/src/connection/reach.ts`), and heartbeats and streams against
whichever address answers. Nothing is typed, and nothing is configured.

**When it is away** the devices sheet draws the same card every other screen
draws (`ServerAway`, `SERVER_NEEDS.devices`) and keeps looking. An empty list
that never fills is indistinguishable from a feature that does not exist.

**How hard it looks** is `usePresenceServer`, and the reasoning is written out
there. In short: looking is the expensive half and holding is the cheap half,
so a device looks only while it is in use — foreground, or playing — once a
minute rather than the twenty seconds a watched screen gets, and not at all
while the stream is up. A stream already open is never dropped for the app
being in the background, because being findable while nobody is looking is the
entire point.

### Whose numbers travel

A heartbeat and a `playSong` both carry song ids, and a cloud library hands out
ids of its own as uids arrive from the bucket. The same song is 47 on a phone,
812 on the server and 3 on a laptop that synced in a different order.

**The wire speaks the server's numbering.** A cloud device translates into it
on the way out and back on the way in
(`packages/client/src/devices/translate.ts`, through the uid table both sides
answer at `/api/cloud/uids`); a device talking to its own server translates
nothing, because its ids already are the server's. Two cloud devices therefore
agree without either knowing the other exists — both pass through the same
third numbering.

**A song that cannot be translated is never guessed at.** This is the rule the
module exists for: a handoff that lands on the wrong song works, plays, and is
wrong, and nobody would ever find out why.

| Case | What happens |
|---|---|
| The song is not in both libraries | The state is blanked: the device is still listed, still marked playing, and the row says it is playing something not in your bucket. The handoff is offered but disabled. |
| A queue entry is not in both | Dropped from the queue that travels. The index moves with it, so a queue holding the same song twice still resumes on the copy it was on. |
| A `playSong` whose song cannot be translated | Refused: nothing is sent, and "play there" does not pause this device either. |
| The two lists have not arrived yet | The same as untranslatable, so nothing goes out until they have. A beat sent in the meantime says "here, playing something I cannot name". |
| `queueIndex` and `songId` disagree | `songId` wins, always — in `handoffTarget` and in the command executor alike. A song the queue does not contain plays alone rather than at whatever sits at that position. |

`translate.test.ts` walks a handoff between three libraries that deliberately
number *different* songs the same, and asserts the uid that comes out the far
end is the uid that went in.

### One thing to set up, for a browser

A phone or the desktop app sends no `Origin`, so nothing stands between them
and the server. The published web app is a browser page on another origin, so
the server has to be told to accept it: `SELFMP3_CORS_ORIGINS` must list the
address the app is served from (`https://<you>.github.io`). Without it presence
fails the same way Stats and the Settings device list already do from a browser
— this adds no new setting, it just adds one more thing that wants the one that
is already there.

---

## Things worth knowing

**Nothing starts playing without you.** The resume offer loads paused. A
`playSong` command does start playing, because someone on another device just
asked for it — but a browser that has never played audio in that tab may still
refuse until you tap once, which is the autoplay policy, not a bug.

**Two tabs on the same machine are two devices.** The id lives in
`localStorage`, so a second tab in the same browser profile shares it and both
tabs will act on a command sent to it. A different browser, or a private window,
is a different device.

**Positions are extrapolated, not simulated.** A remote device reports every ten
seconds; between reports the scrubber advances by the wall clock. If the remote
stalls on a slow network, its reported position corrects the drift on the next
beat.

**A device is forgotten after 30 days** without a heartbeat, swept at startup.
Forgetting one by hand in Settings is immediate — but a device that is still
open re-registers itself within ten seconds.

**No new settings or environment variables.** The feature is always on and costs
one table and one open connection per device. A browser reading the bucket is
the one exception, and it is not a new setting: see `SELFMP3_CORS_ORIGINS`
above.

**A cloud library does not take part — on purpose.** Import, Stats and the
metadata lookup all reach the server by the addresses in its last snapshot when
a device is signed in to the cloud, and presence could in principle do the same.
It is deliberately left out, because it is a different shape of thing: those
screens ask a question and are done, while presence is a heartbeat every ten
seconds and a stream held open for as long as the app runs — so the server would
have to be found at launch rather than on a screen, and found again every time a
phone changes network. And a handoff carries song ids, which the reached server
numbers its own way: every command would need translating out and back
(`useServerSongIds`), including between two cloud devices, which number the same
songs differently again. Worth doing, and its own piece of work.

What does already work from a cloud library is **Settings › Devices**: the list
comes through the reached server, because a list is only a question. With no
server in reach it shows the last list it was given, each row marked offline.
