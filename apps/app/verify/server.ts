// The static server the web spikes run against.
//
// It is deliberately `express.static`, and deliberately not Expo's dev server:
// check 1 in docs/UNIVERSAL.md asks whether the *export* runs the way the Mac
// will serve it, at `/` and at `/selfmp3/`. A dev server would answer a
// different question.
//
// The single-page fallback mirrors what apps/server does for the web app today
// and what the Pages workflow does with its 404 redirect: any path that is not
// a file is index.html, because `playlist/[id]` only exists at runtime.

import express from 'express'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const here = __dirname

export interface StaticServer {
  /** Where the app is, base path included. */
  readonly url: string
  readonly port: number
  close: () => Promise<void>
}

/**
 * Serve an Expo web export.
 *
 * `base` is the mount path, e.g. '/selfmp3'. `port` 0 picks a free one, which
 * is what the specs want so two of them never collide.
 */
export function serve({
  dist,
  base = '/',
  port = 0,
}: {
  dist: string
  base?: string
  port?: number
}): Promise<StaticServer> {
  const root = resolve(dist)
  if (!existsSync(join(root, 'index.html'))) {
    throw new Error(`no index.html in ${root} — run \`npx expo export -p web\` first`)
  }

  const app = express()

  // The tones the engine spike plays, standing in for the media the server
  // streams. Mounted outside the export so the export stays exactly what
  // `expo export` produced.
  app.use('/fixtures', express.static(join(here, 'fixtures')))

  const mount = base === '/' ? '/' : base
  app.use(mount, express.static(root))
  app.use(mount, (_req, res) => res.sendFile(join(root, 'index.html')))

  return new Promise<StaticServer>((resolvePromise) => {
    const server = app.listen(port, '127.0.0.1', () => {
      const actual = (server.address() as { port: number }).port
      const path = base === '/' ? '' : base
      resolvePromise({
        url: `http://127.0.0.1:${actual}${path}`,
        port: actual,
        close: () => new Promise<void>((done) => server.close(() => done())),
      })
    })
  })
}
