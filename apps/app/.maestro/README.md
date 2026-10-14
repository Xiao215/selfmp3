# Phone flows

Maestro flows: the phone halves of the checks that Playwright runs in a browser
(`docs/ARCHITECTURE.md`, "Foundations"; the web halves are in the repository's
`verify/`).

These need a Mac: a booted iOS simulator, a development client built from this
workspace, and `maestro` on the `PATH` (`curl -Ls https://get.maestro.mobile.dev | bash`,
which installs to `~/.maestro/bin`). None of them can run in a Linux container.

## The simulator

Run the flows on a simulator nobody is using by hand. A person tapping the same
simulator mid-run — opening Now Playing, switching the theme — fails steps for
reasons that have nothing to do with the app. Pass `--device <udid>` to pick one
(`xcrun simctl list devices booted`).

Before any of these, from `apps/app` (`docs/MOBILE.md` has the details):

```
npx expo run:ios --device <udid>                  # once per native change
npx expo start --dev-client --port 8095
xcrun simctl openurl <udid> \
  "selfmp3://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8095"
```

The first deep link on a fresh simulator raises "Open in self.mp3?", and
`simctl openurl` does not return until it is answered — which looks exactly
like a hung simulator. Tap Open (or `maestro hierarchy` to see it is there).

## The server they run against

A **development server on the Mac**, never a real library. The simulator cannot
sign in to a Google account, so it cannot reach a bucket the way a phone does;
instead the phone is connected to a server by its address, and the flows go
through that server. From the repository root:

```
npm run dev:api        # the dev profile on http://localhost:4600, with a folder for a bucket
```

That is the server `verify/README.md` describes: the dev profile's own folders
and a plain folder standing in for the bucket, so it never signs in to an
account and can never publish over a real library. Any other `apps/server`
started on the Mac with its own `SELFMP3_DATA_DIR` will do too, on another port.

A server with a fresh data folder has no tags and no plays, so the steps that
need them have nothing to find; run against the dev profile's own data to cover
them.

## Connecting the phone

All the flows except `connect.yaml` expect a phone already **connected to that
server by address**, not signed in to the cloud. A development build's Welcome
has a quiet "Connect to a server by address" under the Google button, which
opens the address form in place; a normal build has none. `connect.yaml` does it
for you, from a signed-out phone:

```
maestro test -e SERVER=localhost:4600 .maestro/connect.yaml
```

The simulator shares the Mac's network, so `localhost` is the Mac. By hand it is
the same three testIDs: `welcome-address-toggle`, then type into
`welcome-address`, then `welcome-connect`. A phone already connected opens on
Home and needs none of this.

## The flows

| Flow | Also needs | How to run |
|---|---|---|
| `connect.yaml` | A signed-out phone, and the server's address | `maestro test -e SERVER=<address> .maestro/connect.yaml` |
| `smoke.yaml` | Songs on the server | `maestro test .maestro/smoke.yaml` |
| `downloads.yaml` | Songs on the server; turns both offline settings off and back on | `maestro test .maestro/downloads.yaml` |
| `devices.yaml` | Another device playing against the same server, e.g. the web app open in a browser | `maestro test .maestro/devices.yaml` |
| `offline.yaml` | At least one song downloaded (`smoke.yaml` downloads a playlist) | `.maestro/offline-run.sh` |
| `tablet.yaml` | An iPad simulator, connected the same way | `maestro --device <iPad udid> test .maestro/tablet.yaml` |
| `close-guide.yaml` | — | Not run on its own: the others call it to close a one-time guide |

`offline-run.sh` freezes the server listening on `SELFMP3_PORT` (4600 unless
set) for the run and resumes it afterwards, because the simulator has no
airplane mode: to the phone, a server that accepts a connection and never
answers is a server out of reach. Pass maestro's options through it, e.g.
`.maestro/offline-run.sh --device <udid>`.

Presence and handoff travel through the server's event stream, which is why
`devices.yaml` needs the other device on the same server. Two things that flow
cannot see, which whoever runs it reads from `GET /api/devices` on that server:
that the other device paused on handoff, and that the phone started near the
position the other device had reached.
