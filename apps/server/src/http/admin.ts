import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express, { type Express } from 'express'

/**
 * The server's own page: setting it up, and seeing how it is doing.
 *
 * This used to be the app. The server served `apps/app/dist` — the same Expo
 * web export GitHub Pages serves — at every path that was not `/api`, and a tab
 * opened here answered from this server's database rather than from the bucket.
 * That made `localhost:4600` a fourth surface with its own library and no sign
 * in, which is the one place the app skipped the door every other device goes
 * through.
 *
 * So the server does not serve the app any more. The library is the bucket's
 * (docs/SYNC.md), the server is what imports into it and publishes, and this
 * page is where you connect it and check on it. You listen in the app: the
 * Pages tab, the desktop app, or your phone.
 *
 * Plain files, no build step. They are read from `apps/server/public`, which
 * sits beside `src` and `dist` alike, so this resolves the same whether the
 * server is running from TypeScript or from its build.
 */
export const PUBLIC_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'public',
)

/**
 * Every path the page answers on: all of them except the API's.
 *
 * Exported because this is the one thing here that could go quietly wrong. Get
 * the negative lookahead subtly off and the page starts answering `/api/...`
 * with HTML, which reads to every client as a server that has lost its mind
 * rather than as a routing mistake.
 */
export const NOT_THE_API = /^(?!\/api\/).*/

export function mountAdminPage(app: Express): void {
  app.use(
    express.static(PUBLIC_DIR, {
      index: false,
      // Three small files that change when the server is updated and never
      // otherwise. Nothing here is worth a stale copy of.
      setHeaders: response => response.setHeader('Cache-Control', 'no-cache'),
    }),
  )

  // One page, whatever path was asked for — a sign-in coming back from the
  // doorman may land on any of them. `/api` has already had its say above,
  // including its own 404, so nothing here can shadow it.
  app.get(NOT_THE_API, (_request, response) => {
    response.setHeader('Cache-Control', 'no-cache')
    // `root` plus a relative name: given an absolute path, `send` applies its
    // dotfile rule to every folder on the way, so a checkout living under a
    // `.something` folder would 404 its own page.
    response.sendFile('admin.html', { root: PUBLIC_DIR })
  })
}
