# Storage providers

Where an account's library is kept: a folder in its own **Google Drive**, or a **bucket**
of its own. Drive is what a new account is offered first, because it needs one more yes on
Google's page and nothing to copy; a bucket (Backblaze B2, or any S3 service) is the other
choice on the same page. Issue
[Xiao215/selfmp3#6](https://github.com/Xiao215/selfmp3/issues/6).

**Where:** the doorman (`apps/doorman/src/store.ts`, `bucket.ts`, `drive.ts`,
`googleTokens.ts`, `driveConnect.ts`), the contract (`packages/shared/src/schemas/doorman.ts`),
and Where it lives on every device (`apps/app/src/features/welcome/StorageScreen.tsx`).

**Status, 2026-11-12.** The issue asked for this plan to be approved before any code. It
was built in one night instead, on the recommendation at each choice below, so each lettered
choice is still open: say which to change. Everything runs against a fake Google Drive
(`apps/doorman/src/fakeDrive.ts`). **Nothing has run against the real Drive API yet**; what
that needs from the owner, and what to check first, is under "Before it is real" at the end.

## What does not change

- **One library, one store.** An account has a bucket or a Drive folder, never both, and
  connecting one replaces the other. Nothing copies a library across; that is "Later".
- **The keys.** `audio/<sha>.m4a`, `snapshots/…`, `log/<device>/…` are the same in either
  store, so `packages/shared`, the server, the replica and every device are untouched by
  which one an account has. Only the doorman knows.
- **Every device still reaches storage only through the doorman** (`/v1/files/<key>`,
  `/v1/list`), and share links, listening rooms, shared playlists and a server's grant all
  read through the same `Store`, so they work for a Drive library with no code of their own.
- **Existing Backblaze accounts.** A bucket's sealed record in KV is exactly what it was.
  A Drive record is a second shape beside it (`kind: 'drive'`), not a new version of the
  first.

One thing does change for people already signed in: `GET /v1/me` now says which kind of
storage an account has (`storage.kind`), and a device's stored session from before does not
have it. Such a device is signed out by the update and signs in once. The doorman and the
apps have to go out together for the same reason.

## The interface

The doorman's `Bucket` became one driver of a `Store` (`store.ts`), which is the five
things the doorman ever did to a bucket and nothing else:

| Method | Used for |
| --- | --- |
| `list(prefix, cursor)` | `GET /v1/list` |
| `read(key, limit)` | `format.json`, when connecting |
| `write(key, body, { contentType, contentEncoding })` | `PUT /v1/files/<key>`, and `format.json` |
| `remove(key)` | `DELETE /v1/files/<key>` |
| `fetchObject(method, key, forward)` | `GET` and `HEAD /v1/files/<key>`, and every lent read |

`bucket.ts` is the S3 driver, with no change in behaviour. `drive.ts` is the Drive driver.
`stores.ts` opens the one an account's record names. Errors are a `StoreError` with the
kinds a bucket's refusal already had (`packages/shared/src/bucketRefusal.ts`), plus `full`.

## 1. Paths

Drive has no paths: a file is reached by an id Drive makes up, and a name is only something
it has. Three ways to get from a key to an id:

- **A. Ask Drive each time, and remember the answer in the Worker instance.**
  (Built, recommended.) One search (`'<folder>' in parents and name = '<name>'`) before the
  first read or write of a key; after that the instance has the id. Nothing to keep in step:
  Drive is the only record. A file of the library never changes once written, so a
  remembered id is right until the file is deleted, and one that turns out gone is searched
  for again.
- **B. An index in a Durable Object per account.** No search, but every read becomes a
  Durable Object request (the free plan has 100,000 a day for everything), and an index is a
  second record that can disagree with Drive.
- **C. An index in KV.** Ruled out: KV allows about 1,000 writes a day, and an import of a
  thousand songs writes several thousand files.

**The layout** is one folder, `self.mp3`, in the root of the Drive, holding `format.json`
and a folder for each of the library's own: `audio`, `covers`, `lyrics`, `snapshots`, `log`.
A key's first part names the folder and the rest is the file's name, so a log file is the
file `<device>/<seq>.json` inside `log` (Drive lets a name hold a slash). That makes every
prefix a device may list (`isCloudListPrefix`) one folder, or one folder filtered by the
start of a name. The six folder ids are in the account's sealed record, found once when
Drive is connected.

The folder is found again by a mark only the app can see (`appProperties`), not by its
name, so renaming or moving it in Drive loses nothing, and disconnecting then connecting
again — or connecting from a second device — finds the same library rather than starting a
second.

**What each call costs**, in requests to Google (S3 is one each):

| | Cold instance | Warm |
| --- | --- | --- |
| Read a file | 3: token, search, bytes | 1 |
| `HEAD`, or a `304` | 2: token, search | 0 |
| Write a stream | 4: token, search, begin, send | 3 |
| Delete | 3: token, search, delete | 2 |
| List a folder | 2: token, list | 1 per 1,000 files |

A Worker may make 50 requests of its own per request on the free plan; the most here is
connecting, at about 13.

## 2. What S3 has that Drive lacks

What every caller of the doorman leans on was mapped first (the server's `DoormanCloudStore`,
the replica, the service worker, the desktop shell, the phone's loopback player). Each is
kept, and each has a test in `apps/doorman/src/drive.test.ts`:

| S3 | Who needs it | In Drive |
| --- | --- | --- |
| Prefix listing | A look lists `log/` and `snapshots/`; the server verifies `audio/`, `covers/`, `lyrics/` | One `files.list` of the folder. The empty prefix walks the folders in key order; the cursor says which folder it is in |
| Exact sizes in a listing | The server's orphan sweep compares sizes | Drive's `size` |
| Order of a listing | Nobody: every caller sorts or takes a maximum | Drive's order by name |
| A `PUT` replaces | A log file is resent under the same key; a hash-named file may be sent twice | Search first, then update the file found, so there is still one |
| Two writers of one key | Cannot leave two objects | Can leave two files. The oldest is the file, a listing names the key once, and a delete removes both |
| `ETag` | Browser revalidation of snapshots; a phone's download resume (`If-Range`) | `"<md5Checksum>"`, which is what S3's is for a plain upload |
| `If-None-Match`, `If-Match`, `If-Range` | The same | Answered by the doorman from the file's details, before any bytes are asked for |
| `Range`, `206`, `416` | The server streams by exact slice; desktop download resume | Drive's `alt=media` takes `Range` |
| `HEAD` | The server checks a song's size before letting its copy go | Answered from the file's details: no bytes read. (S3's was a GET with the body dropped) |
| `Content-Encoding: gzip` on snapshots | A phone inflates a snapshot only because of the header | Kept in the file's `appProperties`, and said again on the way out |
| `Content-Type` | Players | Drive's `mimeType`, set at upload |
| `If-None-Match` on a write | Nobody (Backblaze ignores it) | Not there |
| Delete | The server's trash, old snapshots, folded logs | `files.delete`, which skips the bin: the space comes back at once, with no lifecycle rule to set |
| Read your own write | `format.json` is written and read back when connecting | By id, which Drive answers at once. A *search* just after a write may lag; the instance that wrote a file already has its id |

**Uploads** are Drive's resumable kind for a stream (told the length, then sent the bytes,
in one piece: the doorman still never holds a song), and its multipart kind for bytes in
hand, which is only `format.json`.

## 3. Tokens

**The scope is `drive.file`**: the files the app itself creates, and no others. Google
lists it as non-sensitive, so it needs no review of the OAuth app, and a logo is still
what would bring verification back. Signing in is unchanged (`openid email profile`); Drive
is asked for only when someone presses **Use Google Drive**.

**The trip** is a sign-in's, made again by an account already signed in:

1. The device posts `POST /v1/storage/drive { returnTo }` with its session. The doorman
   answers with the address of Google's page: scope `openid email drive.file`,
   `access_type=offline`, `prompt=consent`, and a signed state naming the account.
2. The device opens it the way it opens a sign-in: the same tab on the web, the person's
   browser from the desktop app and a phone.
3. Google sends the browser back to **the same `/v1/auth/callback` a sign-in uses**, so the
   OAuth client needs no second redirect address. The signed state says which trip it was.
4. The doorman trades the code, checks the answer is for the account in the state and that
   `drive.file` was really granted, finds or makes the folders, writes `format.json` and
   reads it back, and only then seals and keeps the refresh token with the folder ids. One
   KV write.
5. The browser goes back to the app (`/storage`, or `selfmp3://storage`) with
   `#storage=connected` or `#storage-refused=<why>`. Nothing secret comes back, so there is
   no code to claim: the device asks `/v1/me`.

Where to come back to was the choice:

- **A. The existing callback, told apart by the state.** (Built, recommended.) Nothing new
  to register with Google.
- **B. A callback of its own**, `/v1/storage/drive/callback`. Cleaner to read, and one more
  redirect address every doorman's owner must add by hand.

What is refused, each with words of its own (`DRIVE_REFUSAL_WORDS`): Cancel; the Drive box
left unticked on Google's page; a different Google account than the one signed in (which is
also what stops a link of someone else's making from connecting anything).

**Access tokens** last an hour. Each Worker instance makes its own from the refresh token
and keeps it in memory until five minutes before it runs out (`googleTokens.ts`). That costs
one request to Google per cold instance and no KV write, ever. A `401` from Drive makes a new
one, once.

**The end of access.** Disconnecting storage, or connecting a bucket instead, hands the
refresh token back to Google (`/revoke`), so self.mp3 leaves the account's list of apps with
access. Connecting Drive again over Drive hands nothing back: Google does not end one token
but everything the account gave the app, the new token included. A token Google no longer takes — access removed at myaccount.google.com, or unused
for six months — is told the way a refused bucket key is (`bucket_refused_key`), with
"Connect Google Drive again in Settings."

## 4. Limits

- **Drive's rate limits** (12,000 requests a minute, per project and per user, and no daily
  count) come back as `403 userRateLimitExceeded` or a `429`. They are passed on as
  `bucket_busy`, which the player already waits out and the server's pass already stops at.
- **There is no daily cap**, so Drive never answers `bucket_cap_exceeded` and a Drive
  library never enters the ten-minute read hold (`packages/replica/src/hold.ts`). The hold,
  the "Daily limit used up" line and its Backblaze buttons stay a bucket's.
- **Drive's version of the cap is being full.** `403 storageQuotaExceeded` is a new kind,
  `full`, sent as `storage_full`: writes are refused, reads go on. The server's pass stops
  at it as it does at a cap. The banner that offers more space is "Later".
- **The Worker.** Bytes stream through in both directions as before, so CPU is unchanged.
  The extra per request is a search's JSON, a few hundred bytes.

## 5. Other features

Share links, rooms, shared playlists and grants needed no change: each reads an owner's
file with `openStore(accounts.storage(sub))` where it used to make a `Bucket`. A lent read
from a capped bucket still says `lender_cap_exceeded`; from a Drive there is no cap to say.

## 6. Tests

- `fakeDrive.ts` is the Drive API in memory, beside the S3 look-alike: files by id, names
  that need not be unique, searches in Drive's own language (a clause it does not know is a
  400, so the driver cannot lean on something unchecked), both kinds of upload, ranges, and
  a live access token required on every request. `FakeGoogle` gives refresh tokens, trades
  them, and takes them back.
