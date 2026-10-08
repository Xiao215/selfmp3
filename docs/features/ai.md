# Smart features (AI)

What the language model does in self.mp3, how each feature is put together, and why it is
put together that way rather than as a chat window or a free-roaming agent. The screens are
on the AI ideas canvas (<https://claude.ai/artifact/F9yEDvXnGRhgMrVQevHumS>); this page is
the engineering under them.

Built so far: **S1, Ask in the Search box**, which is where most of it is reached; **L2, New
playlist's Describe it**; the **Describe** pipeline (A1c) they both use; and **Tags**, the
tag review that Ask and Suggest tags share (it grew out of A7, Suggest tags).

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
4–15 s, pick 4–8 s); "tag the songs that should be 中文流行" 12 s over 1,336 songs (route,
plan, two group calls), proposing 99 songs, every one Mandarin or Cantonese pop.

**Settings › Advanced › Model** shows the address (`GET /api/ai`: scheme, host and path only,
never the key) and the two models, and its **Test** goes the whole way a leg at a time:
this device to the server, timed, then `POST /api/ai/check`, one fast-tier call with a JSON
schema like every feature makes, timed or failed with the endpoint's own words. So "couldn't
reach" always says which leg: the server away, the server older than the app (a 404), or
the model's endpoint down, refusing the key, or over a limit.

