# The admin page

The owner's page for running a self.mp3 server. It has three tabs: **Data** (how the
server is being used, as totals), **Access** (who can sign in) and **Server** (how the
machine is doing). Only the owner can open it, from their own devices on Tailscale. The app
has no owner-only screens at all: the owner is a user like any other there.

Decided on 2026-10-23 (proposal artifact `JdZ4o2nCHbXMJmV3mu7i8z`, version 4): picks A1 B1
D1 E1–E11 G2 H1 I1 I3 J1 K2 L1.

## Where it lives

The server runs a second listener for the page, **on this machine only** (`127.0.0.1`,
`SELFMP3_ADMIN_PORT`, default 4610), whatever `SELFMP3_HOST` says. Tailscale puts it on the
owner's tailnet, never on Funnel:

```sh
tailscale serve --bg --https=4443 http://127.0.0.1:4610
```

and the server is told the address it answers to, `SELFMP3_ADMIN_URL=https://pi.tail3d8516.ts.net:4443`.
The page answers only to that name and to this machine's own (`localhost`, `127.0.0.1`),
so a site elsewhere cannot reach it by pointing a name of its own at the loopback address.

The **public port** (4600, behind Funnel) serves the apps' API and nothing else. A browser
that opens it gets the API's own JSON 404. The old server page that used to answer there,
`apps/server/public`, is gone.

The page is plain files with no build step (`apps/server/admin/`), served by
`apps/server/src/admin/app.ts`. It is drawn in self.mp3's own design language: the app's
palette, type steps, cards and rows, pill buttons, the segmented control and the motion
speeds. A test (`admin/app.test.ts`) keeps its colours equal to the app's tokens.

## Access

The doorman keeps the allow list, as before (`apps/doorman/src/access.ts`). The page talks
to the doorman **straight from the browser**, signed in with Google as the owner. Signing in
is the doorman's usual flow: the page asks the server for the start address
(`GET /api/admin/signin`), Google sends the browser back to the tab it left with a one-time
code, and the page claims a session with it. The session is kept in the browser
(`localStorage`); nothing is kept on the server.

For this to work the doorman lists the page's address in `APP_ORIGINS`
(`apps/doorman/wrangler.toml`).

Who may change the list: an owner (`OWNER_EMAILS`), signed in on a device of their own.
A server's **grant** is a session in the owner's name too, but the doorman refuses it for
`/v1/access`, `/v1/access/requests` and `/v1/stats` (`requireOwner`). Without that, any
server the owner ever let in could change who signs in.

**Asked to get in.** When Google signs someone in who is not on the list, the doorman
remembers the address for a week (`GET /v1/access/requests`). The page lists them with
**Let in** (adds them to the list, which also forgets the request) and **Dismiss**
(`DELETE /v1/access/requests?email=…`). While the Google OAuth app is in Testing, a person
also has to be a test user there before Google lets them reach the doorman at all.

## Data

**Totals only.** There could be many people on a server, so nothing is collected or kept
per person: a day's counts carry no account, and nothing can be broken down by one later.
The counts live in three places:

| Where | What | Kept |
| --- | --- | --- |
| The server's `metrics.db`, beside `hub.json` (`services/metrics.ts`) | `import_log`: one row per finished import (where it came from, worked or why not, seconds per step, retries; no library, no song). `daily_totals`: Smart requests by feature with failures and time, YouTube asking the server to slow down, 500s by route, and what apps report | a year |
| Each library's own database | plays, added up across libraries when the page asks | as the library keeps them |
| The doorman's `TALLY` Durable Object (`apps/doorman/src/tally.ts`) | reads by bucket folder (`audio`, `covers`, `lyrics`) and by app (web, computer, phone, extension, server, lent), new sessions, refused sign-ins | a year; refused addresses a week |

The page's panels:

- **Headline numbers**: imports, the share that worked, the median time, songs downloaded.
- **Music import**: imports a day with the error rate; how long a song takes, in bands
  from under 30 s to over 10 min, with the median and where 9 in 10 are done; median time
  per step (waiting, finding, downloading, converting, lyrics, saving, uploading); YouTube
  downloads that worked each day, marked where YouTube held the server back; why imports
  fail, grouped; by source (YouTube, YouTube Music, 网易云, Spotify, other links).
- **Listening**: reads from buckets a day by kind, reads by app with song reads per play,
  and plays across every library.
- **The app**: features used, Smart requests, and errors (server 500s and problems apps
  showed people).

A failure's group comes from the words the person was shown (`failureOf`); a source from
the import's address (`sourceOf`).

### What apps report

While **Count features I use** is on (Settings › About, on by default), an app counts a few
named features as they are used (Now Playing, Search, Lyrics, Import, Ask, Up next, a share
link, a room) and the problems it showed (the cloud out of reach, the server away, the
bucket full for the day). Once a day it sends the day's counts to its library's server
(`POST /api/usage`, `UsageReportSchema`). The server adds them to that day's totals and
keeps nothing else, not even which library sent them. Nothing about what was played,
searched or asked is ever counted.

## Server

Version, uptime, how many libraries the server holds (a count only), disk and memory,
whether the Smart features' endpoint answers, and whether YouTube is holding the server
back. pi-dash (`:9443` on the tailnet) keeps the deeper picture of the Pi itself.

## Deploying

1. **The doorman, by hand**: `cd apps/doorman && npx wrangler deploy`. It creates the
   `Tally` Durable Object from migration `v5` and takes the new `APP_ORIGINS`.
2. **The server, by a push to `main`**: the Pi picks up the image by itself. Then, once,
   on the Pi: set `SELFMP3_ADMIN_URL` in `~/services/selfmp3/.env` and run the
   `tailscale serve` line above. The compose file uses host networking, so `127.0.0.1:4610`
   in the container is the Pi's own loopback.
3. **The apps**: the web app with the same push; phone and desktop with their next builds.
