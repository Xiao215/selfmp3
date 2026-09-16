# Wrapped, anytime — and forgotten gems

Two ways of looking back at your own listening, both built entirely from the `play_events`
table that the app has been filling since day one. No new data is collected and no
migration is needed.

**Both are the server's**, which is where `play_events` lives, so the app hides them when
its library is the bucket's — and every surface's now is, which means neither is reachable
today. The plays are still being recorded and still reach the server, so nothing is being
lost in the meantime ([SYNC.md](../SYNC.md), "What this gives up").

---

## Wrapped

`/stats/report`: the Stats page, opened on its **Report** tab.

The yearly version of this is a marketing exercise that arrives once, in December. The
useful version is being able to ask *"what did last week sound like"* on a Tuesday, so the
range is a control: **Week / Month / Year / All time**.

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

### Share as image

**Share as image** renders a 1080×1350 PNG on a canvas and downloads it; the file name
comes from `shareFileName` in `apps/app/src/features/wrapped/wrapped.model.ts`. It is offered
in a browser and the desktop app only (`canShareCard`).

It is drawn rather than screenshotted, so it has no app chrome in it. The colours are the
theme on screen, passed in already resolved, so a card made with a different accent hue
matches the app it came from. It is `fillText` calls on a canvas in
`apps/app/src/ports/shareCard.web.ts` — no image library.

### API

```
GET /api/stats/wrapped?range=week|month|year|all      → Wrapped     (default: month)
```

Schema: `WrappedSchema` in `packages/shared/src/schemas/wrapped.ts`. All the SQL is in
`apps/server/src/repositories/wrapped.ts`; only the streak and the personality line are
worked out in JavaScript, from a handful of rows.

---

## Forgotten gems

Songs you clearly liked — **loved, or played five or more times** — that have not come up
in a long while.

Where you'll see it:

- a **Forgotten gems** row at the top of the Library, with *Play all* and *Add to queue*.
  It collapses, and it only appears on the unfiltered library: inside a search result it
  would be about the search, not about what you have forgotten;
- a built-in card among your **Playlists**. It is not a row in the database, so there is
  nothing to delete or rename. Clicking it starts the list — there is no detail page,
  because the list is different every time it is asked for and a page claiming to show
  *the* forgotten gems would be lying about being stable.

### What qualifies

A song is a gem when all of these hold:

- it is **loved**, or has **≥ 5 plays**;
- its file is **present** (a song on an unplugged drive is not forgotten, it is unreachable);
- it has not been played for at least the **threshold** — counted from `last_played_at`, or
  from `added_at` for a loved song that has never been played at all.

**The threshold scales with the library's age**: one fifth of the age of the oldest song,
clamped to 14–60 days. A fixed sixty days would leave a six-week-old library with nothing
to show; a two-week-old library cannot have forgotten anything yet.

### Ranking, and why it moves

Songs are ranked by `play_count × days since last played`, multiplied by a random factor
between 0.75 and 1.25.

The random nudge is the point. A stable ranking would put the same five songs at the top
forever and become a reproach you learn to ignore; a list that rotates is a discovery. The
nudge is small enough that a song you played thirty times two years ago still outranks one
you played five times last quarter — it shuffles neighbours, it does not invert the order.

Because the server re-ranks on every request, the client caches the response with
`staleTime: Infinity`: a background refetch would silently rearrange the row under your
finger. It reloads when you open the page again, which is the only moment a different set
is welcome.

### API

```
GET /api/library/gems?limit=1..100                    → ForgottenGems   (default: 20)
```

Returns full `Song` objects — the same shape the library uses, so the row can hand them
straight to the player — plus `minDays` (the threshold actually applied) and `total` (how
many qualified before the limit). Schema: `ForgottenGemsSchema` in
`packages/shared/src/schemas/gems.ts`; SQL in `apps/server/src/repositories/gems.ts`.
