/**
 * The built export, on 4699, for the width sweep.
 *
 * Twenty lines of `http` rather than a dependency: the whole job is to answer
 * with a file, or with `index.html` for a route, which is what the Mac's server
 * and GitHub Pages both do for this build.
 */
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

// From this file, not from the cwd: Playwright runs it from `verify/` and a
// person running it by hand is usually at the repository root.
const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'app', 'dist')
if (!existsSync(join(root, 'index.html'))) {
  console.error('No web export. Run: npm run export:web --workspace @selfmp3/app')
  process.exit(1)
}

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
}

createServer((request, response) => {
  const path = decodeURIComponent(new URL(request.url, 'http://x').pathname)
  const candidate = normalize(join(root, path))
  const file =
    candidate.startsWith(root) && existsSync(candidate) && statSync(candidate).isFile()
      ? candidate
      : join(root, 'index.html')
  response.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' })
  createReadStream(file).pipe(response)
}).listen(4699, '127.0.0.1', () => console.log('export on http://127.0.0.1:4699'))
