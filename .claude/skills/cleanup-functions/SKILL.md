---
name: cleanup-functions
description: Reshape functions and modules in self.mp3, covering size, nesting, parameters, return values, pure logic versus side effects, wrappers and switches. Use when a function is long, deeply nested, takes many or boolean parameters, mixes logic with I/O, mutates its inputs, or is a pass-through wrapper.
argument-hint: "[path or function]"
---

# Functions

A good function does one job you can name without "and". It takes what it needs
and returns what it made. Its logic can be tested without a server, a device or
a mock.

## Signals worth a look

These are detectors, not laws. Act only when the change reads better.

- Longer than about 60 lines, or more than three levels of nesting.
- You need "and" or "then" to say what it does.
- More than three positional parameters, or a boolean parameter that switches
  what it does.
- It reads a value, decides something and writes the result in the same body.
- It changes an object it was handed.
- It exists only to call one other function with the same arguments.

## Rules

**Guard clauses first.** Return early for the cases that end quickly, and keep
the main path unindented.

```ts
// before
function albumLine(song: Song | undefined): string | null {
  if (song) {
    if (song.album) {
      return song.year ? `${song.album} · ${song.year}` : song.album
    }
  }
  return null
}
// after
function albumLine(song: Song | undefined): string | null {
  if (!song?.album) return null
  return song.year ? `${song.album} · ${song.year}` : song.album
}
```

**Pure core, effects at the edge.** Work out what should happen in a pure
function, and do it (SQL, fetch, storage, timers, React state) in the thin caller.
This repo already has a place for each half:

- app: the decision goes in `<feature>.model.ts` (pure, vitest), the screen
  renders it (Foundation 3);
- server: a route validates and calls a service; a service holds behaviour; SQL
  lives only in `repositories/` ("Layers, strictly");
- rules every side shares go in `packages/shared` (`smartRules.ts`, `queue.ts`,
  `editRules.ts`).

**Parameters.**
- Use an options object once there are more than three parameters, or as soon as
  two of them are optional or of the same type. That way a call site reads
  `{ limit: 20, skipLiked: true }` and not `(20, true)`.
- A boolean that changes what the function does usually means two functions,
  or a named union (`mode: 'append' | 'replace'`).
- Take the narrowest input that works: `songs: readonly Song[]`, not the whole
  library state, when only the songs are read. Narrow inputs make tests trivial.
- Mark inputs `readonly` (`readonly T[]`, `ReadonlyMap`, `ReadonlySet`) when the
  function only reads them, as this code does.

**Return values.**
- Return a new value. Do not mutate arguments or fill out-parameters.
- Never mutate shared state in place: a React state value, a query cache entry,
  a module-level object, a frozen config. Copy and replace
  (`[...songs, song]`, `{ ...row, title }`, `toSorted`, `toSpliced`). A
  function that sorts or splices the array it was handed changes its caller's
  data.
- One shape per function. "None" is `null` in this code (`?? null`). Do not mix
  `null`, `undefined` and `false` for the same meaning.
- Several values come back as a named object (`{ playing, next, played }`), not
  a positional tuple, unless it is a hook following React's `[value, set]` form.

**Switches.**
- A switch over a union ends with `default: return assertNever(value)` from
  `packages/shared/src/exhaustive.ts`, so a new variant does not compile until
  it is handled.
- A switch whose cases only map a value to a value becomes a lookup object
  typed `Record<Union, T>`, which is exhaustive too.

**No pass-through layers.** Delete a function that only renames another call,
unless its name adds a concept the call site would otherwise lose. Inline a
helper with one caller when the helper's name says less than its body.

**Extract only with a name.** Pull a block out when you can give it a name
that explains it. Five functions that each run once, in order, from one caller
are not better than one function with clear steps.

**Classes or functions.** A class is for something that holds state or
dependencies over time (`Gate`, the stores, every repository in
`apps/server/src/repositories/`, which holds its database) or extends `Error`.
Its private members are `#private`. Everything else is a function. Module-level
helpers are `function` declarations, exported or not. Arrows are for functions
nested inside another and for callbacks. Do not convert one form to the other
in a cleanup.

## Do not

- Do not bring in a pattern (strategy, builder, command, a Result type) to
  shorten one function.
- Do not split a function across files to meet a line count.
- Do not change behaviour while reshaping: same inputs, same outputs, same
  errors, same order of effects. `cleanup` step 5 says how to pin it first.

## Check

The function's own tests, then `npm run check`. If the logic had no test,
moving it into a model file or `packages/shared` is the moment to add one.
