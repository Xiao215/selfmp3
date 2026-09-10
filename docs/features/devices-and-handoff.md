# Devices, handoff and remote control

Your Mac and your phone stop being two separate players. Each open tab announces
itself, and any of them can pick up where another left off, push what it is
playing somewhere else, or drive another one from across the room.

Spotify Connect, except the switchboard is your own server and nothing plays on
it.

---

## What you get

**A devices button in the player bar** (and in the now-playing screen on a
phone). It opens a list of every browser that currently has self.mp3 open, and
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

Every open tab has a `deviceId` — generated once and kept in `localStorage` —
and a name guessed from the user agent (`iPhone · Safari`, `Mac · Chrome`),
editable in Settings.

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

On the receiving side `apps/web/src/devices/useRemoteCommands.ts` is the only
place that turns a command into player calls, as an exhaustive switch. Adding a
variant to the shared schema makes that file stop compiling until it is handled.

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

apps/web/src/lib/device.ts               this device's id and name
apps/web/src/devices/DevicesProvider.tsx heartbeats in, events out
apps/web/src/devices/useServerEvents.ts  EventSource, parsed through the schema
apps/web/src/devices/useRemoteCommands.ts executing a command locally
apps/web/src/devices/useTransport.ts     local player or remote device
apps/web/src/devices/handoff.ts          state → playable queue/index/position
apps/web/src/devices/DevicesButton.tsx   the button, the chip
apps/web/src/devices/DevicesPopover.tsx  the list and its actions
apps/web/src/devices/ResumeToast.tsx     "continue from your phone"
apps/web/src/devices/DevicesSettings.tsx the Settings panel
```

The provider sits *inside* `PlayerProvider`, not around it. That is what keeps
the player itself free of any of this: presence reads it through `usePlayer()`,
commands call back into it, and the player never learns that other devices
exist.

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
one table and one open connection per device.