- `drive.test.ts`: the driver through `/v1/files` and `/v1/list`, one test for each row of
  the table above, with the number of calls to Drive counted.
- `driveConnect.test.ts`: the trip, everything that must connect nothing, replacing one
  store with the other, and a bucket's sealed record from before still opening.
- `apps/server/src/hub/hub.test.ts`: the real server, through the real doorman code, to the
  fake Drive: a song goes up, is published in a snapshot, and plays back by range once the
  server has let its own copy go.
- `StorageScreen.test.tsx`, `signInCodes.test.ts`, `session.test.ts`: the page and the way
  back to it.

## The page

Where it lives opens on Google Drive: one line of what happens, **Use Google Drive**, and
under it **Use your own bucket instead**, which is the page as it was (a Backblaze key, or
*Not Backblaze?* for an address). Settings › Account › Storage says "self.mp3 in your Google
Drive" and its **Change** opens the same page.

- **A. Drive first, the bucket one press away.** (Built, recommended.)
- **B. Two cards side by side**, Drive and a bucket, neither first. More to read on the one
  page where a new person has nothing to go by.
- **C. Drive only, with the bucket in Settings.** Hides the choice from the person who
  came for it.

## Later

Not built, and shaped to fit:

- **A banner at about 80% of the Drive's space**, or when an upload is refused (`storage_full`
  is the hook), offering **Get more Google storage** or **Move to your own bucket**. Drive's
  `about.get` gives the numbers.
