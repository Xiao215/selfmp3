# The doorman

A small Cloudflare Worker that stands between every self.mp3 device and your
Backblaze B2 bucket. It does three things:

1. **Signs you in with Google.** Only the Google accounts you list may sign in.
2. **Keeps the one bucket that belongs to your Google account.** Its key is
   sealed (AES-256-GCM) before it is stored, and it is never sent back to any
   device.
3. **Passes a signed-in device's reads and writes through to that bucket**,
   so no phone or browser ever holds the bucket's key.

Why it exists, and how devices use the bucket, is in [docs/SYNC.md](../../docs/SYNC.md).
The API it serves is the contract in
[packages/shared/src/schemas/doorman.ts](../../packages/shared/src/schemas/doorman.ts).

It runs on Cloudflare's free plan. A request may use 10 ms of CPU, which is
plenty: song bytes stream through without the Worker touching them. Uploads
are limited to 100 MB each. Sessions live in Workers KV, whose free plan
allows about 100,000 reads and 1,000 writes a day. Nothing is written until
Google has vouched for an address on your list; a whole sign-in costs three
writes, and using the library afterwards costs none.

## How signing in works

1. self.mp3 opens the doorman's sign-in link, and you choose your Google
   account.
2. Google sends you back to the doorman, which shows you a **sign-in code**,
   like `4F7K-2QXM`. If self.mp3 opened the link in the same browser, you are
   sent straight back to it with the code, and never see it.
3. self.mp3 claims your session with that code. If it asks you to type the
   code — the iPhone home-screen app does, since its sign-in opens in a sheet
   of its own — type it there, and nowhere else.

The code is what makes the session yours. Someone who sends you a sign-in link
of their own making can see that you signed in, but never the code you were
shown, and a single wrong guess ends that sign-in. The code works once, for ten
minutes.

---

## Deploying it

You need Node 22 or newer, and this repository with `npm install` run at its
root. Every command below is run from this folder, `apps/doorman`.

### 1. Cloudflare

