/**
 * The client download harness, built and served on http://localhost:4602 —
 * one of the pages the extension carries requests for (YT_PROXY_ORIGINS).
 *
 * The packages are built first, so the page bundles what is in `src/` now.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const repoRoot = join(root, '..', '..')
const PORT = 4602

const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc')
execFileSync(process.execPath, [tsc, '-b', 'packages/shared', 'packages/ytclient'], {
  cwd: repoRoot,
  stdio: 'inherit',
})

const bundle = await build({
  entryPoints: [join(root, 'harness', 'main.ts')],
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'esm',
  target: 'chrome120',
  sourcemap: 'inline',
  logLevel: 'warning',
})
const script = bundle.outputFiles[0].contents
const page = readFileSync(join(root, 'harness', 'index.html'))

/** The last report an `?auto` run posted, for verify/plainBrowser.mjs to collect. */
let report = null

createServer((request, response) => {
  const path = new URL(request.url ?? '/', `http://localhost:${PORT}`).pathname
  if (path === '/report' && request.method === 'POST') {
    let body = ''
    request.on('data', chunk => (body += chunk))
    request.on('end', () => {
      report = body
      response.writeHead(204).end()
    })
  } else if (path === '/report') {
    if (report === null) response.writeHead(404).end()
    else response.writeHead(200, { 'content-type': 'application/json' }).end(report)
    report = null
  } else if (path === '/' || path === '/index.html') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(page)
  } else if (path === '/main.js') {
    response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' }).end(script)
  } else {
    response.writeHead(404).end()
  }
}).listen(PORT, 'localhost', () => {
  console.log(`The harness is on http://localhost:${PORT}`)
})
