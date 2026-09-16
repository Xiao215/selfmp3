/**
 * The dmg window's background, rendered rather than committed.
 *
 * Quiet and light: the app's off-white, an arrow in the accent from the app to
 * Applications, and one line saying what to do. Drawn at 540×380 and again at
 * 2×; electron-builder joins the pair into one Retina TIFF with `tiffutil` and
 * sizes the window from the 1× file.
 *
 * What is not in it are the two names under the icons. Finder draws those
 * itself, in the appearance's own text colour, and nothing in a dmg can set it —
 * so they are black here in Light Mode and may be white in Dark Mode. Check that
 * with the window open before reaching for anything cleverer.
 *
 * `sharp` is already the icon's, and the server's before it.
 */
import { Buffer } from 'node:buffer'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import sharp from 'sharp'

const here = dirname(fileURLToPath(import.meta.url))
const target = join(here, '..', 'resources', 'dmg-background.png')

const WIDTH = 540
const HEIGHT = 380
/** Keep in step with `dmg.contents` and `dmg.iconSize` in electron-builder.yml. */
const APP_X = 140
const APPLICATIONS_X = 400
const ICON_Y = 190
const ICON_SIZE = 100

/*
 * Finder sizes the window from this image but counts its title bar in that
 * height, so the bottom of the picture is never seen: a caption at 330 was cut
 * off. Below the icons' names (about 270) and well clear of that edge.
 */
const CAPTION_Y = 300

const ACCENT = '#7c6ae6'
const arrowFrom = APP_X + ICON_SIZE / 2 + 22
const arrowTo = APPLICATIONS_X - ICON_SIZE / 2 - 24

const svg =
  scale => `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH * scale}" height="${HEIGHT * scale}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <rect width="${WIDTH}" height="${HEIGHT}" fill="#f7f5fb"/>
  <g fill="none" stroke="${ACCENT}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M${arrowFrom} ${ICON_Y} H${arrowTo - 4}"/>
    <path d="M${arrowTo - 16} ${ICON_Y - 13} L${arrowTo} ${ICON_Y} L${arrowTo - 16} ${ICON_Y + 13}"/>
  </g>
  <text x="${WIDTH / 2}" y="${CAPTION_Y}" text-anchor="middle" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="12" fill="#8a8594">Drag self.mp3 to Applications</text>
</svg>`

await mkdir(dirname(target), { recursive: true })
for (const [scale, file] of [
  [1, target],
  [2, target.replace(/\.png$/, '@2x.png')],
]) {
  await writeFile(
    file,
    await sharp(Buffer.from(svg(scale)))
      .png()
      .toBuffer(),
  )
  console.log(`dmg background ${WIDTH * scale}×${HEIGHT * scale} → ${file}`)
}