- **A resumable move** from any store to any store. `Store` is what both ends of it would
  be written against; it would run in steps or on the server because of the Worker's limits.

## Before it is real

For the owner, in order:

1. **Enable the Google Drive API** on the Google Cloud project of the OAuth client
   (APIs & Services › Library).
2. **Add the scope** `https://www.googleapis.com/auth/drive.file` under Google Auth Platform
   › Data access, and check the page still asks for no verification.
3. **Be In production, not Testing.** In Testing Google ends a refresh token after seven
   days, and every Drive library would have to be connected again each week.
4. **Deploy the doorman** (`npx wrangler deploy` in `apps/doorman`) together with the apps.
5. **Try it with a second Google account** before anyone's library depends on it: connect,
   import a song, play it on a phone and in a browser, share it, delete it.

What only the real API can settle, and where to look if it goes wrong:

- **Whether Google compresses a download.** The doorman passes Drive's bytes on as the
  Worker's runtime hands them over, under a length worked out from the file's size rather
  than taken from Google. If a file ever arrives the wrong length, `Drive.fetchObject` is
  the place.
- **How soon a search sees a new file.** The driver leans on searching by name before a
  write. If a resent log file ever shows up twice in a listing of `log/`, this is why; a
  read still takes the oldest, and a delete removes both.
- **That a folder is found again after disconnecting.** Disconnecting ends the app's access,
  and connecting again asks Google afresh. The files the app made should still be the app's
  to see (`drive.file` goes by which app made a file), and the driver counts on it to find
  the same library; worth one disconnect and connect with the second account.
- **The order of `orderBy=name`** for the library's names, which only the walk of the empty
  prefix cares about.
