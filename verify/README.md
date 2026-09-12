# verify — the flows the gates run

`npx playwright test verify/flows --project=desktop --project=phone`

This is the fourth of phase 1's four gate commands, and it is the one that
checks the thing the other three cannot: that the app still *behaves* the same
after everything moved into `packages/client`. The other three prove it
compiles, lints and passes its unit tests.

The same flows are what phase 2 runs against `apps/app` at 375, and what phase 4
runs against both widths. They are written once, here, against the app that is
known to be right.

## What they need

A **running server with a library in it**, which is the whole reason these
could not be run when they were written:

```
npm run dev          # the reference: server on 4600, web on 4601
npm run verify:flows # in another terminal
```

Point them elsewhere with `SELFMP3_WEB_URL`, which is how the same flows are
run against `apps/app` from phase 2 onwards.

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
