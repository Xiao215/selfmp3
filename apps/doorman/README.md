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
allows about 100,000 reads and 1,000 writes a day; signing in costs six
writes, and using the library afterwards costs none.

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
2. Check `APP_ORIGINS` in `wrangler.toml`: the addresses the web app is
   served from. Browsers may call the doorman only from these, and a sign-in
   only sends you back to them.
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

---

## Good to know

- **ALLOWED_EMAILS** is the whole list of who may sign in. Letter case does
  not matter. If it is empty or missing, nobody can sign in. Taking someone
  off the list signs them out everywhere at once.
- **SEAL_KEY** seals each account's bucket key in KV. If you change it, the
  doorman can no longer open the keys it sealed, and everyone connects their
  bucket again (the bucket and its files are untouched).
- **Logs**: `npx wrangler tail` shows what the doorman is doing, including why
  a sign-in was refused. It never logs a token, a key or a secret.
- **Running it on your own computer**: put the three secrets in a file named
  `.dev.vars` in this folder (one `NAME=value` per line; it is ignored by
  git), add `http://localhost:8787/v1/auth/callback` to the Google client's
  redirect URIs, and run `npx wrangler dev`.
