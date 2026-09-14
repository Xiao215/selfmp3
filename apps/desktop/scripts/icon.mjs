/**
 * The app's icon, rendered from the one the tab and the phone already wear.
 *
 * `apps/app/public/icons/icon.svg` is the source of truth for the mark, so this
 * renders it rather than keeping a second copy of it: an icon that drifts from
 * the favicon is the kind of thing nobody notices until someone else does.
 *
 * One PNG at 1024, and electron-builder makes the `.icns` and the `.ico` from
 * it. Generating those here would mean either macOS's `iconutil` — which is not
 * on CI's Linux runners or in this container — or a second library to write two
 * container formats by hand.
 *
 * `sharp` is already the server's, for cover art. This is the same version.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import sharp from 'sharp'

const here = dirname(fileURLToPath(import.meta.url))
const desktop = join(here, '..')
const source = join(desktop, '..', 'app', 'public', 'icons', 'icon.svg')
const target = join(desktop, 'resources', 'icon.png')

/** macOS wants 1024 for a crisp icon in the Dock at 2×, and so does the ico. */
const SIZE = 1024

const svg = await readFile(source)
const png = await sharp(svg, { density: 384 }).resize(SIZE, SIZE, { fit: 'contain' }).png().toBuffer()

await mkdir(dirname(target), { recursive: true })
await writeFile(target, png)
console.log(`icon ${SIZE}×${SIZE} → ${target}`)
