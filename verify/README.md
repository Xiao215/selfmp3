# verify — the flows the gates run

`npx playwright test verify/flows --project=desktop --project=phone`

This is the fourth of phase 1's four gate commands, and it is the one that
checks the thing the other three cannot: that the app still *behaves* the same
after everything moved into `packages/client`. The other three prove it
compiles, lints and passes its unit tests.

They were written against the web app, which was known to be right, and have
run against `apps/app` since phase 2. The web app is gone now (phase 5); the
reference captures under `docs/reference/` are what is left of it.

## What they need

A **running server with a library in it**, which is the whole reason these
could not be run when they were written:

```
npm run build        # the server, and the app's web export it serves
SELFMP3_PROFILE=dev npm start
npm run verify:flows # in another terminal: the app the Mac serves, on 4600
```

Or against a dev server, which has to be told where its Mac is:

```
npm run dev          # the server on 4600, the app's dev server on 4601
SELFMP3_WEB_URL=http://localhost:4601 SELFMP3_APP_API=http://localhost:4600 npm run verify:flows
```

`verify/flows/pwa.spec.ts` needs the built app either way, since only a
production build registers the service worker; it skips on a dev server.

`npm run dev` sets `SELFMP3_PROFILE=dev`, so this is the thirteen-song dev
library in `~/Music/selfmp3-dev`, never the real one. The flows need at least
two songs in it; the ones that need more say so and skip themselves.

They distinguish the three ways a library query can settle, because the three
mean very different things:

| What happened | What the run does |
|---|---|
| Songs | runs the flow |
| Library reachable but empty | **skips**, naming the setup problem — an empty folder is not a regression |
| Server not reachable | **fails**, saying to start `npm run dev` — a green run here would mean nothing was checked |

The dev library is not in the repository — audio files are not something to
commit — so these flows cannot run in a container that has only the checkout.
They run on the Mac.

## Why not fixtures

A fabricated library would make the command green anywhere, and it would make
the phase 4 comparison a lie: the reference captures under `docs/reference/`
are supposed to be the app as it actually looks with real songs in it. A
comparison against invented songs proves the app matches its own invention.
