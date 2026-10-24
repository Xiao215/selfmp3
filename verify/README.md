# verify — the flows the gates run

`npm run verify:flows`, which is
`playwright test -c verify/playwright.config.ts flows --project=desktop --project=phone`.
The config has to be named: without `-c` Playwright reads the root one and none
of the setup below applies.

These are the gate that checks the app still *behaves*, where `typecheck`,
`lint` and the unit tests only prove it compiles. Each flow runs twice: at 1280
wide (the computer layout, sidebar and player bar) and at 375 (the phone
layout). The desktop shell and the extension have suites of their own,
`verify:desktop` and `verify:extension`, which bring their own fakes and are not
described here.

## What they need

**The app on one port and a server with a library on another**:

```
npm run dev          # the server on 4600, the app's web dev server on 4601
npm run verify:flows # in another terminal
```

`npm run dev` runs two things. `dev:api` is the server with
`SELFMP3_PROFILE=dev` and `SELFMP3_CLOUD_DIR=bucket`: the dev profile's own
folders (`~/Music/selfmp3-dev` for the inbox, `~/Library/Application
Support/selfmp3-dev` on a Mac or `~/.local/share/selfmp3-dev` on Linux for the
data), and a plain folder, `bucket` inside that data folder, standing in for the
bucket. So the dev server never signs in to an account and can never publish
over a real library. `dev:web` builds the packages and serves the app from
Expo's web dev server on 4601.

That is what the flows default to: the app at `http://localhost:4601`, its API
at `http://localhost:4600`. Both defaults live in `verify/env.ts`, and only
there: the config, the teardown and every spec that asks the server something
import them from it. The two are separate because the server does not
serve the app — it serves no page at all, and the app is built
for GitHub Pages, the phone and the desktop shell.

**The server has to accept the app's origin.** The app on 4601 is another
origin, and the server answers a browser only from the origins it is told
about (`SELFMP3_CORS_ORIGINS`); without it every call is blocked, the page says
it cannot reach the server and twenty-odd flows fail at once, looking like
broken features. `dev:api` sets it to `http://localhost:4601`, the origin
`dev:web` serves, so `npm run dev` needs nothing more. An origin of your own in
front of the command is added to it (one in `.env` is not: the script's value
comes first):

```
SELFMP3_CORS_ORIGINS=http://localhost:8090 npm run dev   # 4601 and 8090
```

A server started any other way — the lane below, `npm run dev --workspace
@selfmp3/server` — sets nothing, and needs the app's origin named.

**The app has to be told where its server is**, since the address is not its
own origin. Only a development build reads a server address instead of signing
in, and the flows hand it one through the `secrets` port, which in a browser is
`localStorage`: the config seeds `selfmp3.baseUrl`, a fixed device id per width,
and every one-time guide as already seen. A fresh Playwright context has none of
that — without it the app quite correctly shows Welcome and every flow times
out waiting for a library.

`SELFMP3_WEB_URL` and `SELFMP3_APP_API` override either half, for a build
served from somewhere else or a server on another port (which then needs that
web address in its `SELFMP3_CORS_ORIGINS`):

```
SELFMP3_WEB_URL=http://localhost:8090 SELFMP3_APP_API=http://localhost:4610 npm run verify:flows
```

A second server for a parallel run, beside one already on 4600, is the
server's own dev script with its own port and folders. Give it its own
`SELFMP3_CLOUD_DIR` as well, or it will not be a sandbox:

```
SELFMP3_PORT=4610 SELFMP3_LIBRARY_DIR=/tmp/lane/library SELFMP3_DATA_DIR=/tmp/lane/data \
  SELFMP3_CLOUD_DIR=bucket SELFMP3_CORS_ORIGINS=http://localhost:4601 \
  npm run dev --workspace @selfmp3/server
```

A server started from an empty data folder has no tags and no plays, and scans
every song in one pass so they all share one added time; the flows that need
tags, plays or an order by date skip there. Run against the dev profile's own
database to cover them.

`verify/flows/pwa.spec.ts` needs a built app, since only a production build
registers the service worker; it skips on a dev server. It looks at the app's
own address unless `SELFMP3_BUILD_URL` names a build served elsewhere:

```
SELFMP3_BUILD_URL=http://localhost:8090 npm run verify:flows
```

When the run ends, `flows/teardown.ts` asks the server to forget the two
devices the flows ran as, so its device list is left as the run found it.

## The library they run against

The dev library is whatever the dev server's folder bucket holds: audio put in
`~/Music/selfmp3-dev` is swept in, uploaded to the folder, and the copy in the
inbox removed. The flows need at least two songs in it; the ones that need more,
or tags, or a playlist you made with at least three songs, say so and skip
themselves. The flows that read links also skip when the server has no `yt-dlp`.

They distinguish the three ways a library query can settle, because the three
mean very different things:

| What happened | What the run does |
|---|---|
| Songs | runs the flow |
| Library reachable but empty | **skips**, naming the setup problem — an empty folder is not a regression |
| Server not reachable | **fails**, saying to start `npm run dev` — a green run here would mean nothing was checked |

A skip is not a pass: read the list of skips after a run. When a whole heap of
flows fails at once, suspect the harness before the product — a missing CORS
origin is the usual one — and read `test-results/<test>/error-context.md`,
which holds the page's whole accessibility tree at the moment it failed.

The dev library is not in the repository — audio files are not something to
commit — so these flows cannot run in a container that has only the checkout.
They run on a development computer that has the dev library.

## Why not fixtures

A fabricated library would make the command green anywhere, which is exactly
the problem: the flows are supposed to check the app as it actually behaves
with real songs in it. A run against invented songs proves the app matches its
own invention.