**The sparkle.** Every way into a model carries the four-pointed sparkle (`Sparkle` in
`Icons.tsx`, filled, in the accent): Ask in the Search box and the palette, Describe it,
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
   0–1 feels like, that bpm is unreliable for rubato music, what a year range means (an era,
   "old songs" against the library's own spread, never "just added"), the tag naming conventions.
2. **The library's shape** (about 1–3k tokens): each tag with its song count and the
   artists and albums it mostly holds; the size of the library; ranges of tempo and energy;
   the years songs came out, by decade.
   This is how "a few Genshin ones" becomes the tag 原神纯音乐 without the model ever
   seeing a song.
3. **A candidate table**: only the songs that survived the deterministic filter, capped by
   a token budget, one compact line each (`#12 | title | artist | album | year | tags | energy |
   bpm | length | words | plays`, and `sound 87` when the songs are in the order they sound). Rows are numbered `#1…#n` for this call instead of carrying uids:
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
as you type; nothing is sent anywhere until you ask. Three letters or more add an **Ask**
row (`askable`): first when nothing matched, so ↵ asks (`asksOnEnter`); after the matches
otherwise, so ↵ still opens what was typed in the palette, and on the Search page only puts
the keyboard away. Narrowed 2026-10-08 (I1): before it, a sentence that matched a song (a
two-word title) went to Ask on ↵. Asking answers in place of the results, and Esc goes back
to them. The box is not held while Ask works: new words drop the question and bring the
results back, and Stop does the same without them. One request, one answer you act on: a
command box, not a chat.

Asking is a **router** (`apps/server/src/ai/ask.ts`, `POST /api/ai/ask`): one call (fast
tier) reads the request against rung 2 and chooses one action from a fixed list, filling in
what that action needs, as JSON. Then the action runs as code.

The list is a **registry** (`ai/askActions.ts`, `ASK_ACTIONS`). Each entry has a name, a
`when` paragraph telling the router when to choose it and what to fill in, its own fields
(a schema, or none when the request itself is all it needs), whether it reads Describe's
filters (`required`, `optional`, `unused`), the Settings switch it sits behind, and `run`.
The router's prompt (`routeSystem`) and the form the model fills (`routeForm`) are built
from the list, and the router's own code is the same for every action: route, fall back to
`none` when the chosen action is missing its fields or its required filters, refuse it when
its switch is off, run it. Adding an action is adding an entry. The form is one object with
every action's part, the ones not chosen null, rather than one shape per action, because
that is what an OpenAI-style `json_schema` endpoint takes reliably. An entry is the shape a
tool has (name, description, parameters), so a model that calls tools can be handed the
list as it is: what would change is the loop, not the actions.

| Action | The words | What runs | Second call |
|---|---|---|---|
| `songs` | "play something calm for reading", "make a playlist of…" | Describe's steps 2–3 (the route *is* the plan) | the pick |
| `playback` | "skip this song", "go back", "pause", "play the last song in Up next", "play the third song in the queue" | the device carries it out on its own player (Controlling what plays, below) | none |
| `find` | "the song about grandma's tea" | its terms, in every language the library uses, matched against titles, artists, albums and the lyrics index | a pick of at most 5 |
| `tags` | "tag the songs that should be 中文流行", "merge j-anime into jpop", "tidy my tags" | the tag review, with the request itself (Tags, below) | the plan, then the groups |
| `stats` | "what did I play most last month" | the stats the Stats page shows; the model only chose the window and what about | none |
| `library` | "how many YOASOBI songs do I have", "my longest song" | Describe's filters over the library, counted and sorted in code (`askLibrary.ts`) | none |
| `tidy` | "any songs with wrong metadata?", "give the 原神音乐 songs their official Chinese names, albums too" | a checkup: Tidy up's rules and its names pass; a change they say: the filters choose the songs (A4, "Asked for something") | the names pass, or one call per 60 songs |
| `playlistSongs` | "add the YOASOBI songs to gym", "take the slow ones out of chill", "sort genshin calmest first" | the filters choose the songs; a sort is code | a pick only when the words go past the filters |
| `open` | "download the new Yorushika album" | a sentence and a button to the place | none |
| `none` | anything else | what the box can do instead, and up to two requests it can do, each a press away | none |

Every answer is a proposal with its own button (`AskAnswer.tsx`): a song answer is a card
with ▶ that opens as its own page (docs/features/lists.md, "Ask's song answer"), the tag
review's Apply, Open Stats, a found song to play, Play these. The one exception is
`playback`, which is done as it arrives.

A dead end is not one: `none` carries `try`, at most two requests in the asker's language
that the box can do and that come closest ("tag the good ones" → "tag the songs that should
be 中文流行"). Each is a button that puts its words in the box and asks them. The ones the
server says in code ("Tags is turned off…") carry none.

While it works, the wait says what is happening (`ai/progress.ts`): the device names its
request with a `ticket` and asks `GET /api/ai/ask/progress` twice a second, and the server
answers with the stages so far in plain words and real numbers — "Read what you asked",
"67 songs fit", "Choosing 25 that suit it"; for a half-remembered song "Looking for … in
titles and lyrics", "Choosing the one you mean"; for Tidy up "Reading the names of 1,340
songs". The answer itself still comes back as one response; a server without the route
leaves the device on its two always-true steps. Measured on the
real library: a route 2.3–3.5 s; with the pick, a playlist in 10 s and a found song in 5 s.

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
the filters cannot say ("from second person", "the ones that aren't game music") go to
Describe's pick over the songs that pass them, waiting with the sparkle; nothing is loosened,
so a remove never reaches past what was asked. A sort is code (`sortSongs`: a song without
the value, never analysed or never played, goes last either way). A live playlist fills
itself from its tags and is answered with that. The device (`PlaylistSongsAnswer.tsx`)
checks against the playlist as it is now — an add keeps songs not in it, a remove the ones
still in it, a sort keeps a song added since at the end — and Undo puts back the songs and
their order (a remove's Undo adds them, then restores the whole order).

## Questions about your library

"How many YOASOBI songs do I have", "what did I add this week", "my longest song", "who is
in 中文流行": the `library` action. The router fills Describe's filters (none for the whole
library, `size` for how many to list) and what to show — a count, the songs, or their
artists, albums or tags — with an order when the words ask for one. Everything after is code
(`libraryAnswer`): the count and length, the first fifty in order, and who, which albums and
which tags they are in, most songs first. `stats` stays the listening; this is the library.
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

A song answer can be changed in words after it is given — "10 首", "不要动漫的", "calmer" —
in one field under its card in Search and under its page's head (`smart/ChangeIt.tsx`). No
suggested changes are offered: what to say is yours (Xiao, 2026-10-04).

`POST /api/ai/refine` (`ai/refine.ts`) gets what was first asked, the filters as they stand,
the change, and the songs shown. One fast-tier call returns the filters changed, everything
the change did not touch kept. The songs shown that still fit stay in their places, and only
the rest is picked (Describe's step 3, around them), so "10 首" after two songs keeps those
two and adds eight. A change to the brief is a change of taste and picks again from the
start. Its stages report through the same ticket as Ask's.

While it works the field itself says what is happening, in the same place, so nothing
moves; when it lands, the words join a trail above the field ("旅途日语歌 → 10首 →
不要动漫的"), the newest fading in, and the field is empty again. Every version is kept
while the app is open (`smart/answers.store.ts`): a name in the trail goes back to it, and
changing from an earlier one lets go of the ones after, as undo does. Different songs on
the page is a version in the trail too. The answer's page shows no trail (Xiao,
2026-10-04): it is the version showing, titled by the list's own name, with the field as
a full-width bar under its head ("Change these songs…").

## Looking things up (`explore`)

For a question the fixed actions can't put as filters ("which albums do I have only part of",
"what is Liyue called in Chinese, and do I have it"), the router chooses `explore`
(`explore.ts`). The model gets the library's shape and tools, run on the server through
`llm.ts`'s tool loop (OpenAI `tools` with `response_format`, at most 8 rounds):
`search_songs` (words in title, artist, album or lyrics; a tag; an artist; an album; a page of
rows with ids), `library_counts` (songs per artist, album, tag or year), and `search_catalogue`
(网易云's search). With Settings' "Search the web" on, the call also asks the endpoint for web
search (`web_search_options`). The answer is a few sentences and the songs it is about; every
id is checked to be one of yours. Tried 2026-10-04 with the real model through claude-api: 9 s
and 17 s, two to three tool calls each.

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

Settings › Smart features › Search the web, off by default (`smartWeb`). On, two things may
search: `explore` (the call carries `web_search_options`), and the names pass for songs no
catalogue has, a second model call per 15 songs with web search (at most 150 songs), whose
names are the model's, unticked, under "Found on the web". The endpoint does the searching:
claude-api runs Claude Code's WebSearch and WebFetch for that request only (its f51efe0); an
endpoint without web search ignores the option. Tried 2026-10-04: an explore question took 26
s and said where its answer came from.

## Remembered preferences

"From now on, Chinese names only" routes to `remember`, a card that saves the note when you
press Remember (`smartNotes` in the settings, at most 30). Every Ask after carries them under
the request (`withNotes` in `ask.ts`: "Their standing preferences (follow them unless these
words say otherwise)"), so the router and the action read them. Settings › Smart features lists
them, each with Forget.

## Follow-ups (every other answer)

Every answer that is not a song answer ends in the same quiet field ("Ask a follow-up…",
`ChangeField` in `ChangeIt.tsx`, drawn by `AskAnswer.tsx`). What you type is asked again with
everything said before it: the request carries `before` (the earlier words, first ask first),
and the server reads them as one request (`followed` in `ask.ts`: "They first asked … Then they
said … Now they say …"), so the router and the action it chooses both see all of it. The new
answer takes the old one's place, which stays on screen until it lands; what was said is a
trail above the field, and pressing an earlier step shows its answer again from the cache. A
song answer keeps Change it, which keeps the songs it already chose. Added 2026-10-04: before
it, a tags or tidy answer that missed could only be asked again from nothing.

## L2 · New playlist, kind first

New playlist (`NewPlaylist.tsx`) offers three kinds before anything is typed: **Pick
songs**, **Fills from tags**, and **Describe it** when Ask is on. Describe it takes what you
want to hear, then a name that starts as those words, then runs Describe and shows its picks
(`SongsAnswer`, with the name). The other two are ordinary playlists (docs/features/lists.md,
"New playlist").

It replaced N1 (Oct 3), one field whose words were a tag, a name or a description by what
they matched, on 2026-10-08: ↵ sent a plain name to Ask, and an empty playlist was the last
and smallest choice. Following an artist is still not offered: a playlist follows tags only
(`follows.model.ts`), and "calm songs by Yorushika" is a description.

## A1c · Describe a playlist

The pipeline under New playlist's **Describe it** and under the box's `songs` answer. You write what you want; you get
back what it understood, as chips, and the songs it picked from inside them, each with a
reason. What is made is an ordinary playlist of the picks; when what was understood is tags
and nothing else, it can instead follow those tags and keep itself filled, which is the
one kind of rule a playlist here follows (`follows.model.ts`).

What it understood is an `Understanding` (`packages/shared/src/schemas/ai.ts`), not the Live
rule set: places widen (any of these tags, any of these artists) and everything else
narrows (energy, tempo, the years it came out, words, loved, when played or added). A Live rule set is all-or-any
and cannot say "古典 or 原神纯音乐, and calm".

1. **Plan** (fast tier). Shown rungs 1–2 of the ladder and your words. Returns the parts,
   a name, how many songs you asked for if you did, a **sound**: how the music should sound,
   in English, for the listening model ("calm orchestral music with strings and flute";
   [audio-intelligence.md](audio-intelligence.md#how-songs-sound)), and a **brief**: whatever
   in your words the parts and the sound cannot say ("named for rain", "songs about leaving"). The check spells each tag and
   artist the library's way and sets aside names the library does not have, which the
   answer lists.
2. **Narrow** (no model, `songsFitting`). Nothing fits: the narrowing parts are let go one
   at a time, in a fixed order (tempo, energy, words, the years, the time windows, loved, left-out
   tags), until something does, and the answer says what was let go. Places are never let
   go. A song not analysed yet does not pass an energy range, so a request about unanalysed
   songs loosens the energy and leaves "slow" to the pick.
3. **Listen** (the listening model, no language model), only when the plan has a sound, or
   the router says they want music like the song playing (`like`): the songs that fit are
   put in the order they sound like it, best first. A sound also keeps only the songs within
   0.06 of the best match, so "violin songs" with six violin pieces answers six, not those
   six and nineteen near misses; songs not heard yet cannot be vouched for and stay out.
   Steering from a song only orders. Nothing else in Ask touches the listening model.
4. **Pick** (smart tier), only when there is a brief or more songs fit than were asked for
   (25 when not said). With a sound and no brief, the best-sounding are taken as they are,
   with no call. Otherwise shown your words, the brief, the sound and the candidate table
   (rung 3, at most 300 rows: the best-sounding, when there is a sound, with a `sound` column
   0–100; a sample otherwise). Returns songs by row number, each with a reason of a few words.
   The check keeps only numbers in the table, drops repeats, and stops at the size asked for.
5. **Answer**: the parts as applied, how many songs fit, what was let go and what the
   library lacks, and the picks with reasons.

Taking a chip away does not read the words again: **Pick again** sends the parts back and
only steps 2 to 4 run.

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
   tagged more than one way).
2. **Ask the library first** (no model). A song with no tag takes the tag every tagged
   song on its album shares, or the one four in five of its artist's tagged songs share
   (two at the least); a tagged song missing a tag every other song on its album carries
   (two others at the least) gets it; in a checkup, two tags spelled as one ("J-POP",
   "jpop") merge the smaller into the bigger. Only tags in question count.
3. **Group** (no model) what is left by main artist, the tags the songs carry, and the
   script of the title, so 周杰倫 is judged once rather than 76 times and 林俊傑's English
   songs apart from his Mandarin ones. A checkup looks only at songs without a tag and at
   artists tagged more than one way.
4. **Ask the model** (smart tier) about the groups, fifty to a call, in parallel: for each
   group that should change, tags to add and tags to remove, how sure, and why in words
   that do not name the artist (one reason speaks for a row of many artists).
5. **Check**: tag names must be yours and in question, an add must be missing and a remove
   carried, a rename must not take a name in use, one change to a tag itself per tag, the
   only new tag is the one the request named (or, for untagged songs, one the library's
   own pattern calls for). A change the model was not sure of is listed as left alone;
   for untagged songs, so is a group no tag fits.
6. **Answer**: one row per (change, tag, who found it), with its songs, who they are by,
   and the reason that covers the most of them.

The device draws it with `TagsReview.tsx` over `Review.tsx`, the list Tidy up's review
uses too: what the library found starts ticked, the model's guesses wait with the
sparkle, an add or a remove opens to its songs and any can be left out, ⌘↵ applies.
Applying is ordinary edits in order (`tagSteps`, `useTagChanges`): new tags, songs in and
out, renames, then merges (the songs get the tag they go into, live playlists following
the merged tag follow that one, then it is deleted) and deletes. The toast's Undo takes
each back, a deleted or merged tag returning with its name, colour, songs and followers.

Without a model, the untagged songs still get what the library says, with a note.

## A4 · Tidy up (names)

Asked for in the Search box ("any songs with wrong metadata?"; the router's `tidy` action) —
Library has no button for it since 2026-10-04. The song names that look wrong, each as a change to approve: a field, what
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

**Asked for something.** The router's `tidy` part says whether the words only ask for a
checkup. When they say a change ("give the 原神音乐 songs their official Chinese names, albums
too"), the steps above don't run: the filters choose the songs, which go to the model with
the request itself, 60 songs a call (title, artist, album, album artist; an album's songs
side by side so one call names the whole album), four calls at once, up to 2,000 songs. Each
edit must name a song in its batch, once per field, with a value a song may have; they group
like the checkup's, all the model's, so none starts ticked. A batch that fails is left out and
the note says how many songs; when every batch fails, the answer is the model's failure. Before
2026-10-04 any names request ran the checkup, and the request itself was never read.

**Which songs, and how many.** A number they give ("先换 300 首") is the filters' `size`, the same
"how many" every action reads (up to 2,000; a playlist's pick still stops at 200). Which of the
chosen songs still need the change ("the ones in English now") is no filter: when the songs are
more than that number, or more than one batch are about to be looked up, a fast model call per
200 songs reads their names with the request and keeps the ones the change is still to be made
on, keeping a song whenever it can't tell (and a whole batch it can't answer). The number is
counted from those, in album order, and the note says how many are left for asking again. Before
this the number was dropped and all 1,120 Genshin songs were looked up for "up to 300".

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

## Controlling what plays

"Skip this song", "go back", "start this again", "pause", "carry on", "play the last song in
Up next", "play the third song in the queue": the router chooses `playback` and fills an `op`
(`next`, `previous`, `restart`, `pause`, `resume` or `upNext`) and, for `upNext`, a `place`
in Up next counted the way the words did, 1 for the first and -1 for the last. The server
never sees the queue: the answer is only what was asked for, and the device that asked finds
the song in its own Up next (`playbackAnswer.model.ts`). An `upNext` with no place is a
`none` ("Say which song in Up next to play").

It is the one answer carried out without a button (`PlaybackAnswer.tsx`, through
`usePlayerCommands()`), since it is what the buttons beside the music already do, and a line
says what was done: "Skipped to the next song.", "Back to “晴天”.", "Playing “群青”, the last
in Up next.", or why nothing was ("Up next has only 3 songs.", "Already paused.", "Nothing is
playing."). It runs once per answer, however often the answer is drawn again. Next and
starting again are the player's own commands, so they keep the music playing or paused as it
was. Going back is the song before in the queue, never this song from its start — by the time
an answer comes back the song is past the three seconds after which the Previous button
restarts it — and going back, like a song in Up next, plays the song it lands on.

## A5 · The Report in words

`Stats › Report`, under the page: "✦ In words", three to five sentences about the period,
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

## Fix metadata · Suggested

A song's Fix metadata shows iTunes' and MusicBrainz's listings, each a whole set of names
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

## Settings › Smart features: a switch per feature

Five switches, shared across devices with the other server settings (`smartAsk`,
`smartTidy`, `smartTags`, `smartWritten`, `smartMetadata`, all on by default): Ask in
Search (which also covers New playlist's Describe it and Up next), Tidy up, Tags (Suggest tags, and Ask's
tag changes), the Report in words and Fix metadata's Suggested card. Each
says what of the library it shows the model, in a line, because "the model sees your
library" is too vague to agree to and each sees less than that. Off, the way in is not
drawn (`useSmartSwitches`) and the server refuses the route with 403 `ai_disabled` before any
model is asked; Ask routing to Tidy up or Tags while it is off answers that it is off.
`routes/ai.test.ts` counts the calls a real endpoint on a free port receives: none.

