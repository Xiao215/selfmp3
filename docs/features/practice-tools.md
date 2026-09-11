# Practice tools

Three things you need when you are learning a part rather than listening to it: loop four
bars, slow them down without the key sliding, and read the key you are actually playing in.
They live together in a **Practice** panel so you are not hunting across the transport bar
with an instrument in your hands.

Open it from the metronome button — in the transport bar on a Mac, in the Now Playing
footer on a phone. Each group inside collapses, so on a phone you can keep the loop open
and fold the rest away.

## A–B loop

Tap **A** where the phrase starts, **B** where it ends. Playback then returns to A every
time it reaches B, until you tap **Clear** or move to another song. With timed lyrics on
screen there is a shortcut: right-click a line on the song's page and choose **Loop this
line**, which sets A and B from that line's timestamps.

Behaviour worth knowing:

- **Taps in the wrong order are fine.** Tap B before A and it is treated as A, since a loop
  needs a start before it needs an end. Set B earlier than A and the two are swapped.
- **A region shorter than half a second is ignored** — that is a click, not a phrase. The
  B tap simply does not take.
- **Pause and seek both survive it.** The guard has nothing to do while paused. Seek
  outside the region and playback continues from there until it next reaches B, then jumps
  back in — which is what you want when you scrub back to hear the run-up.
- **The region is drawn on the progress bar**, as a tinted band with a marker at each end,
  on both the transport bar and the full-screen player.
- **Loading a different song clears the loop.** A region belongs to one song's timeline.
- **A loop suppresses gapless handover and crossfade**, so a loop that reaches the end of
  the file restarts instead of moving to the next track.

### Count-in

Optional: a beat of silence before each restart, so you can breathe and come back in on
time instead of being thrown straight back into the phrase.

The length is one beat at the song's analysed tempo (`features.bpm` — 476 ms at 126 BPM),
or 500 ms when the song has no tempo. Pressing play during a count-in skips the rest of it;
pressing pause cancels it.

### Why an interval and not `timeupdate`

`timeupdate` fires roughly four times a second, so a loop guard hung off it would overshoot
B by up to a quarter of a second — audible, and worse at slow speeds where a quarter second
is a large fraction of a beat. The guard runs on its own 30 ms interval instead
(`LOOP_TICK_MS` in `player/engine.ts`), which keeps the jump back within about 30 ms and
costs nothing measurable. It only runs while both bounds are set.

## Speed, with pitch lock

Chips at 0.5×, 0.75×, 0.9×, 1× and 1.25× — slower than the transport bar's menu offers,
because 0.5× is where a fast run becomes learnable.

**Pitch lock** (on by default) sets `preservesPitch` on the audio elements, so slowing down
keeps the key. It is applied to *both* elements of the dual-element engine, not just the one
playing: the second element is already buffering the next track, and it must not be promoted
with the wrong setting. Safari spelled the property `webkitPreservesPitch` for years, so both
spellings are set.

Turn pitch lock off and speed drags the pitch with it — the panel then says by how much, in
semitones (12·log₂(rate), so 0.5× is an octave down). That is occasionally what you want: it
is how a tape machine behaves, and it is a quick way to hear a part a tone lower.

The setting is remembered per device in `localStorage`, like volume.

## Transpose (display only)

Shows what key the song would be in, transposed up or down by up to an octave — the key
name and the Camelot code. **The audio is not pitch-shifted.** Use it to read the key you
are actually playing in with a capo on the third fret, or transposed for a B♭ instrument.

It needs an analysed key, so run the audio analyser in Settings if the panel says there
isn't one.

### Why audio pitch shift is not implemented

It was scoped and deliberately deferred, because doing it properly conflicts with two things
this player already relies on:

1. **The dual-element engine.** Real pitch shifting means routing audio through Web Audio —
   `createMediaElementSource` on each `<audio>` element, into a phase-vocoder or granular
   shifter, into the destination. Once an element is captured by a `MediaElementSource` it
   can never be un-captured, and its output no longer reaches the speakers except through
   the graph. Every existing behaviour would have to move into the graph too: the
   equal-power crossfade ramp, the gapless handover, mute, the sleep-timer fade. That is a
   rewrite of the engine, not an addition to it.
2. **iOS Safari's AudioContext rules.** A context must be created and resumed inside a user
   gesture, and it is suspended when the app is backgrounded or the screen locks. The whole
   point of this app is playing music on a phone with the screen off — and a suspended
   context means silence, not "plays without the effect". Getting that right requires
   careful resume handling on every visibility change, and getting it *wrong* is a silent
   failure on the one device that matters most.

Neither is impossible; both are a bigger, riskier change than the rest of this feature put
together, and a good-quality real-time shifter is itself a substantial piece of DSP. The
honest options today are the two that ship: pitch lock **off**, which shifts pitch with
speed exactly like a record player, and the transpose display for reading the key.

If it is ever revisited, the shape is: one `AudioContext` created lazily on the first play
gesture, both elements captured once at engine construction, all gain moved into the graph,
and a `visibilitychange` handler that resumes the context. The transpose control is already
the right UI for it.

## Where the code is

| Piece | File |
|---|---|
| Loop guard, count-in, `preservesPitch` | `apps/web/src/player/engine.ts` |
| Pure helpers: tap ordering, count-in length, region geometry | `apps/web/src/player/practice.ts` (+ tests) |
| Key transposition, semitones from rate | `packages/shared/src/transpose.ts` (+ tests) |
| React glue and stored preferences | `apps/web/src/player/PlayerProvider.tsx` |
| The panel | `apps/web/src/components/PracticePanel.tsx` |

No new dependencies, no new settings on the server, no migration. Pitch lock and count-in
are per-device preferences in `localStorage` (`selfmp3:pitchlock`, `selfmp3:countin`).
