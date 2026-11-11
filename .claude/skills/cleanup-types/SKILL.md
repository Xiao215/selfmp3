---
name: cleanup-types
description: Tighten TypeScript types in self.mp3 by removing any, as-casts and non-null assertions, replacing bags of optional fields with discriminated unions, and deriving types from the zod schemas. Use when a cleanup meets a cast, an any, a ! assertion, a hand-copied type, a stringly-typed field, or a shape the compiler could check but does not.
argument-hint: "[path]"
---

# Types

Every flag in `tsconfig.strict.json` is on because it caught a real bug. That
includes `strict`, `noUncheckedIndexedAccess`, `useUnknownInCatchVariables` and
`noPropertyAccessFromIndexSignature`. Work with them, not around them. A cast is
a claim the compiler cannot check, so each one should be rare and have a reason.

## Find

```sh
# any
grep -rnE ": any\b|<any>|as any\b" apps packages --include='*.ts' --include='*.tsx' --exclude-dir=node_modules
# every cast outside tests and comments, except `as const`
# (includes `as string`, `as { … }`, `as [T]`, `as unknown as`)
grep -rnE "[])a-zA-Z0-9_] as [A-Za-z{[(]" apps packages --include='*.ts' --include='*.tsx' --exclude-dir=node_modules \
  | grep -vE "\.(test|spec)\.|fixture|fakes\.ts|as const\b|import .* as |export \* as |:[0-9]+:\s*(//|/?\*)"
# non-null assertions outside tests
grep -rnE "[A-Za-z0-9_)\]]!(\.|\[|\)|,|;|$)" apps packages --include='*.ts' --include='*.tsx' --exclude-dir=node_modules | grep -v '\.test\.'
```

The cast search returns hundreds of hits across the repo. Scope it to the
area you are cleaning, and read each hit: some are prose inside strings, and
some casts are the right call with a reason above them.

## Rules

**`any` becomes `unknown` or a real type.** Data from outside is `unknown` until
a zod schema from `packages/shared` parses it. After parsing, it has the
schema's type.

**A cast becomes a parse or a guard.**
- At the edge (fetch, `JSON.parse`, storage, IPC, `postMessage`): `Schema.parse`
  or `safeParse`, not `as Song`.
- Inside, narrow with `in`, `instanceof`, a discriminant check, or a type guard
  (`(x): x is Song =>`).
- `as const` and `satisfies` are fine. They check rather than claim.
- When a cast has to stay, because a library's types are wrong, write the reason
  on the line above.

**`!` becomes handling.** `map.get(id)!` and `arr[0]!` hide the case where it is
missing. Handle the missing case (`if (!song) return`, `?? null`), or
restructure so the value is known to be present. Tests may use `!` (lint allows
it there).

**Unions over flag bags.** A type with `loading?: boolean; error?: string;
data?: T` allows nonsense combinations. Write
`{ kind: 'loading' } | { kind: 'failed'; reason: string } | { kind: 'ready'; songs: Song[] }`,
and switch on `kind` with `assertNever` at the end.

**Literal unions over `string`.** A field that holds one of a few known values
is typed as those values, ideally from a zod `enum` in `packages/shared`.

**Derive, do not copy.**
- Wire types are `z.infer<typeof XSchema>`. Never a hand-written interface beside
  the schema.
- Use `Pick`, `Omit`, `ReturnType`, `Parameters` and indexed access (`Song['id']`)
  instead of restating a shape that already exists.
- One name per shape. Two interfaces that describe the same object for two files
  are one type in the module that owns it.

**Read-only inputs.** Parameters a function only reads are `readonly T[]`,
`ReadonlyMap`, `ReadonlySet`, and fields that never change are `readonly`, as in
`queue.model.ts` and `events.ts`.

**Annotations.** Exported functions keep an explicit return type, so the
contract does not drift with the body. Leave out annotations TypeScript infers
for locals.

**Imports.** `import type` for types only, inline style
(`import { x, type Y }`). Lint enforces it and `--fix` writes it.

## Do not

- Do not widen a type to make an error go away (`string` instead of a union,
  `?` on a field that is always present, `| undefined` "to be safe").
- Do not add a schema default to quietly accept an old stored shape. Migrate the
  data (the project is unreleased).
- Do not turn on `exactOptionalPropertyTypes` or `allowUnreachableCode: false`.
  `tsconfig.strict.json` says why they are off.

## Check

`npm run typecheck`, then `npm run typecheck:app` (the root typecheck does not
cover the app), then `npm run check`. Tests are not type-checked (vitest
transpiles them), so a test that no longer matches a tightened type fails when
it runs, not before.
