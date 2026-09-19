# Phone flows

Maestro flows: the phone halves of the checks that Playwright runs in a browser
(`docs/ARCHITECTURE.md`, foundation 8).

These need a Mac: a booted simulator, a dev client built from this workspace,
and `maestro` on the `PATH` (`curl -Ls https://get.maestro.mobile.dev | bash`,
which installs to `~/.maestro/bin`). None of them can run in a Linux
container, which is why the web halves of the same checks live in the
repository's `verify/` as Playwright specs.

Before any of these, from `apps/app`:

```
npx expo run:ios                                  # once per native change
npx expo start --dev-client --port 8095
xcrun simctl openurl booted \
  "selfmp3://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8095"
```

The first deep link on a fresh simulator raises "Open in self.mp3?", and
`simctl openurl` does not return until it is answered — which looks exactly
like a hung simulator. Tap Open (or `maestro hierarchy` to see it is there).

The three gate flows go through the real app, so the phone has to be set up first,
and the same way for all three: **connected to the Mac by address**, not
signed in to the cloud. Presence, handoff and remote control travel through
the Mac's event stream, so a cloud-only phone has no other devices by design.

A development build's Welcome has a quiet "Connect to a server by address"
under the Google button, which opens the address form in place; a normal build
has none. `connect.yaml` does it for you, from a signed-out phone:

```
maestro test -e SERVER=<the Mac's address, e.g. 192.168.1.20:4600> .maestro/connect.yaml
```

By hand it is the same three testIDs: `welcome-address-toggle`, then type into
`welcome-address`, then `welcome-connect`. A phone already connected opens on
Home and needs none of this.

| Flow | Also needs | How to run |
|---|---|---|
| `connect.yaml` | A signed-out phone, and the Mac's address | `maestro test -e SERVER=<address> .maestro/connect.yaml` |
| `smoke.yaml` | A library on the Mac | `maestro test .maestro/smoke.yaml` |
| `devices.yaml` | Another device playing against the same Mac, e.g. the web app open in a browser | `maestro test .maestro/devices.yaml` |
| `offline.yaml` | At least one song downloaded (`smoke.yaml` downloads a playlist) | `.maestro/offline-run.sh` |

`offline-run.sh` freezes the Mac's server for the run and resumes it
afterwards, because the simulator has no airplane mode. Pass maestro's options
through it, e.g. `.maestro/offline-run.sh --device <udid>`.

Two things these flows cannot see, which whoever runs them reads from
`GET /api/devices` on the Mac: that the other device paused on handoff, and
that the phone started near the position the other device had reached.
