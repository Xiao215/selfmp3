import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express, { type Express } from 'express'

/**
 * The server's own page: setting it up, and seeing how it is doing.
 *
 * The server serves no app. The library is the bucket's (docs/SYNC.md), the
 * server is what imports into it and publishes, and this page is where you
 * connect it and check on it. You listen in the app: the Pages tab, the
 * desktop app, or your phone. An app served from here would answer from this
 * server's database rather than from the bucket — a surface with its own
 * library and no sign-in, the one place that skips the door every other
 * device goes through.
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
 * This is the one line here that could go quietly wrong — get the negative
 * lookahead subtly off and the page starts answering `/api/...` with HTML,
 * which reads to a client as a server that has lost its mind rather than as a
 * routing mistake. `admin.test.ts` asks the seam over HTTP rather than reading
 * this, which is the only way to prove express agrees.
 */
const NOT_THE_API = /^(?!\/api\/).*/

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
