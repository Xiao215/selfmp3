# verify — the flows the gates run

`npm run verify:flows`, which is
`playwright test -c verify/playwright.config.ts flows --project=desktop --project=phone`.
The config has to be named: without `-c` Playwright reads the root one and none
of the setup below applies.

These are the gate that checks the app still *behaves*, where `typecheck`,
`lint` and the unit tests only prove it compiles.

## What they need

**The app on one port and a server with a library on another**, which is the
whole reason these could not be run when they were written:

```
npm run dev          # the server on 4600, the app's web dev server on 4601
npm run verify:flows # in another terminal
```

That is what the flows default to: the app at `http://localhost:4601`, its API
at `http://localhost:4600`. Both defaults live in `verify/env.ts`, and only
there: the config, the teardown and every spec that asks the server something
import them from it. The two are separate because the server does not
serve the app — its own page on 4600 is setup and status, and the app is built
for GitHub Pages and for the desktop shell.

The app has to be *told* where its server is, since the address is not its own
origin. The flows do it through the `secrets` port, which in a browser is
`localStorage`, and a fresh Playwright context has none — without it the app
quite correctly shows Welcome and every flow times out waiting for a
library. `SELFMP3_WEB_URL` and `SELFMP3_APP_API` override either half, for a
build served from somewhere else or a server on another port:

```
SELFMP3_WEB_URL=http://localhost:8090 SELFMP3_APP_API=http://localhost:4610 npm run verify:flows
```

`verify/flows/pwa.spec.ts` needs a built app, since only a production build
registers the service worker; it skips on a dev server. It looks at the app's
own address unless `SELFMP3_BUILD_URL` names a build served elsewhere:

```
SELFMP3_BUILD_URL=http://localhost:8090 npm run verify:flows
```

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

A fabricated library would make the command green anywhere, which is exactly
the problem: the flows are supposed to check the app as it actually behaves
with real songs in it. A run against invented songs proves the app matches its
own invention.
