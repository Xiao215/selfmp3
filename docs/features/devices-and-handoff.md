# Devices and handoff

Your computer and your phone stop being two separate players. Each open app announces
itself, and any of them can pick up where another left off, or push what it is playing
somewhere else.

Spotify Connect, except the switchboard is your own server and nothing plays on it. A bucket
cannot be a switchboard — plain storage cannot hold a connection open between two devices —
so this is the one part of the app that needs the server reachable even to work at all
([SYNC.md](../SYNC.md), "Presence from a cloud library"). Every device finds the server the
way Import and Stats do, by the addresses in the library's last snapshot, and holds presence
against whichever answers.

Listening with friends is a different thing, built on the doorman rather than the server:
see [listen-together.md](listen-together.md).

---

## What you get

**Devices**, in the player bar on a computer and in the ⋯ menu of Now Playing on a phone. It
opens a list of every other device that has self.mp3 open right now, and what each one is
playing or when it was last seen.

**Play here** (the device's own row). Takes the other device's queue and position and
continues it on this one, then pauses the other. You walk in the door, tap once, and the song
carries on out of the speakers mid-bar.

**Play there instead.** The mirror image: pushes this device's queue and position over there
and pauses here. You leave the house, tap once, and it is in your headphones.

**Continue where you left off.** Open the app on a device that has nothing playing, and if
another device has a state from the last 24 hours you get one offer: *Continue — Nocturne
Study in E — from iPhone*. It loads the song and the queue at the right position, **paused**,
and goes by itself after twelve seconds or as soon as anything plays here. It never starts
playing on its own.

**Settings › Devices** lists everything the server knows about, online or not, lets you
rename this device, and lets you forget a device you are done with. With the server out of
reach it shows the last list it was given, each row marked offline.

There is no remote control: one device cannot play, skip or seek another without moving the
music over, and nothing shows a "Playing on iPhone" chip. The wire carries only the two
commands a handoff needs.

---

## How it works

### The heartbeat

Every app or tab has a `deviceId` — generated once and kept on the device (`ports/device.ts`;
`localStorage` in a browser) — and a name guessed from the user agent (`iPhone · Safari`,
`Mac · Chrome`), editable in Settings.

It posts to `POST /api/devices/heartbeat` every 10 seconds (`DEVICE_HEARTBEAT_MS`), and
immediately whenever the playback state materially changes — a play, a pause, a track change,
a seek. "Materially" is decided by `playbackStateChanged` in `packages/shared/src/devices.ts`
rather than by a hand-maintained list of React dependencies, so nothing has to remember to fire
a beat.

The payload is the whole playback state: song, position, playing, queue, queue index,
shuffle, repeat, and the client's clock (`updatedAt`, which only that same device's later
states are compared with). The state is captured as the beat is sent, and the server stamps
the row's `lastSeenAt` with *its* clock when the beat arrives.

Heartbeats land in a `devices` table in the account's workspace on the server, so a state
survives a server restart and a phone that has been asleep since last night can still be
resumed from. It is one of the things a workspace forgets harmlessly if its folder is deleted
([shared-server.md](shared-server.md)).

A device counts as **online** if it has been seen in the last 30 seconds
(`DEVICE_ONLINE_MS`). Nothing has to say goodbye — closing a tab is just the absence of the
next beat.

### The event stream

`GET /api/events?deviceId=…` is a Server-Sent Events stream. On connect it sends a `retry:`
hint and replays the current device list and library version, so a client is correct from its
first frame rather than after its first poll.

Three event types travel over it, all as JSON in the `data:` line:

| type | meaning |
|---|---|
| `devices` | the full device list, whenever presence or any state changes |
| `command` | a handoff command addressed to one device |
| `library` | the server's library version changed |

SSE rather than WebSockets: it is one-directional (clients already talk back over plain
HTTP), it reconnects by itself, it survives Tailscale Funnel and any proxy without special
handling, and it needs no dependency. The compression middleware skips `/api/events`, since a
buffered stream is not a stream.

Polling `GET /api/devices` (every 15 seconds) is the fallback, and switches itself off while
the stream is up.

### Commands

`POST /api/devices/:id/command` with one of the two commands a handoff sends:

```
{ type: "playSong", songId, queueIds?, queueIndex?, position? }
{ type: "pause" }
```

"Play there instead" sends `playSong`, and the device it lands on starts playing that queue
at that position. "Play here" plays the other device's state locally and sends it `pause`.
Anything else is refused with a `400`.

The server does not interpret them. It looks the device up, forwards the command down that
device's stream, and answers with how many live connections received it — `404` if there is
no such device, `409` if it exists but nothing is listening.

On the receiving side `apps/app/src/features/devices/DevicesProvider.tsx` is the only place
that turns a command into player calls, as an exhaustive switch. Adding a variant to the
shared schema makes that file stop compiling until it is handled.

### Finding the server

`usePresenceServer` decides how hard to look. Looking is the expensive half — a connection
opened to every address the server named at once — and holding is the cheap half, one idle
socket and a beat every ten seconds. So a device looks only while it is in use (foreground, or
playing), once a minute (`PRESENCE_LOOK_AGAIN_MS`) rather than the twenty seconds a screen
gets, and not at all while the stream is up. A stream already open is never dropped for the
app being in the background, because being findable while nobody is looking is the entire
point.

