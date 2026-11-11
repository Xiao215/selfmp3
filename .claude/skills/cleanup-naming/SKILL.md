---
name: cleanup-naming
description: Name and rename variables, functions, booleans, constants, hooks, components and files the way self.mp3 names them. Use when naming something new, when a name is vague, misleading, abbreviated or needs a comment to explain it, or when doing a rename as part of a cleanup.
argument-hint: "[path or name]"
---

# Names

A name should say what the thing is in the project's own words, so a reader
never needs a comment to learn it. Before you pick a word, grep for the word the
code nearby already uses for the same idea, and use that.

## The project's words

Use one word per idea, and the one already in use:

- **song** for a song in the library, not track. `track` is right in two places:
  the phone's player library (react-native-track-player) and the engine around
  it, and the entries of an outside playlist being imported (`body.tracks` is a
  wire field). Leave those alone.
- **library**: the owner's songs. **bucket**: the cloud storage. **doorman**:
  the Cloudflare Worker. **replica**: a device's copy of the bucket.
- **port**: a platform difference in `apps/app/src/ports/`. **model**: a
  feature's pure state and behaviour, in `<name>.model.ts`.
- **Up next** in the UI, and in the names of components that draw it
  (`UpNextList`, `SaveUpNext`). The state and the model under it are the queue
  (`QueueState`, `queueRows`). Components are named for what the person sees.
- **room**, **link**, **tag**, **playlist**, **listen**: see `docs/features/`
  before inventing a synonym.

Do not mix verbs for one operation in one area. If a module reads with `read*`,
a new reader is not `load*` or `fetch*`.

## Values

- Name a value by what it is, not by how it was made: `songs`, not `filtered`
  or `result`.
- Collections are plural (`songs`, `rows`). A map says what it is keyed by:
  `byId: ReadonlyMap<number, Song>`, `songById`.
- A time or a size carries its unit: `KEEPALIVE_MS`, `MAX_QUEUED_BYTES`,
  `ageDays`, `ms`. Never a bare `timeout` or `size`. Layout values in the app are
  points by convention and carry no suffix (`ROW_HEIGHT`, `TAP_SLOP`,
  `PAGE_TOP_WIDE`). Do not add `_PT` to them.
- SCREAMING_SNAKE only for module-level fixed values (`MAX_STREAMS`). Locals,
  even ones that never change, are camelCase.
- No type in the name: not `songList`, `songArray`, `songsMap`, `ISong`,
  `SongType`. The type already says it.
- No filler: `data`, `info`, `item`, `obj`, `temp`, `val`, `stuff`, `manager`,
  `helper`. A one-letter name is fine for a short arrow (`s => s.id`) or a loop
  index, and nowhere else.
- No abbreviations a reader has to decode (`btn`, `cfg`, `idx`, `cnt`, `msg`).
  Widely known ones stay: `id`, `url`, `ms`, `db`, `api`.
- Name length follows scope. A local used on the next line can be short. An
  export read from ten files says exactly what it is.

## Booleans

This code mostly names boolean values (locals, state, fields, props) as plain
adjectives or participles that read as a statement: `playing`, `open`, `wide`,
`finePointer`, and on `Song` itself `loved` and `instrumental`. Follow that for
new values.

- Add `is`, `has` or `can` to a value only when the bare word would read as a
  noun or a verb: `hasArt`, `hasWidget`, `canListenHere`.
- A function that answers yes or no is a predicate and keeps its prefix:
  `isFresh`, `isLocalRequest`, `isPublicAddress`.
- Do not rename a public name that already has a prefix just for this rule.
  `PlayerApi.isPlaying` stays.
- No negatives: `muted`, not `notAudible`. Never `!notReady`.
- A boolean prop that picks between looks is often a variant in disguise.
  `feedback: 'sink' | 'wash' | 'dim'` (`Press.tsx`) beats three booleans.

## Functions

- An action is a verb phrase: `dropDownloads`, `playNext`, `clearConnection`.
- A pure function that derives a value is named for the value: `queueRows`,
  `messageOf`, `plural`, `hourBand`, `encodeSseEvent`. Not `getQueueRows` or
  `computeQueueRows`. Yes-or-no predicates are the exception (see Booleans).
- A name must not lie. A `get*` or noun-named function that writes, fetches or
  throws for the normal case has the wrong name.
- If you need "and" to name it, it does two things (see `cleanup-functions`).

## React and files

- Event handlers are `onX`, both as props and as local functions
  (`const onPress = …`). The app has no `handleX`. Keep it that way.
- Hooks are `useX`. Components are PascalCase nouns (`SongRow`, `NowPlayingScreen`).
- A feature's files: `<Name>Screen.tsx`, `<name>.model.ts`, with tests beside them
  as `<name>.model.test.ts` and `<Name>.test.tsx`.
- Platform twins share a base name: `covers.ts` on a phone, `covers.web.ts` in a
  browser, `x.desktop.ts` for the shell. Renaming one means renaming all.
- Private class members use `#name`, not `_name` or `private`.
- A leading `_` means deliberately unused (the lint rule's opt-out), nothing else.

## Doing a rename

1. Find every reference: `grep -rnw <name>` over the whole repo, not just `src`.
   That covers twins, tests, `docs/`, `.mjs` scripts, the admin page's plain
   JS in `apps/server/admin/`, Maestro flows and Playwright specs.
2. Some names are data, not code. Renaming them is a migration, not a rename:
   - a field in a `packages/shared` schema (both server and clients),
   - a SQL column (append to `MIGRATIONS`),
   - a prefs or device-store key, a bucket object key,
   - a desktop-bridge channel, a doorman route, an expo-router file (it is a URL).
   The project is unreleased, so migrate. Never leave the old name as an alias.
3. Update the comments and docs that name it. `npm run check:comments` catches
   paths and `#members`, but not a plain word in a sentence.
4. Run `npm run check`. The root typecheck does not cover `apps/app`;
   `check:app` does.

## Leave alone

- A name that matches an outside API (`onPress`, `writableLength`, `allowH2`).
- Short names a whole area already uses consistently. Change them all or none.
- Words in user-facing text. Those follow the product's wording, not this skill.
