# The Report, anytime — and forgotten gems

Two ways of looking back at your own listening, built from what the library already records:
every play, and each song's play count, last play and love.

**Where the plays come from.** A play is written on the device that heard it, goes up to the
bucket in that device's log, and is folded into the server's `play_events` table; the server
keeps the history in the bucket too, a file a month (`lyrics/<sha256>.plays`, docs/SYNC.md,
"Plays"), so a server starting over has every play back. A snapshot only says how often a
song was played, never *when*, so the Report needs the server: a device reaches it by the
addresses in the last snapshot and asks it directly, and the songs its answers name are lined
up with this device's by the uid both know them by, so a cover still draws and a line still
plays. With no server in reach the page is still drawn and says why it is empty. See
docs/SYNC.md, "Reaching the server for what only it can do".

Forgotten gems need no server: they are worked out on the device from its own copy of the
library.

---

## The Report

`/stats/report`, a page of its own. It is reached from the Report button in Stats' header on a
computer (the page's last row on a phone), from **Report** on the You page, and from Home's
*This week* card once a week is ready to look back on.

The yearly version of this is a marketing exercise that arrives once, in December. The
useful version is being able to ask *"what did last week sound like"* on a Tuesday, so the
range is a control, shared with Stats: **Week / Month / 3 months / Year / All time** (the
last 7, 30, 90 and 365 days, or everything).

The period is drawn as one picture in a **look** of your choosing — Paper, Receipt, Wall,
Calendar or Words, and on a computer a newspaper Front page, which it opens on (a phone opens
on Paper). Every look is drawn from the same numbers (`apps/app/src/features/wrapped/looks.model.ts`,
`looks/`).

### What it shows

| | |
|---|---|
| Minutes listened | Summed `ms_played`, the hero number |
| Plays, songs, days with music | Totals for the window |
| Longest streak | Longest run of consecutive local dates with a play |
| Peak hour, best weekday | Busiest hour and weekday, in local time |
| Top 5 songs, artists, tags | With play counts; the songs are clickable |
| On repeat | The most you played one song in a single day, and which day |
| Discovered | Added inside the window **and** played at least three times in it |
| Listening personality | A line of traits, from fixed rules — see below |

### The window starts at a local midnight

Ranges are rolling — "week" on a Tuesday means the last seven days, not "since Monday" —
but the window is snapped back to a local midnight rather than counted in 24-hour steps.

That matters because almost every headline on this page is a count of *days*. A window
starting at "now minus seven times twenty-four hours" straddles eight calendar dates, so a
page headed "Last 7 days" would cheerfully report *8 days with music*, and the streak could
read 8 out of 7. Snapping to midnight makes the label and the numbers agree. The Stats page
keeps its own plain rolling window; the two can differ by a few plays near the boundary.

Hours, dates and weekdays all use SQLite's `localtime`, so "peak hour" means your evening,
not UTC's.

### Listening personality

A short line like *"Night owl · Repeat listener · Daily ritual"*. Every trait is a plain
threshold on numbers already on the page, and all of them live in one file
(`packages/shared/src/personality.ts`) so the claim can be checked:

| Trait | Rule |
|---|---|
| Night owl / Early bird / Daytime listener | ≥ 35 % of plays in 22:00–04:59 / 05:00–09:59, or ≥ 60 % in 10:00–17:59 |
| Repeat listener | Your top five songs are ≥ 40 % of all plays |
| Explorer | Distinct songs ÷ plays ≥ 0.6 |
| Collector | Three or more discoveries in the window |
| Daily ritual | A streak of seven days or more |
| Weekender | ≥ 45 % of plays on Saturday and Sunday |
| Marathoner | ≥ 120 minutes per day, on the days you listened at all |
| Casual listener | Fewer than ten plays, or nothing else matched |

Under ten plays it says *Casual listener* and stops, because no pattern is worth claiming
from eight data points. Nothing here is a model or a guess — it is arithmetic you could do
yourself, which is the only kind of "personality" worth putting a name to.

### Save as image

**Save as image** saves the look on screen, as it is drawn: the Words page saves as the
Words page. `apps/app/src/ports/saveLook.ts` photographs the page on a phone with
`react-native-view-shot`, at the screen's own density, and hands the PNG to the share sheet
(`expo-sharing`), where Save Image puts it in Photos. `saveLook.web.ts` draws the page's
markup into a canvas with `html2canvas`, at least twice the look's own width, and downloads
it, in a browser and the desktop app. The file name comes from `shareFileName` in
`apps/app/src/features/wrapped/wrapped.model.ts`. Only the page is saved, never the chrome
around it.

### API

```
GET /api/stats/wrapped?range=week|month|quarter|year|all   → Wrapped     (default: month)
```

Asked of the server, through the reached address on a cloud library
(`apps/app/src/features/stats/statsSource.ts`). Schema: `WrappedSchema` in
`packages/shared/src/schemas/wrapped.ts`. All the SQL is in
`apps/server/src/repositories/wrapped.ts`; only the streak and the personality line are
worked out in JavaScript, from a handful of rows.

---

## Forgotten gems

Songs you clearly liked — **loved, or played five or more times** — that have not come up
in a long while.

Where you'll see it:

- a **Forgotten gems** row at the top of the Library, with *Play all* and *Add to Up next*.
  It collapses, and it is left out while the library is narrowed to tags: there it would be
  about the tags, not about what you have forgotten;
- a built-in tile among your **Playlists**. It is not a playlist in the library, so there is
  nothing to delete or rename. Pressing it starts the list — there is no detail page,
  because the list is different every time it is asked for and a page claiming to show
  *the* forgotten gems would be lying about being stable.

### What qualifies

A song is a gem when all of these hold:

- it is **loved**, or has **≥ 5 plays**;
- it has not been played for at least the **threshold** — counted from when it was last played, or
  from when it was added for a loved song that has never been played at all.

**The threshold scales with the library's age**: one fifth of the age of the oldest song,
clamped to 14–60 days. A fixed sixty days would leave a six-week-old library with nothing
to show; a two-week-old library cannot have forgotten anything yet.

### Ranking, and why it moves

Songs are ranked by `plays × days since last played`, multiplied by a random factor
between 0.75 and 1.25.

The random nudge is the point. A stable ranking would put the same five songs at the top
forever and become a reproach you learn to ignore; a list that rotates is a discovery. The
nudge is small enough that a song you played thirty times two years ago still outranks one
you played five times last quarter — it shuffles neighbours, it does not invert the order.

Because the ranking is drawn again on every request, the client caches the response with
`staleTime: Infinity`: a background refetch would silently rearrange the row under your
finger. It reloads when you open the page again, which is the only moment a different set
is welcome.

### API

```
GET /api/library/gems?limit=1..100                    → ForgottenGems   (default: 20)
```

Answered by this device's own copy of the library (`packages/replica/src/routes.ts`), and by
the server's `routes/gems.ts` for a development build pointed at a server; both run the one
rule, `forgottenGems` in `packages/shared/src/gems.ts`. Returns full `Song` objects — the same
shape the library uses, so the row can hand them straight to the player — plus `minDays` (the
threshold actually applied) and `total` (how many qualified before the limit). Schema:
`ForgottenGemsSchema` in `packages/shared/src/schemas/gems.ts`.
