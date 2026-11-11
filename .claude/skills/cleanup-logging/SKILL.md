---
name: cleanup-logging
description: Clean up logging in self.mp3, covering stray console.log calls, the wrong level, one failure logged several times, log lines nobody can act on, noisy logs in loops, and secrets or personal data in logs. Use when a cleanup touches logger or console calls on the server, the doorman, the desktop shell or the app, or when the logs were no help diagnosing a problem.
argument-hint: "[path]"
---

# Logging

A log line is for the owner reading it later, usually on the Pi or in the
Cloudflare dashboard, with no debugger attached. It should say what happened,
to what, and what follows, in one line, at the right level.

## Which logger, where

| Where | Use |
| --- | --- |
| the server | the `Logger` from `apps/server/src/logger.ts`, handed down from the container, with `logger.child('scope')` per area. Never `console.*` in server code (lint warns there too). |
| the CLI and eval scripts | `console.log` is their output, and that is fine (`cli.ts`, `ai/eval/`, `sound/eval.ts`) |
| the doorman | the request context's `Log`, with `redact` (`apps/doorman/src/http.ts`) on any text that came from a request or a runtime error |
| the app, the desktop shell, the extension | `console.warn` and `console.error` only. Lint warns on `console.log` everywhere outside scripts and tests (`no-console`, `eslint.base.cjs`). |

## Where the volume comes from

Most of the server's log is the request logger (`requestLogger`,
`http/middleware.ts`), plus the error handler (`http/errors.ts`), which adds a
warn line for every 4xx. Look there first:

- **Polling and heartbeats** (a device's heartbeat every 10 s, library version
  polls) belong at `debug`, as streams and art already are. At `info`, one
  idle phone writes a line every few seconds forever.
- **Expected misses** (no lyrics for an instrumental, a song not analysed yet,
  no cover) are not warnings. They happen on every play. Log them at `debug`,
  or not at all, and keep `warn` for 4xx answers that mean something is wrong.
- **One request, two lines.** The request line already records the status. The
  error handler's own line is only worth adding when it says something the
  request line cannot: the cause of a 5xx.

## Levels

- **error:** something failed that should not have, and someone may need to
  act: a request answered 500, a sync pass that gave up, data that would not
  parse.
- **warn:** something went wrong but was handled: a retry, a fallback, a skipped
  song, a refused request worth noticing.
- **info:** a milestone the owner wants in the timeline: startup, a library
  joined, an import finished. Not once per song in a loop.
- **debug:** detail for chasing a problem, off by default.

Expected outcomes are not errors. A 404 for a missing song, a cancelled stream
and a client that disconnected are not `error`.

## Smells

- **`console.log` left in from debugging.** Delete it. If the information is
  worth keeping, turn it into a logger call at the right level.
- **One failure logged at every layer.** Log once, where the error is handled,
  not where it is caught and rethrown (`cleanup-errors`).
- **A line nobody can act on.** "failed", "error:", `[object Object]`. Say
  what was being done and to which thing. Use structured fields
  (`logger.warn('cover fetch failed', { songId, status })`) and `messageOf(error)`
  for the cause.
- **Logs in hot loops.** A line per song across the library floods the log.
  Log a summary (counts, duration) once at the end, and a line per item only
  for the failures.
- **Repeats of the same warning.** If something can fail every few seconds (a
  reconnect, a capped bucket), log the first time and when it recovers, not
  every attempt.
- **Secrets and personal data.** Never log a token, a key, a signature, a
  cookie, an Authorization header, or a full URL that carries one. Do not log
  email addresses, or song titles of someone else's library, when an id does.
  Run outside text through `redact` in the doorman.
- **Logging instead of telling the person.** A failure the person needs to know
  about goes to the screen (a toast, a notice, state). A `console.error` in the
  app is invisible to them.

## Check

Read the area's log output for one real run (`npm run dev:api` locally, or
the test's captured logger) before and after. Every remaining line should be
something you would want to read at 2 a.m. Then run `npm run check`.