**When it is away** the Devices sheet draws the same card every other screen draws
(`ServerAway`, `SERVER_NEEDS.devices`) and keeps looking. An empty list that never fills is
indistinguishable from a feature that does not exist.

### Whose numbers travel

A heartbeat and a `playSong` both carry song ids, and each device numbers the library's
songs its own way as uids arrive from the bucket. The same song is 47 on a phone, 812 on the
server and 3 on a laptop that synced in a different order.

**The wire speaks the server's numbering.** A device translates into it on the way out and
back on the way in (`packages/client/src/devices/translate.ts`, through the uid table both
sides answer at `/api/cloud/uids`). Two devices therefore agree without either knowing the
other exists — both pass through the same third numbering.

**A song that cannot be translated is never guessed at.** This is the rule the module exists
for: a handoff that lands on the wrong song works, plays, and is wrong, and nobody would ever
find out why.

| Case | What happens |
|---|---|
| The song is not in both libraries | The state is blanked: the device is still listed, and its row says it is playing something not in your storage. Play here is disabled. |
| A queue entry is not in both | Dropped from the queue that travels. The index moves with it, so a queue holding the same song twice still resumes on the copy it was on. |
| A `playSong` whose song cannot be translated | Refused: nothing is sent, and "play there" does not pause this device either. The sheet says this song isn't in your storage yet. |
| The two lists have not arrived yet | The same as untranslatable, so nothing goes out until they have. A beat sent in the meantime says "here, playing something I cannot name". |
| `queueIndex` and `songId` disagree | `songId` wins, always — in `handoffTarget` and in the command executor alike. A song the queue does not contain plays alone rather than at whatever sits at that position. |

`translate.test.ts` walks a handoff between three libraries that deliberately number
*different* songs the same, and asserts the uid that comes out the far end is the uid that
went in.

### Where the code lives

```
packages/shared/src/schemas/devices.ts   the wire contract
packages/shared/src/devices.ts           presence, resume and extrapolation rules

apps/server/src/repositories/devices.ts  the devices table
apps/server/src/services/events.ts       the SSE hub and frame encoder
apps/server/src/services/devices.ts      presence sweep, command forwarding, forgetting
apps/server/src/routes/devices.ts        /api/devices, /command, /events

packages/client/src/devices/handoff.ts      state → playable queue/index/position
packages/client/src/devices/deviceList.ts   the list as the sheet shows it
packages/client/src/devices/userAgent.ts    a name guessed from the user agent
packages/client/src/devices/translate.ts    song ids across the wire, and what is refused

apps/app/src/ports/device.ts             this device's id and name (+ .web.ts)
apps/app/src/ports/events.ts             the event stream, parsed through the schema
                                         (.web.ts: EventSource; native: an SSE reader)
apps/app/src/features/devices/DevicesProvider.tsx  heartbeats out, events in, commands executed locally
apps/app/src/features/devices/usePresenceServer.ts which server presence talks to, and how hard it looks
apps/app/src/features/devices/DevicesSheet.tsx     the list and its actions
apps/app/src/features/devices/ResumeToast.tsx      "continue from your phone"
apps/app/src/features/settings/DevicesPanel.tsx    the Settings panel
```

The provider sits *inside* `PlayerProvider`, not around it. That is what keeps the player
itself free of any of this: presence reads it through `usePlayer()`, commands call back into
it, and the player never learns that other devices exist.

---

## Things worth knowing

**Nothing starts playing without you.** The resume offer loads paused. A `playSong` command
does start playing, because someone on another device just asked for it — but a browser that
has never played audio in that tab may still refuse until you tap once, which is the autoplay
policy, not a bug.

**Two tabs on the same machine are two devices only in different browsers.** The id lives in
`localStorage`, so a second tab in the same browser profile shares it and both tabs will act
on a command sent to it. A different browser, or a private window, is a different device.

**Positions are extrapolated, not simulated.** Another device reports every ten seconds;
between reports its position advances by the wall clock, so "Play here" starts where it is now
rather than where it was at its last beat. The time since is measured without ever comparing
two devices' clocks, which are routinely seconds or minutes apart: the server's half is
`list.now − lastSeenAt` (both the server's clock, from the devices list), and this device's
half is the time since that list arrived (both this device's clock, React Query's
`dataUpdatedAt`). `heardAt` and `handoffTarget` in `packages/client/src/devices/handoff.ts`
do the sum; the resume offer judges a state's age on the server's clock the same way
(`serverTime`).

**A device is forgotten after a week** without a heartbeat, checked at startup and every hour.
Removing one by hand in Settings is immediate — but a device that is still open re-registers
itself within ten seconds.

**Nothing to set up.** The published web app is allowed to call the server because the server
has a public address: with `SELFMP3_PUBLIC_URL` set, the server accepts the app's origin
(`SELFMP3_APP_URL`) by itself (`allowedOrigins` in `apps/server/src/http/middleware.ts`). The
phone and the desktop app send no website origin, so nothing stands between them and the
server.
