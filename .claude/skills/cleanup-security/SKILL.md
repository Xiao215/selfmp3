---
name: cleanup-security
description: Audit and tighten self.mp3's trust boundaries across the whole repo, covering who may call each server and doorman route, input validation and size caps, requests the server or doorman makes to addresses a caller chose, secrets in logs, URLs and storage, the desktop shell's preload and IPC, the extension, share links, and CORS. Use for the SECURITY label in docs/CODE_TODO.md, when touching auth, tokens, grants, outgoing requests, IPC or anything that accepts input from outside. For a diff-only review, the built-in security-review also exists.
argument-hint: "[path | area]"
---

# Trust boundaries

Every place data or a request crosses from someone you do not fully trust is a
boundary. Each one must say who may cross, check what they sent, and cap how
much they can make it do. Find the boundaries first, then check each one.

## The boundaries in this repo

| Boundary | Who is on the other side | What guards it today |
| --- | --- | --- |
| The server's API | any device with a library's token, or the same machine | the hub's door, `createHubApp` (`apps/server/src/hub/app.ts`), which finds the library by its token (`hub.ts`, tokens in `hub/registry.ts`) and lets only the same machine in without one. `isLocalRequest` (`http/local.ts`) guards the local-only routes: cloud writes, `/hub`, the admin page. Route tests use `createApp` instead, which production does not run, so test the door at `hub/hub.test.ts`. |
| The admin page | whoever reaches 127.0.0.1 through Tailscale | its own listener on loopback (`apps/server/src/admin/app.ts`) |
| The doorman | the open internet | Google sign-in, sessions, grants, CORS (`cors.ts`, `isForeignWrite`), `requireSession` / `requireBucket` |
| Rooms, shared playlists, share links | friends and strangers with a link | room and share rules in the doorman, sealed secrets (`seal.ts`) |
| Outgoing requests | an address someone else chose (a grant's callback, a cover or lookup URL) | `isPrivateHost` / `isLoopbackHost` (doorman `http.ts`), `isPublicAddress` / `fetchPublic` (server `http/publicWeb.ts`) |
| The desktop page and shell | the web page inside the window | `contextIsolation`, `sandbox`, no `nodeIntegration` (`apps/desktop/src/main/window.ts`), the preload, a zod schema per channel in `packages/desktop-bridge` |
| The extension | any page the person visits | message schemas, and the extension only hands links to the server |
| Data read back | the bucket, a device store, a file on disk | zod parse on read |

## Check each boundary for

- **Who.** Every route requires the right identity: a token, a session, a
  grant, the local machine. A new route that skips the guard is the most
  common hole. Read the router and the door it is mounted behind, not just the
  handler. Every local-only route has a test that sends a valid token from
  another machine and expects the refusal.
- **Whose.** Being signed in is not enough. The thing asked for must belong to
  the caller: their library, their room, a song they were lent, a link they own.
  Check the ownership query, and try another account's id in a test.
- **What.** The body, params and headers are parsed with a zod schema. Strings
  and arrays have a maximum length, numbers a range. Paths and keys built from
  input cannot climb out (`..`, absolute paths, another account's prefix).
- **How much.** Caps on body size (`express.json({ limit })`, the doorman's
  `readJson` / `readBytes`), open streams (`MAX_STREAMS` in
  `services/events.ts`), queued bytes, list lengths and cache sizes
  (`boundedCache.ts`). Anything a caller can make grow needs a limit and a
  behaviour when it is reached.
- **Where to.** Any request whose host comes from input goes through the
  private-address guard, after DNS resolution and on every redirect. The attack
  round found the doorman posting to private addresses this way.
- **Secrets.**
  - Tokens, keys and signatures never go in a log line or an error sent to a
    client. Use `redact` in the doorman and `cleanup-logging` rules.
  - A token goes in a URL query only where a header is impossible, and is then
    blanked in every log. The library token rides `?token=` on media URLs
    because `<audio>` cannot send a header, and `loggedUrl`
    (`http/middleware.ts`) blanks it. A share link carries its key in the link
    by design. Anywhere else, a token in a query is a finding.
  - Compare a secret checked against one expected value in constant time
    (`timingSafeEqual`). Finding a library by its token in a `Map` is a lookup,
    not a comparison. Leave it.
  - A secret at rest is sealed or kept in the keychain (desktop) or secure
    storage (phone), never in prefs.
- **The page.** On the web, text from songs, tags, names and link titles is
  rendered as text, never as HTML. Watch for `dangerouslySetInnerHTML` and
  hand-built HTML in the doorman's pages (`html.ts`, `linkPage.ts`), and escape
  every value there.
- **Electron.** The preload exposes named functions, never `ipcRenderer` itself.
  Every channel validates its arguments in the main process. Navigation and new
  windows are refused unless the URL is the app's own.
- **Errors.** A refusal says no without saying why in a way that helps an
  attacker (whether an account exists, which part of a token was wrong).

## Fix

- Close the hole at the boundary, once, in the shared guard if there is one.
  Do not patch each caller.
- Every fix gets a test that makes the forbidden request and expects the
  refusal: another account's id, a private address, an oversized body.
- The doorman is deployed by hand (`npx wrangler deploy` in `apps/doorman`), so
  a doorman fix is not live until the owner deploys it. Say so in the report.
- Findings that would expose something real are reported to the owner first.
  Do not describe them in a public commit message before the fix is deployed.

## Check

The boundary's own tests, then `npm run check`. For the doorman, also
`npm test` with the fakes: the fake bucket checks request signatures the way a
real one does.
