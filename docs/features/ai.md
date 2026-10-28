# Smart features (AI)

What the language model does in self.mp3, how each feature is put together, and why it is
put together that way rather than as a chat window or a free-roaming agent. The screens are
on the AI ideas canvas (<https://claude.ai/artifact/F9yEDvXnGRhgMrVQevHumS>); this page is
the engineering under them.

Most of it is reached through **S1, Ask in the Search box**. Besides Ask there are **L2, New
playlist's Describe it**, the **Describe** pipeline (A1c) both use, **Tags** (the tag review
Ask and Suggest tags share), **Tidy up** for names (and what is missing, and songs held
twice), the **Report in words**, **Fix song info's Suggested card** and **Names at import**.
The letters and numbers are the canvas's names for them.

---

## The three rules

Carried over from the Later page of the UI mock, and they decide most of what follows:

1. **Only your own songs.** It never recommends music you do not have. Every song id and
   tag it returns is checked against the ones it was shown, so it cannot name a song that
   does not exist.
2. **It proposes, you approve.** No output is ever written straight into the library. A
   suggestion is drawn dashed until you take it, and taking it is an ordinary edit, so undo
   and sync are the ones every other edit has.
3. **Never a chat window.** Each feature is one button somewhere you already go. With every
   smart feature off, the app is the same app.

---

## Where it runs

