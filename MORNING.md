# Good morning

Everything below was built overnight, on top of the self.mp3 v2 code that was sitting in
`selfmp3/`. It is now the project root. The old `hum` v1 app has been moved aside (see
**What I moved** at the bottom).

**Start here:**

```bash
npm install          # new dependencies were added
npm run build
npm start            # http://localhost:4600
```

`npm run check` (typecheck + lint + 477 tests) and `npm run build` both pass.

---

## The name and the logo

The app is still **self.mp3** — you decided to keep it. It now has the 音符 logo you asked
for: a beamed pair of eighth notes in the accent purple, on the dark rounded square.
`apps/web/public/icons/icon.svg` is the source; the 192/512/maskable/180 PNGs are generated
from it. The same mark sits next to the wordmark in the sidebar.

---

## What is new

Every feature has a page in **`docs/features/`**. In rough order of how much you will
notice it:

**Getting music in.** Share a song from the YouTube Music app on your phone and it queues on
the Mac — a share target on Android, a one-step Shortcut on iOS (recipe in
`docs/features/share-to-import.md`). The library folder is watched, so dragging files into
Finder is enough — no rescan. Your own YouTube account works without the app ever seeing a
password: yt-dlp borrows the login cookies from your browser, which makes Liked Music and
private playlists importable (Settings → Importing). And playlists from Spotify or Apple
Music come in through a paste box — a link, a CSV export, or just a list of song names —
where each track is matched to a YouTube upload, scored, and shown to you with alternatives
before anything downloads.

**Lyrics.** Chinese lyrics can show pinyin underneath and Japanese romaji, computed locally,
no key needed. Translation is there too but needs an API key of your own (Settings →
Lyrics). Songs with no timings can be synced by tapping along to the music, which writes a
proper `.lrc` next to the audio. And you can now find a song by a line you remember — lyrics
are indexed and searchable from ⌘K.

**It listens to your music.** Every song is analysed locally for tempo, key, energy and
loudness. That gives you BPM/key rules in smart playlists, a "similar songs" pick in the
song menu, and an auto-mix mode that reorders the queue into a smooth path and picks each
crossfade length to suit the transition.

**Your devices know about each other.** The Mac and the phone see what the other is playing.
Hand a track over mid-song in either direction, use the phone as a remote for the Mac, or
open the app and get a "continue from your iPhone" prompt.

**Practice.** A–B loop, speed changes that keep the pitch, transpose readout. Press `P`.

**Wrapped, whenever.** `/stats/wrapped` — any range, not just December — with a
share-as-image button that exports a 1080×1080 card. Plus "forgotten gems", which resurfaces
songs you loved and stopped playing.

**Metadata.** Look a song up on iTunes or MusicBrainz and apply only the fields you want;
fill in missing cover art across the whole library in one pass.

**Install and ops.** `./scripts/setup-mac.sh` does the whole setup including starting at
login. `./scripts/doctor.sh` tells you what is wrong. There is a `selfmp3` CLI
(`scan`, `import`, `backup`, `doctor`), a Dockerfile for putting it on a VPS or NAS later,
and `scripts/migrate-from-hum.mjs` for pulling anything out of the old v1 database.

**The native app.** `apps/mobile` is a complete Expo app — library, playlists, now playing
with synced lyrics, offline downloads, CarPlay templates and Android Auto. See the honest
caveat below.

---

## What you should check yourself

I was thorough about verifying, but three things could not be verified from here and you
should not assume they work until you try them:

**1. The native app has never been compiled.** No screen has ever rendered. It typechecks
against the real React Native and Expo type definitions and `expo prebuild` produces the
right native project, but that is not the same as building. The main risk is
`react-native-track-player` — the only version with the background-audio API we need is a
`5.0.0-alpha0`, because the stable release does not support React Native's new architecture.
Run `npx expo run:ios` and expect to spend a little time here. `docs/MOBILE.md` lists
everything unverified.

**2. Anything that talks to YouTube, Spotify, iTunes or MusicBrainz.** This sandbox blocks
outbound connections to all of them, so the import, migration and metadata-lookup code paths
were exercised against local stand-ins rather than the real services. The logic is tested;
the live round trip is not. Import one song as your first move and watch it land.

**3. The Docker image was never built** — Docker Hub is blocked here too. The Dockerfile's
logic was simulated on the filesystem (the runtime stage boots and serves), but the base
image and the `apk add ffmpeg yt-dlp tini` line are unconfirmed.

Also worth knowing: **CarPlay needs an entitlement from Apple** that you have to apply for,
and it takes weeks. Worth starting now if you want it — the app runs fine without it in the
meantime. `docs/MOBILE.md` has the link.

---

## Two bugs fixed along the way

Both were in the code before last night, both would have annoyed you:

- **Every slider was invisible.** The scrubber, volume and settings sliders had a 4px height
  and 8px vertical padding under `box-sizing: border-box`, which left the painted track zero
  pixels tall. You could drag them; you just could not see them.
- **Every fresh browser started silent.** The stored volume was read with `Number(...)`,
  which turns a missing key into `0`, so a new browser or a cleared cache opened muted with
  the slider at zero.

A third, found by the install work: `/api/health` returned 401 whenever an auth token was
set, because the path was compared before Express stripped the `/api` prefix. That would
have broken the Docker healthcheck and any monitoring.

---

## What I moved

Nothing was deleted — I did not have permission to delete files on your Mac, and I would
rather you did it yourself anyway. Everything from the old v1 app is in **`_to_delete/`**:
the v1 `server/` and `web/` folders, its `package.json`, its `node_modules`, the old
`data/hum.db` (with its tags and play counts, in case you want them — `scripts/migrate-from-hum.mjs`
can pull them into the new database), and the stale tarballs. Look through it and delete the
folder when you are happy.

`library/` was left exactly where it was.

The project folder is still called `hum/`. Renaming it would have broken this session's
access to it, so I left that to you.

---

## Where the work is

23 commits on `master`, one per feature, so anything here can be read or reverted on its
own. `git log --oneline` is the tour.