1. Create a free account at [dash.cloudflare.com](https://dash.cloudflare.com/sign-up).
   No card is needed for Workers on the free plan.
2. Sign Wrangler (Cloudflare's command-line tool, already installed by
   `npm install`) in to that account. It opens your browser:

   ```sh
   npx wrangler login
   ```

3. Create the KV namespace the doorman keeps its sessions in:

   ```sh
   npx wrangler kv namespace create KV
   ```

   It prints an `id`. In `wrangler.toml`, replace
   `replace-with-the-id-from-wrangler-kv-namespace-create` with it, and keep
   the binding's name as `KV`.

4. Find your workers.dev address. The doorman will live at
   `https://selfmp3-doorman.<your-subdomain>.workers.dev`. Your subdomain is
   shown in the Cloudflare dashboard under **Workers & Pages** (look for your
   workers.dev subdomain on its overview). If you have never used Workers
   before, the first `npx wrangler deploy` asks you to choose one.

### 2. Google

The doorman signs people in with an OAuth client that you own, in the
[Google Cloud console](https://console.cloud.google.com/).

1. **Create a project**, for example "self.mp3", from the project picker at
   the top of the page.
2. Open **Google Auth Platform** (look for it in the navigation menu, or
   search for it). If it offers **Get started**, that walks you through the
   same questions as the next two steps.
3. **Branding**: set the app name to `self.mp3`, and choose your own address
   as the user support email and the developer contact. Nothing else is
   needed.
4. **Audience**: choose **External**, and leave the app in **Testing**. Under
   test users, add your own Google address and the address of anyone else
   who will use this self.mp3. While the app is in Testing, only the test
   users can sign in at all, which suits a personal app. The doorman keeps
   its own sessions and never uses Google's refresh tokens, so Testing's
   seven-day limit on those does not affect it. Google may warn, at sign-in,
   that it has not verified the app; that is expected for an app in Testing.
5. **Clients**: **Create client**, application type **Web application**,
   any name ("self.mp3 doorman"). Under **Authorised redirect URIs** add

   ```
   https://selfmp3-doorman.<your-subdomain>.workers.dev/v1/auth/callback
   ```

   exactly, with your subdomain. Create it, and copy the **client ID** and the
   **client secret**. Copy the secret now: Google may not show it again.
6. **Scopes**: nothing to do. The doorman asks only for `openid`, `email` and
   `profile`, which need no verification by Google.

### 3. Settings and secrets

1. In `wrangler.toml`, set `GOOGLE_CLIENT_ID` to the client ID. It is not a
   secret: it appears in every sign-in link.
2. Check `APP_ORIGINS` in `wrangler.toml`: the address the web app is served

`APP_SCHEMES` is the same idea for the native app: the URL schemes the
doorman may send a signed-in phone back to, comma separated, defaulting to
`selfmp3`. It is never used for CORS — a scheme has no origin to check one
against — only for the redirect at the end of a sign-in. What rides back is
the code alone; the attempt stays on the device, so a scheme another app has
also claimed is half of a pair and no use on its own.
   from, `https://xiao215.github.io`. Browsers may call the doorman only from
   there, and a sign-in only sends you back there — or to this computer
   (`http://localhost` or `http://127.0.0.1`, for the Mac's settings page).
3. Make a seal key, 32 random bytes:

   ```sh
   openssl rand -base64 32
   ```

4. Set the three secrets. Each command asks for the value; paste or type it
   when asked. None of them ever goes in a file in this repository.

   ```sh
   npx wrangler secret put GOOGLE_CLIENT_SECRET   # the client secret from Google
   npx wrangler secret put SEAL_KEY               # what openssl printed
   npx wrangler secret put ALLOWED_EMAILS         # e.g. you@gmail.com,friend@gmail.com
   ```

   If the Worker does not exist yet, Wrangler offers to create it; say yes.

### 4. Deploy

```sh
npx wrangler deploy
```

It builds `packages/shared` first (`wrangler.toml` says to), then uploads the
Worker and prints its address. Open `/v1/health` on it: you should see
`{"ok":true,"version":"1.0.0"}`.

Wrangler may warn that `wrangler.toml` defines more than one environment. The
other one, `dev`, is only for running the doorman on your own computer (see
below); the plain command deploys the real doorman.

---

## Good to know

- **A lost or stolen device**: sign in on another device and choose **sign
  out everywhere** in self.mp3. That ends every session of your Google
  account at once, the lost device's included, for good; then sign in again
  where you want to be. It can take up to a minute to reach every Cloudflare
  location.
- **ALLOWED_EMAILS** is the whole list of who may sign in. Letter case does
  not matter. If it is empty or missing, nobody can sign in. Taking an address
  off the list refuses its sessions straight away, but does not end them:
  putting the address back revives them. To be rid of someone's sessions for
  good, have them sign out everywhere, or keep them off the list.
- **SEAL_KEY** is where every key the doorman uses comes from: the one that
  seals each account's bucket key, and the ones that sign sign-ins and their
  codes. If you change it, sign-ins in progress stop working, and the doorman
  can no longer open the bucket keys it sealed, so everyone connects their
  bucket again (the bucket and its files are untouched).
- **What a device may do to the library**: read everything in it, add files,
  and replace or delete snapshots and change logs. It can never replace
  `format.json` (the doorman writes that when a bucket is connected), and
  never replace or delete a song, cover or lyrics file once it is there.
- **Logs**: `npx wrangler tail` shows what the doorman is doing, including why
  a sign-in was refused. It never logs a token, a key or a secret.
- **Running it on your own computer**: put `GOOGLE_CLIENT_ID` and the three
  secrets in a file named `.dev.vars` in this folder (one `NAME=value` per
  line; git ignores it), add `http://localhost:8787/v1/auth/callback` to the
  Google client's redirect URIs, and run `npx wrangler dev --env dev`. That
  development setup also lets the web app's local addresses call the doorman,
  and lets it use a bucket on this computer over plain http. It is never
  deployed.