On the server: the always-on computer that works for your library (a Raspberry Pi in
Xiao's case; [shared-server.md](shared-server.md)), which holds the library's working copy
together with its plays, lyrics index and audio analysis. The device itself answers from
its copy of the bucket, and every `/api/ai/…` route is one of the routes only a server can
answer (`SERVER_ONLY_ROUTES` in `packages/replica/src/routes.ts`). A device reaches it the
way it reaches the metadata lookup and the stats (docs/SYNC.md, "Reaching the server for
what only it can do"): the screen probes the server's addresses, talks to the first that
answers, and says so in its own words when none does. Songs come back as the server's ids
and the device lines them up with its own (`useServerSongIds`), exactly as the stats do;
tags travel by name, which is unique in every library. What is made from an answer is made on the device, through the same edits as
everything else (`apps/app/src/features/smart/useSmartServer.ts`).

The model itself is behind one setting: any **OpenAI-compatible chat-completions endpoint**
that accepts `response_format: { type: "json_schema" }`. That is the most widely spoken
format there is, so the endpoint is a swap, not a rewrite:

| Endpoint | `SELFMP3_AI_BASE_URL` | Notes |
|---|---|---|
| [cli-bridge](https://github.com/Xiao215/cli-bridge), on the server itself (Xiao's) | `http://127.0.0.1:8787/v1` | A small service beside the server (a systemd user unit, `cli-bridge.service`) that answers through the Claude Code CLI signed in on that machine, and through Google's Antigravity CLI for `gemini-*` models. 2–5 s per call to start a process. Takes `tools` and `web_search_options` |
| Anthropic | `https://api.anthropic.com/v1` | Its OpenAI-compatible endpoint, with an API key |
| OpenAI, OpenRouter, … | their `/v1` | |
| Ollama (nothing leaves the server) | `http://127.0.0.1:11434/v1` | Weaker picks; structured output still works |

The address is read by the server, so `127.0.0.1` is the server's own machine. With the
Docker image on `network_mode: host`, as Xiao's runs, that reaches a service listening on
the host's loopback; in a container on a network of its own, `127.0.0.1` would be the
container. cli-bridge runs on its owner's own Claude subscription, which its README says is
for that person's use only: for a server that friends use too, see
[shared-server.md](shared-server.md), "Cost and risk".

| Setting | |
|---|---|
| `SELFMP3_AI_BASE_URL` | Unset = smart features are off, and say so where they would be |
| `SELFMP3_AI_API_KEY` | Sent as `Authorization: Bearer …`; optional for localhost |
| `SELFMP3_AI_MODEL_FAST` | Planning and small jobs. Default `sonnet` |
| `SELFMP3_AI_MODEL_SMART` | Picking and judging. Default `sonnet` |
| `SELFMP3_AI_TIMEOUT_SECONDS` | Per call. Default 240 |
| `SELFMP3_AI_CONCURRENCY` | Requests in flight to the endpoint at once, for the whole server; the rest wait here in order. Default 2, cli-bridge's own limit |

The two model names are **tiers**, not vendors: a task asks for `fast` or `smart` and never
names a model, so moving to another provider is three environment variables. Both default
to `sonnet` because of what was measured through cli-bridge on 2026-10-03: a plan took
3.7 s on `sonnet` and 14–82 s on `haiku` (the CLI's structured output, not the model, is
the likely cost). On a provider billed per token, set the fast tier to its small model.

Measured on the real library (1,342 songs) through cli-bridge: Describe 8–15 s (plan
4–15 s, pick 4–8 s); "tag the songs that should be 中文流行" 12 s over 1,336 songs (route,
plan, two group calls), proposing 99 songs, every one Mandarin or Cantonese pop.

The app has no page for the model. `GET /api/ai` says where the server asks (scheme, host
and path only, never the key) and which two models; with no address, Settings › Smart
features dims its switch and says "Your server has no model set up." A feature whose call
fails says so in words: the endpoint down, the key refused, or a limit reached
([INSTALL.md](../INSTALL.md#smart-features-cli-bridge-beside-the-server)).

**The sparkle.** Every way into a model carries the four-pointed sparkle (`Sparkle` in
`Icons.tsx`, filled, in the accent): Ask in the Search box and the palette, Describe it,
Suggest tags, the Report's "In words", Fix song info's Suggest, a model's guesses in a
review, a model's names under an import row, Tidy up's "Fill them in", and the Smart
features heading. An Ask answer kept in Home's recents or
named as Up next's source carries it too. A press with a sparkle asks a model; one without
only searches, sorts or edits.

---

## How a feature is built

The industry has settled on a short list of shapes for putting a model inside a product
(Anthropic's *Building effective agents* is the clearest write-up): a single structured call;
a **workflow**, where code fixes the steps and the model fills some of them; and an
**agent**, where the model decides the next step in a loop with tools. The advice that
holds up is to use the simplest one that does the job, because every step up costs
latency, money and testability. Almost every feature here is a workflow; `explore` is the
one agent.

```
                  ┌──────────── deterministic, testable, free ────────────┐
request ──▶ build context ──▶ model call ──▶ check ──▶ fetch/filter ──▶ model call ──▶ check ──▶ proposal
            (budgeted)        (schema'd)     (grounded)                 (only if needed)
```

### The pieces (`apps/server/src/ai/`)

- **`llm.ts`, the port.** One function: `generate({ task, tier, system, prompt, schema })`
  returns a value that has passed the zod schema, and the time taken. The schema is sent as
  JSON Schema in `response_format`, and the reply is parsed and validated again on our
  side, because "the model was asked for JSON" is not "the model returned valid JSON". An
  invalid reply gets one repair turn (the validation error goes back to the model) and then
  fails cleanly. A call may also offer `tools` (run on the server, six rounds unless the
  task says otherwise, and `budgetMs` of time), ask for `webSearch`, and carry a `signal`
  that drops it once nobody is waiting. Requests to one endpoint pass a gate
  (`SELFMP3_AI_CONCURRENCY`, 2), so the calls a pipeline or a tool makes at once queue in
  the server, first come first served, not inside cli-bridge where the wait would count
  against their timeout. A task may ask for its JSON as text (`json: 'text'`: the schema in
  the system prompt, `response_format: json_object`), which through cli-bridge writes about
  half the output tokens of a `json_schema` and avoids the CLI's hidden re-ask (measured
  2026-10-27: route p50 3.6 → 2.8 s); the route, the plans and explore do. `effort` goes as
  `reasoning_effort`, `low` for the fast tier unless a task says. Quick tasks wait 30 s (route,
  plans) and picks 60 s rather than the settings' 240. The log line carries each call's
  requests and tokens (in, out, cached), so a retry nobody asked for shows. No SDK: it is one
  `fetch`, like the server's other outbound calls.
- **Tasks.** Each model call is a task with four parts kept side by side: a *system prompt*
  that never changes between requests (so a provider can cache it), a *context builder*
  that chooses what the model sees, an *output schema*, and a *check* that grounds the
  output (every id and tag must be one it was shown). Prompts are versioned constants in
  the code, not strings assembled at run time.
- **Orchestration is plain TypeScript.** No agent framework: the steps are a function that
  calls tasks and services in order. That is the part that is easiest to test and to
  read, and frameworks mostly add indirection over exactly this.
- **Cache.** A task's answer is kept in memory against a hash of its exact input, so
  opening Suggest tags twice costs one call, and an unchanged library gives the same
  suggestions instead of a fresh roll of the dice.
- **Logs.** Task, model, milliseconds, attempts, and the rounds and tool calls when there
  were any; a reply that did not fit is logged with what was wrong. Never the prompt or the
  reply: they hold your library, and cli-bridge keeps the same rule (it logs route, status
  and timing only).

### Not over-fetching: the context ladder

The model is shown the least that answers the question, in this order, and a step is only
climbed when the one below cannot answer:

1. **What the fields mean** (static, in the system prompt): the rule fields, what energy
   0–1 feels like, that bpm is unreliable for rubato music, what a year range means (an era,
   "old songs" against the library's own spread, never "just added"), the tag naming conventions.
2. **The library's shape** (about 1–3k tokens): each tag with its song count and the
   artists and albums it mostly holds; the size of the library; ranges of tempo and energy;
   the years songs came out, by decade; the artists, and the albums of two songs or more.
   An album is a place like an artist, so "jukebox songs" lets in every song on Jukebox
   with no pick: a pick sees at most 300 songs, sampled from a big library, and lost some.
   This is how "a few Genshin ones" becomes the tag 原神纯音乐 without the model ever
   seeing a song.
3. **A candidate table**: only the songs that survived the deterministic filter, capped by
   a token budget, one compact line each (`#12 | title | artist | album | year | tags | energy |
   bpm | length | words | plays`, and `sound 87` when the songs are in the order they sound). Rows are numbered `#1…#n` for this call instead of carrying uids:
   shorter, and a number outside the table is caught by the check.
4. **One song in depth** (its lyrics, say): only for a feature about one song. None built
   here climbs to it.

### Tools, skills, MCP: where each fits

- **Tool calling** (the model asks for a fetch, sees the result, decides the next one) is the
  right shape when the next fetch depends on what the last one found and the number of
  steps is not known, which is what makes an agent. Most features are not like that: what
  Describe needs (rules, maybe a title keyword) can be **planned in one structured reply and
  executed by the server**. That is the same capability as a tool call, at one round trip
  instead of several. Round trips matter here: each one is 2–5 s through cli-bridge.
- The one feature that does loop is **`explore`** (Looking things up, below). The loop lives
  in our runner (`llm.ts`) and speaks OpenAI's own `tools` together with `response_format`,
  so it depends on no vendor's agent runtime. cli-bridge also accepts `mcp_servers` and
  `max_turns`, which would let Claude Code run the loop itself; nothing here uses them, and
  they are refused for `gemini-*` models.
- **The loop** (`llm.ts`): the calls of one reply run one after another in the order the model
  wrote them, so a later call can use what an earlier one made, and a plan of several steps
  costs one round (cli-bridge returns several tool calls in one reply). A call that fails
  (wrong arguments, a set that does not exist, an id it was never shown) goes back as that
  call's result, `{"error": …}`, for the model to read and correct; only a stop is thrown.
  After its rounds or its `budgetMs`, the tools are no longer offered (`tool_choice: none`) and
  the model answers with what it has. The log line names the tools called and how many failed.
- **The tools** (`askTools.ts`) are Ask's pipelines with typed arguments, over one request's
  **working set** (`workingSet.ts`, AGENT-DESIGN 2.2): named lists of songs. It starts with
  `playing` (the song playing), each earlier answer's handle (`t2.1`, what it showed) and
  `screen` (the answer on their screen); a tool that finds songs keeps them under a name the
  model gives (`as`). Every argument that takes songs is a scope, `{ set, pick, ids, filters }`:
  a set, places in its list (1 for the first, counted in code by `scope.ts`'s `atPlaces`, the
  same as a router's handle and picks), ids, and filters over them. Ids are only ever ones the
  model was shown in a result or that a set holds. A song list comes back compact: the set's
  name, count and minutes, its first 30 rows `id|title|artist|album|year|tags|energy|len|plays`
  (and why, when a pick said), names it did not know with the nearest the library has
  (`unmatched`), and the condition that left none (`emptiedBy`); nothing is loosened behind its
  back.

  | Tool | Wraps | Model inside |
  |---|---|---|
  | `find_songs({as, scope, text, title, artist[], album[], tags[], notTags[], energy, bpm, year, words, lyrics, loved, playedWithinDays, notPlayedWithinDays, addedWithinDays, sort, order, limit, offset})` | `groundPlan` (other names, script fold, a slip), `songsFitting`, lyrics search, `sortSongs`; every condition must hold | none |
  | `count_by({scope, by: artist/album/tag/year, limit})` | `creditedArtists` with joined names: a song counts once per artist | none |
  | `listening({range, about: songs/artists/tags/totals, limit, scope})` | `stats(range, top)`, up to 100; a scope adds up its own songs' plays | none |
  | `lookup_names({kind: artist/album/tag/playlist, query})` | `normalizeForMatch` + other names + `editDistance` | none |
  | `pick_by_taste({as, from, brief, sound, count/minutes, like, avoid})` | `narrowAndPick` over the scope; an empty pick is an empty set and its notes | smart |
  | `find_half_remembered({as, terms, brief})` | `halfRemembered.ts` (the find action's) | smart |
  | `propose_tags({as, request, scope, limit})` | `tagReview` over the scope; the review is kept under `as` | smart |
  | `propose_names({as, what: checkup/change/spellings/fill/copies, request, lookUp, scope, limit})` | `tidy`, `oneSpelling`, `fillGaps`, `findCopies`; kept under `as` | smart / fast |
  | `album_tracks({albums: [{album, artist}] ≤8})` | 网易云 album search + track list, each track matched with `haveTrack` (`getMusic.ts`): how many, which are theirs, which they lack | none |
  | `catalogue({words})` | 网易云 song search | none |

  Each description is written as general instructions (no sample requests), and each answer
  is bounded: 30 rows, 100 groups, 20 proposal lines, 60 track titles, 24k characters at
  most. The tools return data for the model; what the person sees is built by the caller
  from the sets and proposals left behind. Nothing writes.
- **Skills** are Claude Code's packaging of instructions loaded on demand. The equivalent
  here is a task's own system prompt, which is already loaded only by its task.
- **MCP** is the right way to let *other* assistants (Claude Desktop, Claude Code) ask
  questions of your library. That would be a server feature of its own: a read-only MCP
  endpoint on the server. It is not how the app's own features talk to the model.

### Testing

- Every task runs in tests against a scripted fake model and a fixture library, so a test
  says "given this reply, the proposal is this" and runs offline.
- The checks are tested directly with the replies models really get wrong: a song number
  outside the table, a tag that does not exist, a rule on a field that does not exist,
  an empty pick.
- The model's judgement itself (does "calm piano" give calm piano?) is an eval, not a unit
  test. The eval harness (`apps/server/src/ai/eval/`, AGENT-DESIGN 4) asks the real endpoint
  whole conversations about a fresh, migrated copy of a real library, in process and wired
  the way the server runs (`smartFeaturesFor`, with nothing remembered between turns), and
  replays every follow-up the way the app sends it: the earlier turns with their objects and
  the answer on the screen (`beforeTurn`, `answerRecap`, `objectsOf`, in packages/shared so
  the app and the harness send the same). Each answer is checked in code (`checks.ts`: its
  kinds, how many songs and minutes, the share of them a SQL condition over the copy lets
  in, a count the database gives exactly, names, order, a follow-up acting on the songs it
  pointed at, latency and model calls) and read by a judge (`judge.ts`, a strong model on
  the same endpoint, one call per conversation: did it do every part, does it match the
  library, does it say what it couldn't). `report.ts` writes
  `<results>/<date>-<sha>-fast-<model>.smart-<model>.jsonl` with a summary beside it (pass
  by class and by check, latency p50/p95, calls per turn, judge score) and how it moved from
  the newest earlier run with the same models, regressions first:
  `npx tsx apps/server/src/ai/eval/run.ts --fast sonnet --smart sonnet --judge opus` (also
  `--only <ids>`, `--class <classes>`, `--repeat N`, `--concurrency N`, 2 by default as the
  Pi's cli-bridge takes, `--against <results file>`, `--db`, `--cases`, `--endpoint`).
  The cases and the library stay outside the repository, being a person's music (by default
  `~/ask-eval-selfmp3/cases/*.json` and `prod.pristine.db`, which is only read); the
  repository's own `example.cases.json` shows the format and `run.test.ts` runs it against
  a scripted model. A case is turns with `text`, the song `playing` by title, the `screen`
  (the newest list by default for a follow-up), `expect` and a `judge` sentence saying what a
  right answer is with the facts it needs. Before its numbers are trusted the judge is held
  to a person's verdicts on earlier answers (`--calibrate <labels.json>`, `calibrate.ts`).
  One question of one feature, printed for a person: `--one describe "calm piano"` (also
  `ask`, `tags`, `tidy`, `written` and `import <rows file> ["list name"]` for Names at
  import, a row a line as `title | artist | album`; "fill in what's missing" and "which
  songs do I have twice" go through `ask`). On a hub the database is a workspace's,
  `<data>/accounts/<id>/selfmp3.db`.
- The task tests of the newer features (`fill.test.ts`, `copies.test.ts`,
  `importNames.test.ts`) put their scripted replies behind a fake HTTP endpoint
  (`endpointLlm` in `fixtures/library.ts`), so `llm.ts` parses and checks them as it would a
  real one's; `routes/ai.test.ts` runs Names at import through the real server and a model
  on a free port.

---

## S1 · Ask in the Search box

The one box for most of it: Home's search bar and the sidebar's Search on a computer (the
command palette), the Search page on a phone. Letters stay a search, matched on the device
as you type; nothing is sent anywhere until you ask. Three letters or more add an **Ask**
row (`askable`): first when nothing matched, so ↵ asks (`asksOnEnter`); after the matches
otherwise, so ↵ still opens what was typed in the palette, and on the Search page only puts
the keyboard away. A match is a word start or a run of letters
([lyrics-plus.md](lyrics-plus.md), "Search by name"), so a mood typed whole ("calm evening")
matches nothing and Ask leads, on both layouts, with no "Nothing matches" line under it; the
tags some of the words name ("calm") are listed after it, and do not count as a match. A
place named exactly what was typed leads the results, so "calm" opens the tag (D1,
2026-10-25; `matchCount`, `placesOf` in `search.model.ts`). Asking opens the Ask page
(below), so the box keeps only what you typed and Back finds it there.

### The Ask page

`/ask?q=…` (`smart/AskScreen.tsx`). It is a workbench (Xiao picked S1, 2026-10-27, from a
third canvas round, after the chat column of 2026-10-24 — A1 B2 C1 D1 E1 F1 — the split of
A2 that still left a chat column floating in an empty window until a list arrived, and R1's
stage, whose answer sat against the page's left edge while its field sat in the middle).

On a computer the page is two parts. On the left, a 360 pane a step up from the ground: a
log of what was asked, one line each, the newest last — the question, and under it what
came of it (`logLine`: "14 songs · YOASOBI & 幾田りら", "5 songs · Ballads",
"2 name changes to look over", the start of what was said), with the list's covers or a
spinner beside it — and the field at the log's foot, under the conversation it continues.
On the right, the answer you're on, always filled: a reply that is one list is the list
itself (the answer's page, `AnswerView`, with the question as its title in the serif and the
list's own name in the line under it); words stand beside the songs they name, in a card of
their own (`AnswerBody` `beside`), wrapping under them on a narrow window; anything else is
drawn as that kind of answer always is (`AnswerBody.tsx`), up to 1100 wide; and while it is
worked on, the question and its steps stand where the answer will be. The newest answer is shown
as it is asked; pressing a line of the log shows that one. The log follows the
conversation: a new question, the answer shown and the field growing under it each scroll
the line they are about into view, and scrolling back through it is left alone.

On a phone the log is a page of its own. A question opens its answer full screen, as R1's
stage drew it (the question in the middle with the step running now while it works), and
its ‹ comes back to the log; the log's ‹ leaves Ask. Every turn stays drawn, hidden when it
is not the one shown, so a question still being answered is not given up by looking at
another.

The field floats with 24 under it on a computer (12 on a phone): "Ask a follow-up…", or on
a list, the list's chip, "↳ these 19 songs" (Follow-ups, below): what "these" means, and
nothing more. While a turn is worked on its send is the one
Stop, which takes that turn off the page and puts its words back in the field. ‹ goes back
to Search, and the conversation is not kept after it (so there is no "new chat" button);
the page drawn again any other way finds its turns as they were (`askThread.store.ts`). A
list played next, or asked for a room, keeps its card, whose button says what it does; the
card opens the answer's page. A
question over 500 characters is not sent: the field stops there, and one from Search says
it is too long. An answer that failed says why when the server said ("Your server couldn’t
reach the model.", with Open Settings where Settings can help); Try again is worked on as a
new turn is, with its Stop, and the next question waits for it. A failed turn stays failed
until Try again: nothing that asks the model (an Ask turn, a change, the Report's few
sentences, Suggest tags, an import's names) is retried, asked again when the network comes
back, or swept up with what is asked again when the server answers once more
(`ASKS_MODEL`, `connection/refetchFailed.ts`). Each ask costs the model, and asked again
behind the person's back a failed "skip this song" had come back half an hour later as a
list of sixteen songs. On a phone the page owns the display, as Search does; on a computer
it opens in the main column, and the palette's Ask row closes the palette and opens it.
Asked while Search adds to a room (`?to=room`), song answers go to the room. A review's keys
work from the field while it is empty.

Reviews in an answer (Xiao picked R3 T1 S1, 2026-10-24): nothing in an answer scrolls
on its own. A review is a card (`Review` with `card`): up to five changes whole, a
longer one its first three and "Review all", which opens the whole list on a sheet with
the buttons at its foot, ticked as one with the card. The model's own words are drawn as
the answer above it (T1; tidy's `reply` used to sit among the grey notes); grey is only
the app's small print, under the rows. Done with (Fix, Close, Not now), a proposal says
what came of it ("Fixed 31 songs", "Closed. Nothing changed."), and the turn keeps the
model's words and that line (S1), which the next follow-up is told too. An answer you play
from stays as it is.

**A reply holds several cards** (AGENT-DESIGN 2.4, `AskReply`): `say`, a few words of its
own or null, and `cards`, one to four in the order the request asked for them ("10 calm
songs, then tag them 夜" is a songs card and a tags card). Every route that answers Ask sends
the reply: `POST /api/ai/ask`, and `GET /api/ai/ask/progress?answer=1` for one collected by
its ticket. The router still chooses one action, so today's replies are that action's one
card and no words of its own; the agent (Stage 5) will send several through its `respond`
tool. The page draws a reply as one column (`AnswerBody`): its words, then each card in
order. With more than one card each sits under a quiet heading of what it is (`cardHeading`:
"Songs to play", "Tag changes", "To remember"), tone on tone as the cards always are, so the
reply reads as parts of one answer rather than a chat. A list among other cards is its card
(`SongsAnswerCard`): pressing it opens the list on the stage in the cards' place, on a
computer and a phone alike, and its ‹ comes back to the cards. Each card is settled on its
own: a review done with folds to what came of it while its siblings stay; only the first
review still open takes the keys; the log's line has a part for each card ("6 songs · 周杰倫
at night + 1 tag change to look over"), what came of one in its place.

A list does what the words led with (Xiao, "Play now, rest proposes", 2026-10-27): asked to
play — a list, one song from one, "play it" — it starts playing as it comes, once however
often it is drawn again, as a playback answer is carried out (`usePlayAsItComes`); in a
reply of several, only its first list asked to play does. Asked to keep ("save it as
Morning"), its head leads with one **Save as “Morning”** that makes the playlist of exactly
the songs shown, and as a card among others, its card's Save does (`useSaveAnswer`). Adding
to a playlist, tags and names stay proposals, each with its one button.

**A question back** (`clarify`) is a card of its own, always a reply's only card: a question,
and up to three options in the asker's language. Each option is a button that asks its words
as the next turn, as if typed (`ClarifyAnswer.tsx`); the field is there for any other answer.
It replaced the old dead-end answer and its suggestions (2026-10-27).

Words answers (`explore`, `open`, a reply's `say`, a question back) can be selected in part:
on iOS they are a read-only system text view (`ports/selectableText.tsx`), since a
selectable `Text` there copies only the whole; `explore` also has Copy for all of it.

A song an answer names (`AnswerSongLine`) plays from ▶; while it is the song playing, its
row is marked as Library's rows are (the cover's colour washing in from the right, the
title in its tint, the equaliser over the cover) and ▶ is a pause inside a ring that fills
as the song goes (Xiao picked A1 B1 C1, 2026-10-24). Pressing the playing row opens Now
Playing; seeking stays there.

Asking is a **router** (`apps/server/src/ai/ask.ts`, `POST /api/ai/ask`): one call (fast
tier) reads the request against rung 2 and chooses one action from a fixed list, filling in
what that action needs, as JSON. Then the action runs as code.

The list is a **registry** (`ai/askActions.ts`, `ASK_ACTIONS`). Each entry has a name, a
`when` paragraph telling the router when to choose it and what to fill in, its own fields
(a schema, or none when the request itself is all it needs), whether it reads Describe's
filters (`required`, `optional`, `unused`), and `run`.
The router's prompt (`routeSystem`) and the form the model fills (`routeForm`) are built
from the list, and the router's own code is the same for every action: route, run it. When
the chosen action is missing its fields or its required filters, the router is asked once
more, told what it left empty, and may choose its way out and say what it needs in the
language of the newest words; still missing, the answer says what could not be told. The
router's way out (the last choice in its form, never a card) becomes a question back (`clarify`): its
sentence the question and the requests it offers the options; with none to offer it is only
its words (an `explore` card with no songs, `instead` in `askLibrary.ts`). The route
is not remembered: the same words are read again, so Try again can come out differently. The
router sees each playlist with its kind, and a live one's rules in words ("live, holds songs
tagged 中文流行", `rulesWords`). In a follow-up, the answer is written in the language of the
newest words, whatever the earlier turns used.
Adding an action is adding an entry. The form is one object with every action's part, the
ones not chosen null, rather than one shape per action, because that is what an
OpenAI-style `json_schema` endpoint takes reliably. An entry is the shape a tool has
(name, description, parameters), so a model that calls tools can be handed the list as it
is: what would change is the loop, not the actions.

| Action | The words | What runs | Second call |
|---|---|---|---|
| `songs` | "play something calm for reading", "make a playlist of…", "play my 20 most played"; after a list, "play the 3rd one", "save it as Morning", "more like the 2nd one" | Describe's steps 2–3 (the route *is* the plan); with an order (`sortBy`), the first songs in it, sorted in code (`songsInOrder`); with `from`, exactly the songs an answer showed, none picked; with `like`, ordered by how close they sound to that song | the pick; none for an order alone or for songs shown |
| `change` | after a list: "not 晴天", "10 首", "calmer" | the songs named taken out (`drop`), or Change it's refine (`refine.ts`) from what the list understood, the songs that still fit kept; it keeps its lead and the song it sounds like | none for a drop; the refine plan |
| `reply` | "why is 大海 in here" | the router's own sentences, from what was shown (each song's why is in the prompt), with the songs it is about | none |
| `playback` | "skip this song", "go back", "pause", "play the last song in Up next", "play the third song in the queue" | the device carries it out on its own player (Controlling what plays, below) | none |
| `find` | "the song about grandma's tea" | its terms, in every language the library uses, matched against titles, artists, albums and the lyrics index; when none of yours is it, `explore` instead, so a song you don't have is told about rather than a dead end | a pick of at most 5 |
| `tags` | "tag the songs that should be 中文流行", "merge j-anime into jpop", "tidy my tags", "tag these 夜" | the tag review, with the request itself and the songs `from` names (Tags, below) | the plan, then the groups |
| `stats` | "what did I play most last month", "top 20 artists" | the stats the Stats page shows, as many as asked (ten unless a number is said, fifty at most); the model only chose the window, what about and how many | none |
| `library` | "how many YOASOBI songs do I have", "my longest song" | Describe's filters over the library, counted and sorted in code (`askLibrary.ts`) | none; for a meaning, every song judged (`songsThatAre`) |
| `tidy` | "any songs with wrong metadata?", "give the 原神音乐 songs their official Chinese names, albums too", "fill in what's missing", "do I have any song twice?" | a checkup: Tidy up's rules and its names pass; a change they say: the filters choose the songs (A4, "Asked for something"); what is missing looked up (A4, "Filling in what's missing"); songs held twice (A4, "Copies") | the names pass, one call per 60 songs, or a call only where the catalogues or the copies need judging |
| `playlistSongs` | "add the YOASOBI songs to gym", "take the slow ones out of chill", "sort genshin calmest first", "add these to gym" | the filters choose the songs, or `from` names them; a sort is code; a live playlist is answered with its rules | a pick only when the words go past the filters |
| `remember` | "from now on, Chinese names only" | a card that saves the note (Remembered preferences, below) | none |
| `playlists` | "delete the chill playlists", "rename hi to 华语慢歌" | the names matched to yours (Playlists from the box, below) | none |
| `explore` | "which albums do I have only part of" | the model looks things up with tools (Looking things up, below) | the tool loop |
| `getMusic` | "download 春泥棒", "get the rest of the Liyue OST" | 网易云 searched, what you already have marked (Getting music, below) | none |
| `open` | "where do I paste a Spotify link", "take me to my stats" | a sentence and a button to the place | none |
| *(way out)* | anything else | a question back (`clarify`): what the box can do instead, and up to two requests it can do, each a press away; or only the words when nothing comes close | none |

Each action's answer is one card of the reply, of the kind it names (`playback`'s is
`playback`, `reply`'s and the way out's with nothing to offer are `explore`, `change`'s is
`songs`); `clarify` is the one card no action makes but the way out.

Every card is a proposal with its own button (`AnswerBody.tsx`): a song answer is a card
with ▶ that opens as its own page (docs/features/lists.md, "Ask's song answer"), the tag
review's Apply, Open Stats, a found song to play, Play these. The one exception is
`playback`, which is done as it arrives.

A dead end is not one: the way out is a question back whose options are at most two requests
in the asker's language that the box can do and that come closest ("tag the good ones" →
"tag the songs that should be 中文流行"). Each is a button that asks its words.

While it works, the wait says what is happening (`ai/progress.ts`): the device names its
request with a `ticket` and asks `GET /api/ai/ask/progress` twice a second, and the server
answers with the stages so far in plain words and real numbers — "Read what you asked",
"67 songs fit", "Choosing 25 that suit it"; for a half-remembered song "Looking for … in
titles and lyrics", "Choosing the one you mean"; for Tidy up "Reading the names of 1,340
songs". The answer itself still comes back as one response. Measured on the real library:
a route 2.3–3.5 s; with the pick, a playlist in 10 s and a found song in 5 s.

An Ask outlasts its connection (`outlast` in `ai/progress.ts`, `askKept.ts` on the device). A
phone sent to the background loses the connection though nobody stopped asking, so a closed
connection no longer stops the model: the work goes on for as long as the device asks after
the ticket within a minute, and its answer or failure is kept under the ticket. The device
collects it with `GET /api/ai/ask/progress?answer=1` when its response was lost, or when the
server has said it is done and the response is late. Stop, new words and a closed box send
`POST /api/ai/ask/stop`, which stops it at once.

## Playlists from the box

"Delete the chill chinese hype and chill chinese playlists", "rename hi to 华语慢歌": the
router's `playlists` action. The model is shown the playlists' exact names and copies the
ones meant; the server matches each against them (`matchPlaylist`: spacing, dots and case
ignored, a slip or two forgiven, a tie or nothing near is no match), so a misspelling finds
the playlist and no invented name ever reaches the device. The answer
(`smart/PlaylistsAnswer.tsx`) lists them by name with their songs, each ticked; the red
button is the confirmation; the message after it has Undo, which makes each one again with
its name, its songs in their order, and its tags to fill from. A rename shows old → new and
undoes to the old name. Playlists only: deleting a tag strips it from songs, which is not
undone as simply.

A playlist's songs are the `playlistSongs` action (`ai/askLibrary.ts`): add, remove or sort
one manual playlist, found by `matchPlaylist` too. Add and remove choose their songs with
Describe's filters — among the library's songs not in it, or among its own — and when the
filters say it all, every song they let in is the answer, ticked, with no second call. Words
the filters cannot say ("the ones named for rain", "the ones that aren't game music") go to
Describe's pick over the songs that pass them, waiting with the sparkle; nothing is loosened,
so a remove never reaches past what was asked. A sort is code (`sortSongs`: a song without
the value, never analysed or never played, goes last either way). A live playlist fills
itself from its rules, so nothing is proposed for it: the answer says what it holds,
and for an add whether the songs meant are in it already ("All 17 of those songs are in chill
· chinese already: it holds songs tagged 中文流行") or how many are not; when it follows tags,
it is a question back whose option is the tag change that would put them in ("give the
songs by 五月天 the tag 中文流行"), which the `tags` action proposes. Taking songs out is only said, never offered as a
press: the tag taken off would take them out of the tag's page and every list following it
too, more than the request reached for. A sort says the order its rules keep. The device (`PlaylistSongsAnswer.tsx`)
checks against the playlist as it is now — an add keeps songs not in it, a remove the ones
still in it, a sort keeps a song added since at the end — and Undo puts back the songs and
their order (a remove's Undo adds them, then restores the whole order).

## Questions about your library

"How many YOASOBI songs do I have", "what did I add this week", "my longest song", "who is
in 中文流行": the `library` action. The router fills Describe's filters (none for the whole
library, `size` for how many to list) and what to show — a count, the songs, or their
artists, albums or tags — with an order when the words ask for one. Everything after is code
(`libraryAnswer`): the count and length, the first songs in order, who, which albums and which
tags they are in, most songs first (fifty of each), and how many different artists, albums
and tags there are (`distinct`), so "周杰伦的专辑我有几张" heads "18 albums · 76 songs". A song
counts for everyone its credit names, joined spellings as one, as the library's artists do:
"陈致逸, HOYO-MiX" is a HOYO-MiX song too. `stats` stays the listening; this is the library.

A question by meaning ("how many love songs do I have") cannot be counted in code, and a pick
from a sample is not a count. The filters let songs in, then a model judges every one of
them, 150 rows a call, the calls at once (`songsThatAre`, task `ask-judge`), and the ones it
says are it are counted. Past 600 songs an even spread of 600 is judged and the count is
scaled up: the answer's `judged` says how many of how many were read, and the card says
"about" and that it is an estimate.

Music to play in an order the library knows ("play my 20 most played", "the newest 30") is
the `songs` action with `sortBy` and `order`, as a library question has: the songs the
filters let in are sorted in code and the first ones played, as many or as long as asked,
with no pick. Words only a model can judge are judged among the first 300 in the order, and
what it chooses keeps the order.
On the real library: YOASOBI 31, added this week 719 (the Genshin import), the longest one
song of 1,337.

## Lengths

"2 小时", "half an hour" is `minutes`, never turned into a number of songs by the model:
songs differ in length, and "an hour is about 15 songs" made two hours of ninety-second
Genshin pieces thirty songs, fifty-four minutes. The server sizes the pick by the fitting
songs' own average length, asks the model once more for the rest when it stops short, makes
up anything still missing from the fitting songs in the table's stable order, and leaves
off a last song that runs well past. Change it does the same with the songs already there
kept: "扩展到2小时" after 40 minutes keeps them and fills the rest.

While an answer is on its way after every stage is done, the wait says "Getting it ready"
rather than looking finished.

## Change it

A song answer can be changed in words after it is given — "10 首", "不要动漫的", "calmer".
On the Ask page that is the page's one field, said about the list on the screen ("↳ these 19
songs", B1, 2026-10-26; never cut short, and "this song" with "Ask about it…" beside it
for a list of one), where Ask decides it is a change; on the answer's own page it is a field under its head
(`smart/ChangeIt.tsx`, "Change these songs…"). No suggested changes are offered: what to
say is yours (Xiao, 2026-10-04).

`POST /api/ai/refine` (`ai/refine.ts`) gets what was first asked, the filters as they stand,
the change, and the songs shown. One fast-tier call returns the filters changed, everything
the change did not touch kept. The songs shown that still fit stay in their places, and only
the rest is picked (Describe's step 3, around them), so "10 首" after two songs keeps those
two and adds eight. A change to the brief is a change of taste and picks again from the
start. Its stages report through the same ticket as Ask's.

Said in Ask's field, a change is a follow-up like any other (Follow-ups, below): the router
reads it with the list as the screen's object and chooses `change`, which runs this same
refine on the server from what the list understood (sent back in its object), or takes out
the songs named by their places and keeps the rest untouched. The changed list keeps what
the list was for: an Up next list stays Up next, still ordered by how close the songs sound to
the song it was asked to sound like. Its answer is a turn of its own, kept beside the one it
changed (`smart/answers.store.ts`), so an earlier line of the log shows the list as it was. On
the answer's own page the field itself says what is happening while it works, in the same
place, so nothing moves; when it lands, the list there is the new one (Different songs does
the same). Until 2026-10-26 a song card in Ask had its own Change it under it, beside the
page's field, and a trail of versions above that; until 2026-10-27 the chip sent the words
straight to `/api/ai/refine`, so "play the 3rd one" or "add these to gym" came back as the
list changed (Xiao's "Ask decides").

## Looking things up (`explore`)

For a question the fixed actions can't put as filters ("which albums do I have only part of",
"what is Liyue called in Chinese, and do I have it"), and any question about music itself
(a song, an artist, who sang it), the router chooses `explore`
(`explore.ts`), the first user of Ask's tools (Tools, skills, MCP, above). The model gets the
library's shape, the sets the request came with (`playing`, earlier answers' handles,
`screen`) and the tools that look: `find_songs`, `count_by`, `listening`, `lookup_names`,
`pick_by_taste`, `find_half_remembered`, `album_tracks` and `catalogue`, not the ones that
propose. At most 6 rounds and 120 s of looking; the call also asks the endpoint for web
search (`web_search_options`). Its system prompt says how sets and scopes work and to plan
the calls a question needs into one reply when none needs another's result first. About
music itself the model answers from what it knows as well, saying when that is from memory,
and says whether you have it. The answer is a few sentences and the songs it is about, as
ids and/or a set's name; every id is checked to be one it was shown or a set holds. "Which
albums do I have only part of" reads the albums' track lists (`album_tracks`), which the old
three tools could not.

## Getting music (`getMusic`)

"把千岩旷望剩下的歌下载了", "download 春泥棒" route to `getMusic`: the router gives the words to
search a catalogue for and whether it is an album or a song (`getMusic.ts`). 网易云 is searched
(`cloudsearch/pc`, albums or songs); for an album each of the first four is read song by song,
and each song counts as yours when one of your songs is the same recording with the same title
(`sameRecording` + `sameTitle`: an album holds many songs by one artist of about one length, so
the artist alone would count wrongly). The card lists them ("40 songs · you have 4"), and
Import opens with the one chosen (`/import?url=`), whose review shows what you have and finds a
song 网易云 only previews on YouTube instead. No model call beyond the router: 3–6 s.

## Searching the web

Part of smart features, with no switch of its own (Xiao, 2026-10-24: smart features on means
the model may look things up). Two things may search: `explore` (the call carries `web_search_options`), and the names pass for songs no
catalogue has, a second model call per 15 songs with web search (at most 150 songs), whose
names are the model's and wait unticked, with a note saying the web was searched. The
endpoint does the searching: cli-bridge runs Claude Code's WebSearch and WebFetch for that
request only; an endpoint without web search ignores the option. Tried 2026-10-04: an
explore question took 26 s and said where its answer came from.

## Remembered preferences

"From now on, Chinese names only" routes to `remember`, a card that saves the note when you
press Remember (`smartNotes` in the settings, at most 30). Every Ask after carries them under
the request (`withNotes` in `ask.ts`: "Their standing preferences (follow them unless these
words say otherwise)"), so the router and the action read them. Settings › Smart features lists
them, each with Remove.

## Follow-ups

Whatever is typed in the Ask page's field is a new turn, asked after the conversation
before it (`AskRequest`): `before`, each earlier question with what was shown for it
(`AskTurn`), and `context`, the song playing and the answer on the screen. What was shown is
told per reply (`answerRecap` in packages/shared `askTurns.ts`): its own words, then a line for each card
in order — a words card its words, a list or a review a line the device writes ("Offered 12
songs (“…”) to play now", "Proposed 8 name changes: …"), a question back what it asked and
offered, a playback card what it came to on this device ("Nothing is playing.") — and what
came of each proposal done with ("Then: Fixed 31 songs; Closed. Nothing changed.").

What a reply showed goes back as **objects** (`AskObject`, AGENT-DESIGN 2.1;
`objectsOf`), one for each card that showed songs: a handle, `t3.2` for the third turn's
second card (the turn's place on the page and the card's in its reply, so it stays the same
however many turns are sent), a kind and a label, its songs by the server's
ids in the order shown (at most 200) with each one's reason, and for a list what it was for
(`lead`), the song it sounds like (`like`) and what it understood as it stands now. The
server keeps no conversation: the device already holds the ids (`answers.store`, which keeps
each songs card as an answer of its own, and `askKept`), and a list changed or moved on its
page is sent as it is now. The chip on a list ("↳ these 19 songs": the list on the stage, or
a reply's first list) puts its card's handle in `context.screen`; its ×, or ⌫ in the empty
field, lets it go, and the words are asked with nothing on the screen. Any other answer that
showed songs is the screen's while it is shown.

The server sets the turns out and asks for the newest (`followed` in `ask.ts`: "Earlier in
this conversation: They asked … You answered … It showed: t1.1", then each object with its
songs numbered, at most 40 rows, the screen's first, "On their screen now: t2.1", and "Now
they say …"). The router answers by handle: every action that takes songs has a `from`
scope — a handle and places in its list, 1 for the first, or `playing` for the song playing
— resolved in code (`scope.ts`, `scopeOf`) to songs the library has, so an id the device sent
that is not one of them, or a place past the list's end, names nothing, and a handle that
names nothing is said rather than the whole library used. `songs` with `from` is exactly
those songs, to play, keep or queue; `like` is the song to sound like; `change` changes a
list; `reply` answers from what was shown; `tags`, `tidy`, `library` and `playlistSongs`
look at those songs and no others. A long conversation sends only its newest eight turns
(`ASK_BEFORE_MAX`), and the one on the screen wherever it is. Replies are written in the
language of the newest words. Until 2026-10-24 only the earlier questions were sent, as one
request to "answer all of it together"; until 2026-10-27 lists went back as ten titles, so a
follow-up re-derived its songs from filters and "the second one" could not be found.

A tidy answer that changes nothing still answers: the model says which song it took them to
mean and why it stays (`say`, kept as `reply`, two sentences at most), above "Nothing to change
in N songs", so a request about one song the model could not name for certain does not
read as no answer at all.

## L2 · New playlist, kind first

New playlist (`NewPlaylist.tsx`) offers three kinds before anything is typed: **Pick
songs**, **Live, from tags**, and **Describe it** when Ask is on. Describe it takes what you
want to hear, then a name that starts as those words, then runs Describe and shows its picks
(`SongsAnswer`, with the name). The other two are ordinary playlists
([lists.md](lists.md), "New playlist").

Following an artist is not offered: a playlist follows tags only (`follows.model.ts`), and
"calm songs by Yorushika" is a description.

## A1c · Describe a playlist

The pipeline under New playlist's **Describe it** and under the box's `songs` answer. You write what you want; you get
back what it understood, as chips, and the songs it picked from inside them, each with a
reason. What is made is an ordinary playlist of the picks; when what was understood is tags
and nothing else, it can instead follow those tags and keep itself filled, which is the
one kind of rule a playlist here follows (`follows.model.ts`).

What it understood is an `Understanding` (`packages/shared/src/schemas/ai.ts`), not the Live
rule set: places widen (any of these tags, artists or albums) and everything else
narrows (energy, tempo, the years it came out, words, loved, when played or added). A Live rule set is all-or-any
and cannot say "古典 or 原神纯音乐, and calm".

1. **Plan** (fast tier). Shown rungs 1–2 of the ladder and your words. Returns the parts,
   a name, how many songs you asked for if you did, a **sound**: how the music should sound,
   in English, for the listening model ("calm orchestral music with strings and flute";
   [audio-intelligence.md](audio-intelligence.md#how-songs-sound)), and a **brief**: whatever
   in your words the parts and the sound cannot say ("named for rain", "songs about leaving").
   A mood, an occasion or an activity goes in the brief as well as the sound, since the
   listening model hears instruments and style but cannot tell what suits a gym or a rainy
   day; so does a quality every song must have when the words keep only some of a place's
   songs. Energy is set only for a level asked for outright: it measures how loud and dense
   a recording is, and kinds of music sit far apart on it (in Xiao's library, 82% of 中文流行
   is above 0.68 against a library two-thirds orchestral), so a mood read as energy kept one
   kind and shut out the rest ("rainy day vibes" answered 25 Genshin pieces, 2026-10-27).
   The check spells each tag, artist and album the library's way: case ignored; the same
   once Chinese is folded to pinyin, so 周杰伦 is 周杰倫 and 米津玄师 is 米津玄師; an artist's
   other names ("Jay Chou"); or a Latin name one letter off ("Yorushka"). The last three only
   when a single name answers. Names the library does not have are set aside, and the answer
   lists them; a name found under another spelling never is.
2. **Narrow** (no model, `songsFitting`). Nothing fits: the narrowing parts are let go one
   at a time, in a fixed order (tempo, energy, words, the years, the time windows, loved, left-out
   tags), until something does, and the answer says what was let go. Places are never let
   go. A song not analysed yet does not pass an energy range, so a request about unanalysed
   songs loosens the energy and leaves "slow" to the pick.
3. **Listen** (the listening model, no language model), only when the plan has a sound, or
   the router says they want music like the song playing (`like`): the songs that fit are
   put in the order they sound like it, best first. Over the whole library (no tags or
   artists asked for) a sound also keeps only the songs within 0.06 of the best match, so
   "violin songs" with six violin pieces answers six, not those six and nineteen near
   misses; songs not heard yet cannot be vouched for and stay out. Inside the tags, artists or albums
   asked for it only orders: they already chose the songs, and the line drawn from one best
   match left "比较温和的jpop" with one song of a hundred jpop. There the songs within the
   line are marked `close` in the pick's table, and the pick cuts by them when the brief
   says every song must have the sound ("only the ones with erhu"), and only orders by them
   when it does not. Steering from a song only orders. Nothing else in Ask touches the
   listening model.
4. **Pick** (smart tier), only when there is a brief or more songs fit than were asked for
   (25 when not said). With a sound and no brief — the words only say what it should sound
   like — the best-sounding are taken as they are, with no call. Otherwise shown your words,
   the brief, the sound and the candidate table (rung 3, at most 300 rows: the best-sounding,
   when there is a sound, with a `sound` column 0–100; a sample otherwise). Returns songs by
   row number, each with a reason of a few words. The check keeps only numbers in the table,
   drops repeats, and stops at the size asked for. Choosing none is an answer, not a failure:
   no songs, and a note that none of those that fit suited the brief (until 2026-10-27 it
   was "The model's answer didn't make sense", and asking again drew the same table).
5. **Answer**: the parts as applied, how many songs fit, what was let go, what the library
   lacks, the picks with reasons, and `notes`: whatever else made the songs fewer than fit —
   the sound's line over the whole library, resting songs left out, 25 standing in for a
   number nobody said, or why none were chosen. The answer page lists them under its head;
   a card with no songs says them in place of "No song of yours fits that".
   Fewer songs than the size asked for, or under nine tenths of the length, the device
   says in so many words (`describeNotes`): "Only 1 song, not the 15 you asked for: just 2
   fit."

Taking a chip away does not read the words again: the page picks again at once, sending the
parts back, and only steps 2 to 4 run.

## Tags: your tags put right

Your tags as changes to approve: songs given a tag or taken out of one, a tag renamed,
merged into another, or deleted (`ai/tagReview.ts`). Two ways in: Ask, with what you said
("tag the songs that should be 中文流行", "take ipop off what isn't Japanese", "merge
chinese pop into 中文流行", "tidy my tags"), and `Tags › the untagged card › Suggest
tags`, which is the same review aimed at the songs without a tag (`GET
/api/ai/tags/untagged`). It replaced A7's own pipeline and the router's old `tag` action,
which could only tag songs the request named and answered "tell me which ones" otherwise
(Xiao, 2026-10-04).

1. **Plan** (smart tier, Ask only): the tags with what each holds, the artists, and the
   request. It returns renames, merges and deletes; the tags in question (`focus`); a tag
   to make, if the request names one you lack; which songs to look at against the focus
   (`without` it, `with` it, `all`, `untagged`, `none`); the artists named, if any; and
   whether this is a checkup ("tidy my tags": every tag, spellings of one tag, artists
   tagged more than one way). Ask sends the song playing along, and the plan's `from` says
   when the request points at it ("tag this jpop") instead of describing songs: then that
   song, and no other, is looked at (`ai/scope.ts`, the handle the agent's working set will
   extend to earlier answers' songs). Nothing playing is said, never the whole library
   instead. Before, "tag this one 粤语" with 白玫瑰 playing proposed five 刘德华 songs.
2. **Ask the library first** (no model). A song with no tag takes the tag every tagged
   song on its album shares, or the one four in five of its artist's tagged songs share
   (two at the least); a tagged song missing a tag every other song on its album carries
   (two others at the least) gets it; in a checkup, two tags spelled as one ("J-POP",
   "jpop") merge the smaller into the bigger. Only tags in question count.
3. **Group** (no model) what is left by main artist, the tags the songs carry, and the
   script of the title, so 周杰倫 is judged once rather than 76 times and 林俊傑's English
   songs apart from his Mandarin ones. A group lists every song, numbered, with its album; a
   group past 40 songs goes in parts. A checkup looks only at songs without a tag and at
   artists tagged more than one way.
4. **Ask the model** (smart tier) about the groups, at most fifty groups and 400 songs to a
   call, four calls at once: for each group that should change, tags to add and tags to
   remove, how sure, and why in words that do not name the artist (one reason speaks for a
   row of many artists). Where one artist's songs differ in what the script does not show,
   it answers for some of the group's songs by number, once per set that changes
   differently; each song takes the first answer about it. Before, all 17 of 陈奕迅's songs
   were one block, Cantonese and Mandarin alike, and went "unsure" together.
5. **Check**: tag names must be yours and in question, an add must be missing and a remove
   carried, a rename must not take a name in use, one change to a tag itself per tag, the
   only new tag is the one the request named (or, for untagged songs, one the library's
   own pattern calls for). A change the model was not sure of is listed as left alone;
   for untagged songs, so is a group no tag fits.
6. **Answer**: one row per (change, tag, who found it), with its songs, who they are by,
   and the reason that covers the most of them.

**How many.** A number they give ("tag 5 of my untagged songs") is the filters' `size`, the
"how many" every action reads: the router fills only that for `tags`. The review then
changes that many songs at the most, the library's own answers first and the model's after,
a song already in kept in a second change too; the model is not asked at all when the
library has placed enough. The note says "Kept to 5 songs, as you asked. Ask again for more."

The device draws it with `TagsReview.tsx` over `Review.tsx`, the list Tidy up's review
uses too: what the library found starts ticked, the model's guesses wait with the
sparkle, an add or a remove opens to its songs and any can be left out, ⌘↵ applies. A
short card's line opens to its songs too ("白玫瑰 and 16 more → 粤语" is seventeen songs
ticked), and a tidy row's new name has a line of its own under the old, so a long old name
never pushes it out of sight on a phone.
Everything on it is one count (`tagCounter`, X4 2026-10-25): songs, once each, when every
change puts a tag on songs or takes one off — the title ("Tags for 5 songs"), what is
ticked, each band and section, "Review all 5" and the button ("Tag 3 songs") — and changes
when a tag itself is renamed, merged or deleted ("2 changes to your tags", "Make 2 changes").
"7 changes", "4 ticked" and "Apply 4 changes" over three rows had read as three numbers.
Applying is ordinary edits in order (`tagSteps`, `useTagChanges`): new tags, songs in and
out, renames, then merges (the songs get the tag they go into, live playlists following
the merged tag follow that one, then it is deleted) and deletes. The toast's Undo takes
each back, a deleted or merged tag returning with its name, colour, songs and followers.

Without a model, the untagged songs still get what the library says, with a note.

## A4 · Tidy up (names)

Asked for in the Search box ("any songs with wrong metadata?"; the router's `tidy` action);
Library has no button of its own for it. The song names that look wrong, each as a change to approve: a field, what
it is struck through, what it would be, and how many songs. Nothing writes until Apply,
which is one ordinary edit per song (`POST /api/songs/bulk/edit`, on the server and on a
cloud replica alike), so it syncs and undoes like an edit made by hand.

1. **Rules** (no model). A name twice in one credit ("薛之谦, 薛之谦, 薛之谦"); the video's
   words in a title ("(Official Music Video)", "【MV】"); the artist in front of a title
   ("YOASOBI - 祝福"); an English translation after an original name ("オリオン - Orion",
   keeping a "(feat. …)" after it); a note on where the song was used after its name
   ("有点甜 (《萌三国》网游主题曲|《微微一笑很倾城》电视剧插曲)" → "有点甜", `withoutUseNote`, also
   applied at import). Xiao chose the original name over the bilingual one.
2. **One model call** (smart tier) over names only, never titles: the artist names with
   counts, the credits that list more than one, the albums with their artist. It returns
   two spellings of one artist, classical credits that list a long-dead composer as a
   performer, and album names with stray punctuation.
3. **Check**, in code, because the model's judgement wandered between runs: every name it
   returns must be one it was shown; a respelling must point at a name the library already
   uses, and the two must be able to be one name (one holds the other, different scripts,
   or a letter or two apart: "Jura Margulis" is not "Vitaly Margulis"); between scripts it
   always points at the artist's own (ロクデナシ over Rokudenashi).
4. **Answer**, grouped by (field, from, to, why) across songs; the device keeps only songs
   whose field is still what the change says, so an approval never overwrites an edit made
   since. Rule-found changes start ticked; the model's carry the sparkle and wait for a yes.

Without a model the rules still answer, with a note saying what was left out. On the real
library (1,342 songs) a pass takes about 7 s and finds about 40 changes.

A checkup also counts the songs missing an album, a year or a cover (`gaps`), each and in
all, and the review says so under its list ("3 songs have no album, 10 no year and 2 no
cover.") with **✦ Fill them in**, which asks "Fill in what's missing" in the same box. The
count is code and free; nothing is looked up until it is pressed.

**Asked for something.** The router's `tidy` part says whether the words only ask for a
checkup. When they say a change ("give the 原神音乐 songs their official Chinese names, albums
too"), the steps above don't run: the filters choose the songs, which go to the model with
the request itself, 60 songs a call (title, artist, album, album artist; an album's songs
side by side so one call names the whole album), four calls at once, up to 2,000 songs. Each
edit must name a song in its batch, once per field, with a value a song may have; they group
like the checkup's, all the model's, so none starts ticked. A batch that fails is left out and
the note says how many songs; when every batch fails, the answer is the model's failure.

What the model says goes above the changes only when it agrees with them: the words of the one
batch that changed something, or, when nothing changed, why; with several batches changing,
the card speaks alone. A reply written in other letters than the request (Chinese to an
English request) is dropped (`inTheirLanguage`): shown a table of Chinese names, the model
once answered an English request in Chinese, saying "no Yorushika here" above the change it made.

**Which songs, for every `what`.** The router's `from` says when the request points at the song
playing ("this title is wrong"): then that song is the only one, for a change, a checkup,
copies or a fill. Otherwise the filters choose; a checkup with filters ("fix the names of my
孙燕姿 songs") checks those songs alone, and places asked for that the library lacks are the
answer ("Your library has no …"), never the whole library standing in. Before, that request
ran the library-wide checkup and offered ZUTOMAYO's titles.

**One artist under two names.** `what: spellings` ("some artists are in there twice under
different names, fix that") can't go by batches: the two names are seldom in one. Code groups
the library's artist names first (`nameGroups`): the same letters once case and marks are set
aside, a Chinese or Japanese name and a Latin one its stored spelling matches (ヨルシカ,
"yorushika"; あたらよ, "atara yo"), and a name among another's other names, saved or found.
The model sees those groups alone, a few songs each, eighty to a call, and answers which names
are one artist and which to keep; every name must be one of its group's, a name kept is never
itself replaced. The changes are to `artist` and `albumArtist`, credit by credit. Before, the
request went 60 songs a call over the whole library (43.7 s) and fixed Yorushika but not
Atarayo.

**Which songs, and how many.** A number they give ("先换 300 首") is the filters' `size`, the same
"how many" every action reads (up to 2,000; a playlist's pick still stops at 200). Which of the
chosen songs still need the change ("the ones in English now") is no filter: when the songs are
more than that number, or more than one batch are about to be looked up, a fast model call per
200 songs reads their names with the request and keeps the ones the change is still to be made
on, keeping a song whenever it can't tell (and a whole batch it can't answer). The number is
counted from those, in album order, and the note says how many are left for asking again.

**Names from the catalogues.** The router's `lookUp` says when the new names must come from
outside the library ("official Chinese names", an album's real name). Then each song is looked
up first (`names.ts`): 网易云's search (`cloudsearch/pc`; its names are the publisher's, often in
two languages: "丹砂巍巍 Wordless Cliffs"), and MusicBrainz and iTunes for a song 网易云 lacks. An
entry counts only as the same recording: within 3 s of the song's length, not marked a cover
(翻自, 翻唱, cover), and with its title or an artist in common; when some entries have the song's
artist, only those (Yorushika is ヨルシカ there, so a title match alone must still count). A song
nothing is found for is not sent to the model and the note counts it. The model sees each
song's found names and shapes one the way the request asks (one language of a bilingual name,
no "原神-" prefix); an edit whose words are in no found name is dropped, and the rest are `by:
'rule'` with "The name on 网易云" as why, so they start ticked under "From the catalogues". Looked
up names are kept a day per song. Tried on 2026-10-04 with the real model on six Genshin songs: 5
found, 10 changes (丹砂巍巍, 隙光浮影, 蔚蓝一梦, 璃月, 梦之咏叹 and their albums), the made-up one
left alone.

**Filling in what's missing.** The router's `tidy` part says `what`: `checkup`, `change`, `spellings`,
`fill` or `copies`. "Fill in what's missing" (and "the missing years of my YOASOBI songs",
the filters choosing the songs) is `fill` (`ai/fill.ts`): the songs missing an album, a year
or a cover, an album's songs together, the first 40 of them a request (MusicBrainz answers
one request a second; the note says how many are left for asking again). Each is looked up
in every catalogue at once (`listingFinder` in `names.ts`): 网易云's search for an album and
its cover, iTunes and MusicBrainz (the metadata lookup, [metadata-polish.md](metadata-polish.md))
for those and the year. Only listings that are the same recording count, by the rule names
use (`sameRecording`: within 3 s, not a cover, a title or an artist in common).

Where the listings agree on a field, that is the answer and no model is asked. Where they
differ — the single, its album, a collection years later — one smart-tier call per 25 songs
is shown each song and its listings, numbered, and answers which listing each missing field
comes from, or none; it judges which release the recording belongs to from what it is shown
and knows. It never writes a value: a number that is no listing, or a field the song has
already, is dropped. A cover follows the album: the picture of a listing on the album the
song has or is given, never a picture from another release. Each fill is a change like the
names', from nothing (`from: ''`, the year as its digits and the cover as the picture's
address, `tidyValue` in `packages/shared/src/tidy.ts`), "From iTunes" and so on as its
reason; what the listings agreed on is `rule` and starts ticked, what the model chose
waits with the sparkle. The device draws a fill as what it adds — the name, the year, or
the cover itself — and applies the album and year as the ordinary edit and each cover
through the server, which downloads it as Fix song info does (`useTakeCovers`). Undo puts
back exactly what was there: it empties the album and year again, and has the server take
each cover it took in off again (`DELETE /api/songs/:id/cover`, server-only like
apply-metadata), since a fill only fills a cover that was missing; a cloud library sees the
song without a cover from the server's next snapshot, as it saw the cover arrive. Without a model only what the catalogues agree on is offered, with a
note. Tried 2026-10-14 through a local model: 夜に駆ける got iTunes' single, its year and
cover; 晴天 got MusicBrainz's 2003; 3.6 s for the call.

**Copies.** "Do I have any song twice?" is `copies` (`ai/copies.ts`), an answer of its own
(`kind: 'copies'`). Code finds the songs that might be one recording, among the songs the
filters chose: the same title once a video's words ("(Official Music Video)") and an English
translation after it ("恋風 - Koikaze") are set aside, an artist in common — an artist's other
names count, saved or found, so Lilas meets 幾田りら — and within 3 s; or, between songs the listening model has heard, within a
second and sounding the same (0.97 or closer, [audio-intelligence.md](audio-intelligence.md))
whatever they are called. A title with words the other lacks ("(Live)", "(Bayan)", "(II)") is
another version unless the sound says otherwise, and only songs on one album or none count,
or a single and an album within 2 s of each other (a single is an album named as its song):
one recording kept on two albums — a theme on two soundtracks, a song and its best-of — is
kept on purpose, but a song released alone and then on its album is the same release twice.
Before, 恋風 by 幾田りら (its single) and "恋風 - Koikaze" by Lilas (Laugh, 1.5 s longer) were
never looked at. Both are code because the model, judging, wandered: shown "Liyue" and
"Liyue (Bayan)" on one album with nothing else, and two soundtracks' theme sounding the same,
it called both copies. Songs with nothing between
them (the same names, album and length to the second) are copies without a model. The rest go
to the model, 30 groups a call: every song's title, artist, album, year, length, file, when
added, plays, and how close it sounds to the group's first; it answers which songs in each
group are one recording held twice, and a live take, an arrangement or a second part ("(II)")
stays. Which copy stays is code's: the most plays, then loved, then the most tags, then the
bigger file, then the first added.

The device's review (`CopiesReview.tsx`, over `Review.tsx`) lists each song with the copy kept
("Keeps one · THE BOOK · 4:21 · 12 plays") and opens to the extra copies, each with its album,
length and plays; exact copies start ticked, the model's wait.

Deleting an extra copy loses nothing of it: it is folded into the copy kept first
(`POST /api/songs/merge`, answered by the server and by a device's own copy of the library
alike; the `songMerged` change in [SYNC.md](../SYNC.md), "How changes combine"). Its tags,
love and places in playlists go to the kept copy (never twice in one playlist), its plays add
up, and an album, a year, a track number, a cover, the words or the link the kept copy lacks
are filled in from it, never written over. Then it is gone as a removal is. On a signed-in
device the fold is a change in its log, done at once there, and the server, reading the log,
moves the copy's play history too, so Stats and the bucket's plays files count those plays
under the kept song; a play of the copy that arrives late lands there as well. So Delete
asks once (`FoldCopies`), saying what moves and that the file is deleted, without the "can't
be undone" a plain delete carries.

A fold made cannot be taken back, so it is not sent until its Undo has gone, as an email
client's undo-send (`showPendingToast` in `ui/toast.ts`). The dialog's Delete takes the extra
copies out of the library drawn on the device at once and says "Deleted the extra copy; its
plays and tags are on the one kept" with Undo; Undo, within the toast's five seconds, asks for
the library again with nothing written. The fold is sent when the time is up, or at once when
the app is leaving — a phone sent to the background, a tab or window hidden or closed
(`sendPending`, `ports/appLeaving.ts`). Sending it then, rather than keeping the intent to
send at the next launch, is the choice: on a signed-in device the fold is a write to its own
copy of the library and its log, quick enough to finish as the app goes, where a kept intent
would be replayed later against ids that a rebuilt library may have given other songs. A
library refetched within those seconds shows the copies again until the fold lands. Tried
2026-10-14 through a local model: 夜に駆ける / Yoru ni Kakeru and アイドル / "アイドル (Official
Music Video)" called copies; with every song's sound the same, Dream Aria / "Dream Aria (II)"
and Liyue / "Liyue (Bayan)" left as versions.

## A9 · Clean names on import

The two Tidy up rules that describe how mess arrives are applied where an import row is made
(`toProbedTrack` for YouTube, the 网易云 listing): each name once in a credit, and the
original title without the English a channel writes after it. They live in
`packages/shared/src/titles.ts` beside the video-title tidying, so import and Tidy up can
never disagree about what a clean name is. The row is still shown in import review, where
it can be edited before anything downloads.

**The model's part.** What rules cannot see — a title and an artist the wrong way round, a
channel's name standing in for the artist, words about the upload left in a title, an album
the list's name gives — the model reads (`ai/importNames.ts`, `POST /api/ai/import/names`).
When Import's review opens (`useImportNames`), every row coming in is sent once with the
list's name: title, artist, album and length, 60 rows a fast-tier call, at most 300. It
answers only the rows whose names look wrong, with the title, artist and album each should
have and why in a few words. Every name is grounded as Fix song info's card is: each part of
it must be in that row's own words or the list's name, or the field stays as it was; a title
or an artist is never emptied, an album may be. So a suggestion moves and trims words and
never makes a name up, and a translation is never offered.

Under such a row (`ReviewRows.tsx`, a phone's row and its open card, a computer's grid row
alike) a line says the names with the sparkle, why, and **Use**, which renames the row as
typing would. The line is there only while the row's names are still the ones the model read,
so one fixed by hand, or taken, has none. The rows asked about are the review as it first
showed, never each letter typed; off in Settings, no model, or a failure all mean no lines,
and the review is the review it always was. Tried 2026-10-14 through a local model on six
rows: "【中日字幕】打上花火 - DAOKO × 米津玄師" by "Music Channel" → 打上花火 by DAOKO × 米津玄師;
"Yorushika" by "ただ君に晴れ" swapped round; 夜に駆ける, Lemon and "Track 3" left; 9 s. A
title that was the artist's name ("米津玄師" by "Lemon") was left as it was until the prompt
said to judge each row with what it knows of the artists, not only how the words are laid
out; then it was turned round too.

## A8 · Steer Up next

Ask while a song plays: "something calmer like this next", "more like this after". The
Search box sends the song that was playing when it was asked (`playing`, the server's id,
translated with `useSmartServer().onServer`), and the router is shown it as a table row
under "Now playing", so "this" has an artist, tags, energy and tempo. Its `next` flag leads
the answer as **Up next**: Describe's pipeline as usual, with the playing song described to
the pick too, the playing song left out of the picks, and ten songs unless a number is said.
The card's button is **Play next**, which puts them right after the playing song
(`playNext`), so nothing that is playing stops; Add to Up next, everywhere else, adds at the
end. Without a song playing there is nothing for them to come after, so `next` plays them
now, as "play …" does.

Measured on the real library: about 10 s, "calmer" read as an energy range under the
playing song's.

## Controlling what plays

"Skip this song", "go back", "start this again", "pause", "carry on", "play the last song in
Up next", "play the third song in the queue": the router chooses `playback` and fills an `op`
(`next`, `previous`, `restart`, `pause`, `resume` or `upNext`) and, for `upNext`, a `place`
in Up next counted the way the words did, 1 for the first and -1 for the last. The server
never sees the queue: the answer is only what was asked for, and the device that asked finds
the song in its own Up next (`playbackAnswer.model.ts`). An `upNext` with no place is said
("Say which song in Up next to play").

It is the one answer carried out without a button (`PlaybackAnswer.tsx`, through
`usePlayerCommands()`), since it is what the buttons beside the music already do, and a line
says what was done: "Skipped to the next song.", "Back to “晴天”.", "Playing “群青”, the last
in Up next.", or why nothing was ("Up next has only 3 songs.", "Already paused.", "Nothing is
playing."). It runs once per answer, however often the answer is drawn again. Next and
starting again are the player's own commands, so they keep the music playing or paused as it
was. Going back is the song before in the queue, never this song from its start — by the time
an answer comes back the song is past the three seconds after which the Previous button
restarts it — and going back, like a song in Up next, plays the song it lands on.

## Listening together

"Start a room", "open a jam with some upbeat songs" and "songs for the room: something chill"
make the router choose `together` (docs/features/listen-together.md). When the words say what
music, it fills the filters and the songs are picked as Describe picks them. When they only
ask for the room, there are no filters and no songs. The answer is `{ kind: 'together',
describe }`, the same whether or not the device is in a room, because only the device knows
that.

The device (`TogetherAnswer.tsx`) draws the songs as a card that opens the answer's page,
beside one button:

- out of a room, **Start a room**. It opens Together starting with those songs, or empty, so
  nothing starts until Start is pressed;
- in a room, **Add to Xiao's room**, or **Open the room** when no songs were asked for.

An empty room's **Ask for songs** opens Search with *Songs for the room:* typed in, and the
rest is yours to say.

## A5 · The Report in words

The Report (`/stats/report`, opened from Stats or Profile), under the page: "✦ In words",
three to five sentences about the period,
with **Write it again**. The server writes the Report's numbers as plain facts (hours
beside minutes, the hour as "3 pm", the weekday by name, so the model never has to work
anything out) and the model writes from those alone (`GET /api/ai/written`). With the server
away, or with no model set up on it (`ai_off`), the card is not drawn at all.

What it wrote is checked, sentence by sentence, and a sentence that fails is dropped, not
mended: every number in it must be one of the facts' ("1,342" and "14th" read as numbers),
and every run of Chinese or Japanese must appear in the facts exactly. The second rule is
there because the model once wrote 原神纯音乨 for the tag 原神纯音乐, which no number check
sees. On the real library across a week, a month and a year, one sentence in fifteen was
dropped. The answer is kept per set of facts, so the page costs one call until the plays
change or Write it again is pressed.

## Fix song info · Suggested

A song's Fix song info shows iTunes' and MusicBrainz's listings, each a whole set of names
to take or leave. The Suggested card at the head of them is the model reading them: the
song's names, its file's name, the link it came from, those listings, and the names 网易云
(then MusicBrainz and iTunes) give the same recording (`catalogueFinder`). It answers the
names the song should have, which listing it follows, and one sentence of why
(`ai/fixSong.ts`, `GET /api/ai/songs/:id/metadata`). Picked, it is a listing like the
others: its changes are ticked, each can be unticked, and Apply is the ordinary edit.

Grounded as Tidy up is: every name in the answer must be found, part by part, in one of
those sources (`within`), or it is put back as it was and named under the card ("left
title as it was"). A year must be a listing's. The cover is the followed listing's. So a
suggestion can choose the wrong one of the names on offer, but cannot make one up.

It runs when Suggest is pressed, and by itself when nothing matched on iTunes or
MusicBrainz — where 网易云's listing is often the only one there is. One call on the smart
tier, remembered against its exact question; Ask again asks afresh. Standing preferences
("Chinese names only") go with it.

## Settings › Smart features: one switch

One switch, kept in the server's settings: "Use smart features" (`smartFeatures`, on by
default), which says what leaves the library at all ("Song names and tags only. Never
audio."). It covers every feature on this page: Ask (with New playlist's Describe it and Up
next), Tidy up, Suggest tags, the Report in words, Fix song info's Suggested card, names at
import, and searching the web. With no model set up on the server the switch is dimmed and
its hint says "Your server has no model set up." What Ask remembers is listed under it, each
note with Remove, when there are any. Settings reads and writes the switch on the server
itself, reached as Ask reaches it (`useServerApi`): a signed-in device's own copy of the
library keeps no settings. Off, no way in is drawn (`useSmartOn`, which asks the server
presence has already found, so it costs no probe), and the server refuses every smart route
with 403 `ai_disabled` (`allowed()` in `routes/ai.ts`) before any model is asked.
`routes/ai.test.ts` counts the calls a real endpoint on a free port receives: none.

