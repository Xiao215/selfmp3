# Share links

Send a friend a song as a link. They play it from your bucket for a while. When the link
ends, it still says what it was and where to go next. Agreed with Xiao on 2026-10-13 from
the lettered proposal (<https://claude.ai/artifact/8JyGghoGFzQpiA1HJDJ2Hb>), picks A1 B2 C1
D1 E1 F1 F2.

**Where:** the phone, the computer and the web. A friend without self.mp3 opens the link in
any browser, with no account and no name.

## The idea

A link is the quick way to share. A [shared playlist](listen-together.md#shared-playlists)
is the lasting one: everyone in it adds to it, and it lasts until they leave. A link is
made in one tap, holds what you picked, and ends by itself.

| | Rooms | Shared playlists | Share links |
|---|---|---|---|
| Who it is for | Friends listening now | Friends adding over time | Anyone you send it to |
| Needs an account to open | No (a guest gives a name) | Yes | No |
| Lasts | Until the host ends it | Until everyone leaves | A week from the last play, a month at most |

## What a link holds (A1)

- **One song**, from its ⋯ menu.
- **A tag, an artist or a playlist as it is now**, from the page's ⋯. Songs added later do
  not join it.
- **Songs picked**, from the selection bar's More.

A link holds at most 100 songs (`SHARE_MAX_SONGS`). **Share link** opens the share sheet
(`features/share/ShareSheet.tsx`). The sheet makes the link as it opens and shows it with
its QR code, with **Share link** for the system's share sheet (a copy where there is none).

Only an account with a bucket can share, since the doorman lends from it. A song not in
storage yet cannot be shared.

**The same songs, the same link.** Sharing the same songs again under the same name, in any
order, gives back the link you already made, not a second one:

- while it plays, as it is;
- once it ran out, shared again (as **Share it again**), so the tab your friend has works again;
- once you ended it, or its songs left your bucket, a new link.

## Songs never move

As in a room, each song stays in its sender's bucket. The link records its files' keys, and
the doorman lends exactly those to anyone with the link's key:

- **audio and words** while the link plays;
- **covers** for as long as its card is kept (below);
- nothing else, and only through the sender's sealed key.

Nobody can list the sender's library. If you already have the same song (same audio file, or
same source link), your own copy plays.

## How long it lasts (B2)

A link ends **a week after its last play**, and **a month after it was shared** at the
latest. Before anyone plays it, the week counts from when it was shared.

- A friend who keeps listening keeps it.
- A link nobody opens goes away by itself.
- The month limit stops one link becoming a permanent way into your bucket.

The rules are `shareEndsAt` and `shareEnded` in `packages/shared/src/shareLink.ts`. Only a
play from a song's first byte counts as a play, since a song is fetched in pieces. A piece
from later in the song still moves the end on, at most once every ten minutes.

## Before it ends (D1)

From its last day, the page says **Ends tonight** or **Ends tomorrow**, in amber, and **Get
it** becomes the main button. There is no notification.

**Get it** is a room's Get it (`features/room/useGetSongs.ts`). Your own server imports the
song from its source link into your bucket. It needs you signed in and your server
reachable. A song with no source link, such as a file you dropped in, has no Get
it.

## After it ends (E1)

The page stays, with three ways on:

- **Get it**, when signed in and the song has a source link;
- **Open on YouTube** (or 网易云, YouTube Music…), the song's source link;
- **Ask Xiao again** (F1).

The cover stays, faded, and the names stay. The doorman keeps this card for **ninety days**
after the link ends (`SHARE_KEPT_MS`), then forgets the link entirely. A forgotten link's
page says *This link is gone*.

On Home, an ended link's tile in **From friends** goes grey and says **Ended**. Press and hold
it, or right-click on a computer, for **Take it off Home**. The ended page has the same
button.

## Asking again, and your side (F1, F2)

**Ask Xiao again** reaches the sender:

- signed in, you ask as yourself;
- a guest gives a name first, the one a room's guest gave last time if there was one.

The same person asking twice is one ask. A guest's device remembers that it asked.

The sender sees asks in two places:

- **On Home**: one ask as a card, *Ken asked for 晴天 again*, with **Share again** and **Not
  now**. Several asks show as one row that opens Links you shared.
- **In Links you shared**.

**Share again** renews the **same** link for another month, so the tab your friend already
has just works again. A link whose songs are no longer in your library cannot be asked for
or shared again.

**Links you shared** (`/links`) lists every link you sent:

- who opened it, by name if signed in and counted otherwise;
- how long it has left, or when it ended and how often it played.

You reach it from Settings › Account, and from the share sheet. Each link's ⋯ holds:

- **Share link**;
- **Keep it longer**, or **Share it again** once it has ended;
- **End now**, which asks first, or **Remove** once ended (its page goes too).

## At the edges

- **You remove the song.** The first play that finds its file gone from your bucket marks it
  gone. When all of a link's songs are gone, the link ends: *Xiao removed this song*, with no
  Ask again.
- **Your bucket hits its daily cap.** The audio read is refused for the day, as any read is.
  The link does not end because of it.
- **Who can open it.** Anyone with the whole link: a 16-character id and a 16-character key.
  The id alone opens nothing. **End now** is how you take it back.
- **Counting guests.** A signed-out device sends its own device id, so it counts as one guest
  however often it looks.

## Not done

- **The app opening a link instead of the browser.** That needs universal links (iOS) and app
  links (Android), served from `xiao215.github.io/.well-known`, a different repository from
  this one. Rooms' invite links have the same gap. Inside the app, From friends opens links
  in the app.

## The doorman

Each link is a Durable Object named by its id (`apps/doorman/src/share.ts`, bound as
`SHARES`, class `ShareLink`, migration `v4`). It keeps:

- the link (`ShareDoc`);
- its key;
- whose bucket it lends from;
- which signed-in accounts opened it, and which asked.

Only the link itself is ever sent to anyone. An alarm forgets the link when its card's days
are up. Two KV lists per account, written only when a link is made, first opened or taken
off, say which links the account sent (`share-out:<sub>`) and opened (`share-in:<sub>`). A
third, `share-same:<sub>:<sha256>`, written when a link is made or shared again, says which
link a name and set of songs went out as. It lasts as long as that link can (a month and
ninety days).

```
POST /v1/share                       ShareCreate → ShareLink       signed in, with a bucket
GET  /v1/share                                   → ShareSummary[] the links you sent
GET  /v1/share/received                          → ShareSummary[] the ones you opened
GET  /v1/share/<id>?k=<key>&v=<device>           → ShareLink      a session is optional
GET | HEAD /v1/share/<id>/files/<entry>/<part>?k=<key>   audio | cover | lyrics | romanized
POST /v1/share/<id>/ask?k=<key>      { name }    → ShareLink      once it has ended
POST /v1/share/<id>/act              ShareAction → ShareLink | 204 renew | end | dismiss | forget
```

**Deploying.** The `SHARES` binding and the `v4` migration are in
`apps/doorman/wrangler.toml`. Deploy the doorman by hand (`cd apps/doorman && npx wrangler
deploy`) before the app: a doorman without the binding answers that it keeps no share links,
and Home and Settings then show nothing of them.

## Where the code lives

| What | Where |
|---|---|
| The contract | `packages/shared/src/schemas/share.ts` |
| The rules: when it ends, asks, renewing | `packages/shared/src/shareLink.ts` |
| The doorman | `apps/doorman/src/share.ts`, `shareRoutes.ts` |
| From a device | `packages/client/src/room/shareApi.ts` |
| The app | `apps/app/src/features/share/`: the sheet, the link's page, Links you shared, From friends |
| Routes | `apps/app/app/l/[id]/[key].tsx`, `apps/app/app/links.tsx` |
| Tests | `apps/doorman/src/shareRoutes.test.ts` (the real doorman), `apps/app/src/features/share/share.model.test.ts` |
