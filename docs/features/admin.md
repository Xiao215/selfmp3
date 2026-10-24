# The admin page

The owner's page for running a self.mp3 server. It has two tabs: **Data**, how the server is
being used, as totals; and **People**, who can sign in. Only the owner can open it, from
their own devices on Tailscale. The app has no owner-only screens at all: the owner is a user
like any other there.

Decided on 2026-10-23 and reworked on 2026-10-24 (proposal artifact
`JdZ4o2nCHbXMJmV3mu7i8z`, version 5 and Xiao's notes on it):

- The page is framed the way the app is: its logo, sidebar, icons, page titles, cards,
  Settings' panels and rows, buttons, segmented control and dialog.
- The charts are working charts in the app's colours, not Stats' decoration.
- There is no sign-in, no Server tab, and no list of turned-away addresses.

## Where it lives

The server runs a second listener for the page, **on this machine only** (`127.0.0.1`,
`SELFMP3_ADMIN_PORT`, default 4610), whatever `SELFMP3_HOST` says. Tailscale puts it on the
owner's tailnet, never on Funnel:

```sh
tailscale serve --bg --https=4443 http://127.0.0.1:4610
```

The server is told the address it answers to:
`SELFMP3_ADMIN_URL=https://pi.tail3d8516.ts.net:4443`. The page answers only to that name and
to this machine's own (`localhost`, `127.0.0.1`), so a site elsewhere cannot reach it by
pointing a name of its own at the loopback address.

The **public port** (4600, behind Funnel) serves the apps' API and nothing else. A browser that
opens it gets the API's own JSON 404.

The page is plain files with no build step (`apps/server/admin/`), served by
`apps/server/src/admin/app.ts`. A test (`admin/app.test.ts`) keeps its colours equal to the
app's tokens.

## No sign-in: the admin key

Reaching the page at all, on the owner's tailnet, is the proof that it is the owner. Two
things the page shows are kept by the doorman, not the server: the list of who can sign in,
and the doorman's own counts. The server asks the doorman for both with an **admin key**,
and the page asks the server (`/api/admin/people`, `/api/admin/data`):

- **On the doorman:** the `ADMIN_TOKEN` secret.
- **On the server:** the same value, as `SELFMP3_DOORMAN_ADMIN_TOKEN` in `.env`.

The doorman takes that key, or the owner signed in on a device of their own, for `/v1/access`
and `/v1/stats` (`requireOwner`). It refuses a server's **grant**, though a grant is a session
in the owner's name. Without that, any server the owner ever let in could change who signs in.
A key shorter than 32 characters is no key.

Without the key set, the page still shows everything the server counts. Its People tab then
says to set the key, and the doorman's counts stay off the Data tab.

## People

Who can sign in, built for a hundred people or more:

- One list of addresses, A–Z. The list scrolls inside its panel.
- Over it, one row: the app's search field (with a count and a × once there are words), and a
  **+** that opens Add people. Add people takes one address or many pasted at once, and says
  which ones aren't addresses.
- The owners (`OWNER_EMAILS`) are marked and can't be removed.
- The page shows addresses only. The doorman keeps no names or pictures for it.
- Remove asks first, in the app's confirmation dialog.
- **Anyone with a Google account** is a setting of its own. Turning it on asks first.

While the Google OAuth app is in Testing, a person also has to be a test user there before
Google lets them reach the doorman at all.

## Data

**Totals only.** There could be many people on a server, so nothing is collected or kept per
person: a day's counts carry no account, and nothing can be broken down by one later. The
counts live in three places:

| Where | What | Kept |
| --- | --- | --- |
| The server's `metrics.db`, beside `hub.json` (`services/metrics.ts`) | `import_log`: one row per finished import (where it came from, worked or why not, seconds per step, retries; no library, no song). `daily_totals`: Smart requests by feature with failures and time, YouTube asking the server to slow down, 500s by route, and what apps report | a year |
| Each library's own database | plays, added up across libraries when the page asks | as the library keeps them |
| The doorman's `TALLY` Durable Object (`apps/doorman/src/tally.ts`) | reads by bucket folder (`audio`, `covers`, `lyrics`) and by app (web, computer, phone, extension, server, lent), new sessions, refused sign-ins (the count, not the address) | a year |

A range switch (week, month, 3 months) scopes everything on the tab. On a wide window an
**On this page** index sits on the right, with every section and chart. It marks the one being
read, and keeps an entry that was clicked marked until the reader scrolls. The title line says
whether Smart features answer and whether YouTube is holding the server back. Then:

- **Headline numbers**: imports with the change on the period before, the share that worked,
  the median import time, plays, and songs read from buckets per play.
- **Music import**:
  - Imports a day (worked and failed, stacked).
  - The share that failed per day.
  - The median import time per day.
  - How long imports take, in bands, with the median and 90% marked.
  - Median time per step.
  - YouTube downloads that worked per day, with the days YouTube held the server marked.
  - Why imports fail.
  - A table by source.
- **Listening**: reads from buckets a day by kind, plays a day, reads by app.
- **The app**: features used, Smart requests, and a table of errors (server 500s and problems
  apps showed people).

Every chart has one axis and is drawn at the size it's shown. Every mark has a tooltip,
reachable by keyboard too, and every chart has a table view. Series that need telling apart
use the app's accent, pink and orange, checked for colour blindness against both themes.

A failure's group comes from the words the person was shown (`failureOf`); a source comes from
the import's address (`sourceOf`).

### What apps report

While **Count features I use** is on (Settings › About, on by default), an app counts a few
named features as they are used (Now Playing, Search, Lyrics, Import, Ask, Up next, a share
link, a room) and the problems it showed (the cloud out of reach, the server away, the bucket
full for the day). Once a day it sends the day's counts to its library's server
(`POST /api/usage`, `UsageReportSchema`). The server adds them to that day's totals and keeps
nothing else, not even which library sent them. Nothing about what was played, searched or
asked is ever counted.

## Deploying

1. **The doorman, by hand.** Set the key once, then deploy:

   ```sh
   cd apps/doorman
   npx wrangler secret put ADMIN_TOKEN
   npx wrangler deploy
   ```

2. **The server, by a push to `main`.** The Pi picks up the image by itself. Once, on the Pi,
   set `SELFMP3_ADMIN_URL` and `SELFMP3_DOORMAN_ADMIN_TOKEN` in `~/services/selfmp3/.env` and
   run the `tailscale serve` line above. The compose file uses host networking, so
   `127.0.0.1:4610` in the container is the Pi's own loopback.

3. **The apps**: the web app ships with the same push; phone and desktop with their next builds.
