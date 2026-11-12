---
name: cleanup-errors
description: Clean up error handling in self.mp3, covering swallowed errors, ad hoc error bodies, unsafe casts of caught values, defensive checks inside trusted code, validation at the edges, and reasons shown to people. Use when touching try/catch, thrown errors, HTTP error responses, input validation, or what a screen says when something fails.
argument-hint: "[path]"
---

# Errors

Fail loudly where something is actually wrong. Validate once at the edge, and
trust the types inside. Each layer turns an error into what its reader needs: a
status for a client, a sentence for a person, a log line for the owner.

## The repo's pieces

- **`HttpError`** (`apps/server/src/http/errors.ts`). Routes and services throw
  `HttpError.badRequest(…)`, `.notFound()`, `.conflict(…)`, `.refused(refusal)`.
  The one error middleware writes the body, so it always matches
  `ErrorBodySchema`. Outside `errors.ts` itself, never write
  `res.status(4xx).json({ error })` by hand.
- **`messageOf(error)`** (`packages/shared/src/errors.ts`) turns anything thrown
  into one line. Use it instead of `(e as Error).message`, `String(e)` or
  `e?.message`.
- **`assertNever`** (`packages/shared/src/exhaustive.ts`) ends every switch
  over a union.
- **Error codes.** The generic ones (`bad_request`, `not_found`) belong to
  `HttpError`'s factories. A code a client branches on is a constant in the
  shared package (`API_ERROR` and its siblings), never a literal repeated at
  the throw and the check.
- **A Node error's `.code`** (`ENOENT`, `EEXIST`) is read with `codeOf(error)`,
  beside `messageOf`, not by casting to `NodeJS.ErrnoException`.
- **Shared rules return a refusal** (`EditRefusal` in `editRules.ts`) that each
  answerer turns into its own error. Keep that split: a pure rule returns, an
  edge throws.

## Validate at the edge, trust inside

Parse with the `packages/shared` zod schemas wherever data enters:
- request bodies and params on the server and the doorman,
- responses in the client,
- JSON read back from disk, a device store or the bucket,
- desktop-bridge arguments and replies, extension messages. The desktop main
  process parses every channel's arguments with its schema before acting, and
  so does the page with every reply. The page is not trusted by the shell.

After that, the types are true. Delete defensive checks inside trusted code:
`if (!song) return` on a `Song` that cannot be missing, `?.` on a field the
schema requires, `?? []` on a value that is always an array. Each one hides
the real bug when the impossible happens. Where an invariant matters and the
types cannot hold it, throw with a sentence that names it.

`config.ts` validates the environment once at startup and freezes it. Bad
config stops the server at boot, not on the first request that reads it.

## Catching

- **Catch only what you can handle.** Narrow by type or code, and rethrow the
  rest. `catch (error) { if (!(error instanceof X)) throw error; … }`.
- **No empty catch.** `catch {}` is only allowed with a comment that says why
  this failure is expected and harmless, such as a best-effort cleanup.
- **No default that hides a failure.** Returning `[]` or `null` from a catch makes
  "failed" look like "empty". If the caller should know, let it throw, or return
  a value that says it failed.
- **Log once, at the boundary that handles it.** Do not catch, log and rethrow at
  every layer. That logs one failure five times.
- **The caught value is `unknown`** (`useUnknownInCatchVariables` is on). Narrow
  it, or use `messageOf`. Do not cast.
- **`finally` for cleanup** that must run either way: a lock, a timer, a temp file.

## What a person sees

A screen shows a reason in plain words, not a stack or a raw library message.
When the raw text comes from outside (yt-dlp, Backblaze, Google), translate it
into the project's words in one place, the way the import path does with
`explainCookieError`. Then decide on the translated form, so the logic that acts
on a failure and the words shown for it cannot disagree. Wording follows the
product's voice. Ask the owner when the words are a product decision.

## Check

Test the failure path at the real layer: fake the outermost boundary (an HTTP
server, a stand-in executable on `PATH`), not the function under it. Then make
sure the test fails if the handling is removed. Run `npm run check`.
