# Phone flows

Maestro flows for the phone halves of the checks in `docs/UNIVERSAL.md`.

These need a Mac: a booted simulator, a dev client built from this workspace,
and `maestro` on the `PATH` (`curl -Ls https://get.maestro.mobile.dev | bash`).
None of them can run in a Linux container, which is why the web halves of the
same checks live in `../verify/` as Playwright specs and were run there.

Before any of these, from `apps/app`:

```
npx expo run:ios                                  # once per native change
npx expo start --dev-client --port 8082
xcrun simctl openurl booted \
  "selfmp3://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8082"
```

Each flow deep-links straight to its route, so none of them depends on a
configured server or a signed-in session — the `/spike-*` routes are exempt
from the sign-in redirect in `app/_layout.tsx`.

`spike-*.yaml` are throwaway and go when the spike branch does. `smoke.yaml`,
`offline.yaml` and `devices.yaml` are named by the phase 2 and 3 gates and are
skeletons: the steps are written out, but they assert against screens that do
not exist yet, so they will fail until the phase that builds them.
