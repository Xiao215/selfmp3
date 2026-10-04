# Smart features (AI)

What the language model does in self.mp3, how each feature is put together, and why it is
put together that way rather than as a chat window or a free-roaming agent. The screens are
on the AI ideas canvas (<https://claude.ai/artifact/F9yEDvXnGRhgMrVQevHumS>); this page is
the engineering under them.

Built so far: **S1, Ask in the Search box**, which is where most of it is reached; **N1, New
playlist as one field**; the **Describe** pipeline (A1c) they both use; and **A7, Suggest
tags**.

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

On the server, the one process that holds the whole library together with its plays,
lyrics index and audio analysis. A device reaches it the way it reaches the metadata lookup
and the stats (SYNC.md, "Reaching the server for what only it can do"): the screen probes
the server's addresses, talks to the first that answers, and says so in its own words when
none does. Songs come back as the server's ids and the device lines them up with its own
(`useServerSongIds`), exactly as the stats do; tags travel by name, which is unique in every
library. What is made from an answer is made on the device, through the same edits as
everything else (`apps/app/src/features/smart/useSmartServer.ts`).

The model itself is behind one setting: any **OpenAI-compatible chat-completions endpoint**
that accepts `response_format: { type: "json_schema" }`. That is the most widely spoken
format there is, so the endpoint is a swap, not a rewrite:

| Endpoint | `SELFMP3_AI_BASE_URL` | Notes |
|---|---|---|
| `~/UofT/claude-api` (default for this Mac) | `http://127.0.0.1:8787/v1` | Your Claude subscription through the `claude` CLI; 2–5 s per call to start a process; no `tools` |
| Anthropic | `https://api.anthropic.com/v1` | Its OpenAI-compatible endpoint, with an API key |
| OpenAI, OpenRouter, … | their `/v1` | |
| Ollama (nothing leaves the Mac) | `http://127.0.0.1:11434/v1` | Weaker picks; structured output still works |

| Setting | |
|---|---|
| `SELFMP3_AI_BASE_URL` | Unset = smart features are off, and say so where they would be |
| `SELFMP3_AI_API_KEY` | Sent as `Authorization: Bearer …`; optional for localhost |
| `SELFMP3_AI_MODEL_FAST` | Planning and small jobs. Default `sonnet` |
| `SELFMP3_AI_MODEL_SMART` | Picking and judging. Default `sonnet` |
| `SELFMP3_AI_TIMEOUT_SECONDS` | Per call. Default 240 |

The two model names are **tiers**, not vendors: a task asks for `fast` or `smart` and never
names a model, so moving to another provider is three environment variables. Both default
to `sonnet` because of what was measured through claude-api on 2026-10-03: a plan took
3.7 s on `sonnet` and 14–82 s on `haiku` (the CLI's structured output, not the model, is
the likely cost). On a provider billed per token, set the fast tier to its small model.

Measured on the real library (1,342 songs) through claude-api: Describe 8–15 s (plan
4–15 s, pick 4–8 s); Suggest tags 13 s for 111 untagged songs in one call, with every song
given a suggestion.

**Settings › Smart features** shows the address (`GET /api/ai`: scheme, host and path only,
never the key) and the two models, and its **Test** goes the whole way a leg at a time:
this device to the server, timed, then `POST /api/ai/check`, one fast-tier call with a JSON
schema like every feature makes, timed or failed with the endpoint's own words. So "couldn't
reach" always says which leg: the server away, the server older than the app (a 404), or
the model's endpoint down, refusing the key, or over a limit.

**The sparkle.** Every way into a model carries the four-pointed sparkle (`Sparkle` in
`Icons.tsx`, filled, in the accent): Ask in the Search box and the palette, Let it pick,
Suggest tags, and the Smart features heading. A press with a sparkle asks a model; one
without only searches, sorts or edits.

---

## How a feature is built

The industry has settled on a short list of shapes for putting a model inside a product
(Anthropic's *Building effective agents* is the clearest write-up): a single structured call;
a **workflow**, where code fixes the steps and the model fills some of them; and an
**agent**, where the model decides the next step in a loop with tools. The advice that
holds up is to use the simplest one that does the job, because every step up costs
latency, money and testability. Both features here are workflows.

```
                  ┌──────────── deterministic, testable, free ────────────┐
request ──▶ build context ──▶ model call ──▶ check ──▶ fetch/filter ──▶ model call ──▶ check ──▶ proposal
            (budgeted)        (schema'd)     (grounded)                 (only if needed)
```

### The pieces (`apps/server/src/ai/`)

- **`llm.ts`, the port.** One function: `generate({ tier, system, prompt, schema })` returns
  a value that has passed the zod schema, plus token usage and time taken. The schema is
  sent as JSON Schema in `response_format`, and the reply is parsed and validated again on
  our side, because "the model was asked for JSON" is not "the model returned valid JSON".
  An invalid reply gets one repair turn (the validation error goes back to the model) and
  then fails cleanly. No SDK: it is one `fetch`, like the server's other outbound calls.
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
- **Logs.** Task, tier, tokens, milliseconds, outcome. Never the prompt or the reply: they
  hold your library, and the claude-api service keeps the same rule.

### Not over-fetching: the context ladder

The model is shown the least that answers the question, in this order, and a step is only
climbed when the one below cannot answer:

1. **What the fields mean** (static, in the system prompt): the rule fields, what energy
   0–1 feels like, that bpm is unreliable for rubato music, the tag naming conventions.
2. **The library's shape** (about 1–3k tokens): each tag with its song count and the
   artists and albums it mostly holds; the size of the library; ranges of tempo and energy.
   This is how "a few Genshin ones" becomes the tag 原神纯音乐 without the model ever
   seeing a song.
3. **A candidate table**: only the songs that survived the deterministic filter, capped by
   a token budget, one compact line each (`#12 | title | artist | tags | energy | bpm |
   length | plays`). Rows are numbered `#1…#n` for this call instead of carrying uids:
   shorter, and a number outside the table is caught by the check.
4. **One song in depth** (its lyrics, say): only for a feature about one song. None built
   here climbs to it.

### Tools, skills, MCP: why not yet, and when

- **Tool calling** (the model asks for a fetch, sees the result, decides the next one) is the
  right shape when the next fetch depends on what the last one found and the number of
  steps is not known, which is what makes an agent. Neither feature is like that: what
  Describe needs (rules, maybe a title keyword) can be **planned in one structured reply and
  executed by the server**. That is the same capability as a tool call, at one round trip
  instead of several. Round trips matter here: each one is 2–5 s through claude-api.
- The first feature that needs a real loop is **Tidy up** (A4): look at artists, notice two
  spellings, ask MusicBrainz, look again. When it is built, the loop lives in our runner
  and speaks the provider's native `tools` where the endpoint supports it, and a JSON "next
  step" union (`{ call: … } | { done: … }`) through `response_format` where it does not, so
  it never depends on one vendor's agent runtime. claude-api already accepts `mcp_servers`
  and `max_turns` for its own loop; that is an option for later, not a dependency.
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
  test. `apps/server/src/ai/eval.ts` asks the real endpoint about a copy of a real
  library and prints what came back, for a person to read:
  `npx tsx apps/server/src/ai/eval.ts <copy of selfmp3.db> describe "calm piano"`.

---

## S1 · Ask in the Search box

The one box for most of it: Home's search bar and the sidebar's Search on a computer (the
command palette), the Search page on a phone. Letters stay a search, matched on the device
as you type; nothing is sent anywhere until you ask. A sentence, or letters that match
nothing, add an **Ask** row (`askable`): first when nothing matched, so ↵ asks; after the
matches otherwise, so ↵ still opens what was typed. Asking answers in place of the results,
and Esc goes back to them. One request, one answer you act on: a command box, not a chat.

Asking is a **router** (`apps/server/src/ai/ask.ts`, `POST /api/ai/ask`): one call (fast
tier) reads the request against rung 2 and chooses one action from a fixed list, filling in
what that action needs, as JSON. Then the action runs as code:

| Action | The words | What runs | Second call |
|---|---|---|---|
| `songs` | "play something calm for reading", "make a playlist of…" | Describe's steps 2–3 (the route *is* the plan) | the pick |
| `find` | "the song about grandma's tea" | its terms, in every language the library uses, matched against titles, artists, albums and the lyrics index | a pick of at most 5 |
| `tag` | "tag every 周杰倫 song 中文流行" | Describe's filters choose the songs (never the whole library) | none |
| `stats` | "what did I play most last month" | the stats the Stats page shows; the model only chose the window and what about | none |
| `open` | "download the new Yorushika album" | a sentence and a button to the place | none |
| `none` | anything else | what the box can do instead | none |

Every answer is a proposal with its own button (`AskAnswer.tsx`): Play now or Save as a
playlist, Add the tag (after Look through), Open Stats, a found song to play. Measured on the
real library: a route 2.3–3.5 s; with the pick, a playlist in 10 s and a found song in 5 s.

## N1 · New playlist as one field

What is typed decides what the playlist is (`NewPlaylist.tsx`), rather than a name first and
a kind second: letters offer the tags whose names hold them (`matchingTags`), and a tag
picked sits in the field as a chip (Backspace takes it back out); chips alone make a
playlist that follows them, named after them. Any words offer **Let it pick**, which is
Describe, with the chips as the places to pick from; or **An empty playlist** with the
words as its name, which goes on to picking songs by hand. ↵ picks a tag typed in full,
otherwise lets it pick.

Following an artist is not offered: a playlist follows tags only (`follows.model.ts`), and
"calm songs by Yorushika" is a description.

## A1c · Describe a playlist

The pipeline under **Let it pick** and under the box's `songs` answer. You write what you want; you get
back what it understood, as chips, and the songs it picked from inside them, each with a
reason. What is made is an ordinary playlist of the picks; when what was understood is tags
and nothing else, it can instead follow those tags and keep itself filled, which is the
one kind of rule a playlist here follows (`follows.model.ts`).

What it understood is an `Understanding` (`packages/shared/src/schemas/ai.ts`), not the Live
rule set: places widen (any of these tags, any of these artists) and everything else
narrows (energy, tempo, words, loved, when played or added). A Live rule set is all-or-any
and cannot say "古典 or 原神纯音乐, and calm".

1. **Plan** (fast tier). Shown rungs 1–2 of the ladder and your words. Returns the parts,
   a name, how many songs you asked for if you did, and a **brief**: whatever in your words
   the parts cannot say ("sounds like rain", "for reading"). The check spells each tag and
   artist the library's way and sets aside names the library does not have, which the
   answer lists.
2. **Narrow** (no model, `songsFitting`). Nothing fits: the narrowing parts are let go one
   at a time, in a fixed order (tempo, energy, words, the time windows, loved, left-out
   tags), until something does, and the answer says what was let go. Places are never let
   go. A song not analysed yet does not pass an energy range, so a request about unanalysed
   songs loosens the energy and leaves "slow" to the pick.
3. **Pick** (smart tier), only when there is a brief or more songs fit than were asked for
   (25 when not said). Shown your words, the brief and the candidate table (rung 3, at most
   300 rows). Returns songs by row number, each with a reason of a few words. The check
   keeps only numbers in the table, drops repeats, and stops at the size asked for.
4. **Answer**: the parts as applied, how many songs fit, what was let go and what the
   library lacks, and the picks with reasons.

Taking a chip away does not read the words again: **Pick again** sends the parts back and
only steps 2 and 3 run.

## A7 · Suggest tags

`Tags › the untagged card › Suggest tags`. Every untagged song gets a suggested tag where
there is a good one, grouped by tag so 99 songs of Mandarin pop are one decision, not 99.

1. **Ask the library first** (no model, `fromLibrary`). A song takes the tag every tagged
   song on its album shares, or else the one four in five of its artist's tagged songs
   share (two at the least). "The rest of Best of Chopin is in 古典" costs nothing.
2. **Group** (no model). What is left is grouped by main artist (the first name in the
   credit), so the model judges 周杰倫 once, not 76 times.
3. **Ask the model** (smart tier) about the groups left, in chunks, with rung 2 of the
   ladder: what each tag already holds. For each group it returns existing tags by name,
   or one new tag when the library's own pattern calls for one (your regions each have a
   tag; this album is a region's), a reason, and how sure it is. Chunks run in parallel and
   are merged.
4. **Check**: a tag name must be one of yours (or the one proposed new tag, which must not
   collide with an existing name); a group the model was not sure about is left alone and
   listed as such.
5. **Answer**, flipped to what the screen needs: one row per tag, however many groups and
   sources lead to it, with its songs, the reason that covers the most of them, and
   whether the library alone made it. Taking a row is the ordinary "add tag to these
   songs" edit, after making the tag if it is new; Look through lists the songs and lets any
   be left out.

## A4 · Tidy up (names)

`Library › ✦ Tidy up`, or ask the Search box ("any songs with wrong metadata?"; the router's
`tidy` action). The song names that look wrong, each as a change to approve: a field, what
it is struck through, what it would be, and how many songs. Nothing writes until Apply,
which is one ordinary edit per song (`POST /api/songs/bulk/edit`, on the server and on a
cloud replica alike), so it syncs and undoes like an edit made by hand.

1. **Rules** (no model). A name twice in one credit ("薛之谦, 薛之谦, 薛之谦"); the video's
   words in a title ("(Official Music Video)", "【MV】"); the artist in front of a title
   ("YOASOBI - 祝福"); an English translation after an original name ("オリオン - Orion",
   keeping a "(feat. …)" after it). Xiao chose the original name over the bilingual one.
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

## A9 · Clean names on import (rules)

The two Tidy up rules that describe how mess arrives are applied where an import row is made
(`toProbedTrack` for YouTube, the 网易云 listing): each name once in a credit, and the
original title without the English a channel writes after it. They live in
`packages/shared/src/titles.ts` beside the video-title tidying, so import and Tidy up can
never disagree about what a clean name is. The row is still shown in import review, where
it can be edited before anything downloads.

## A8 · Steer Up next

Ask while a song plays: "something calmer like this next", "more like this after". The
Search box sends the song that was playing when it was asked (`playing`, the server's id,
translated with `useSmartServer().onServer`), and the router is shown it as a table row
under "Now playing", so "this" has an artist, tags, energy and tempo. Its `next` flag leads
the answer as **Up next**: Describe's pipeline as usual, with the playing song described to
the pick too, the playing song left out of the picks, and ten songs unless a number is said.
**Add to Up next** puts them right after the playing song (`playNext`), so nothing that is
playing stops. Without a song playing, `next` falls back to the usual playlist answer.

Measured on the real library: about 10 s, "calmer" read as an energy range under the
playing song's.

