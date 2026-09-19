/**
 * The extension's tokens, written from the app's.
 *
 * `packages/client/src/theme/tokens.ts` is the one place the design's colours,
 * shapes and type are written down (docs/ARCHITECTURE.md: one design token
 * source). The extension used to keep a hand copy of them in CSS, and a hand
 * copy is one that drifts: it was still drawing the old tinted surfaces after
 * the app had moved to `S2`'s. So the build writes the copy instead, from the
 * compiled tokens, every time it runs.
 *
 * Two files come out, both git-ignored, as the desktop icon and the service
 * worker are — a generated file that is also committed is one someone edits:
 *
 * - `src/ui/theme.css`: every token as a custom property, dark first as the app
 *   is and Paper when the system is light. The pages import it, and the content
 *   script puts it into the pill's shadow root, so its selector is `:host` as
 *   well as `:root`.
 * - `src/ui/fonts.css`: the two faces, bundled from the same
 *   `@expo-google-fonts` files the app embeds. Not Google Fonts at run time:
 *   the extension promises to talk only to your server and your bucket, and a
 *   popup should not wait on a network to draw its title.
 *
 * The accent stays at the default hue. On a phone the hue is a setting of each
 * device; the extension has no settings of its own and gets none.
 */
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const HEADER =
  '/*\n' +
  ' * Generated from packages/client/src/theme/tokens.ts by\n' +
  ' * apps/extension/scripts/theme.mjs, on every build. Not committed: change the\n' +
  ' * tokens, not this.\n' +
  ' */\n'

/** `surface0` → `surface-0`, `accentStrong` → `accent-strong`: the CSS twin's names. */
export function kebab(name) {
  return name.replace(/([a-z])([A-Z0-9])/g, '$1-$2').toLowerCase()
}

function block(selector, lines, indent = '') {
  const body = lines.map(line => `${indent}  ${line}`).join('\n')
  return `${indent}${selector} {\n${body}\n${indent}}\n`
}

function paletteLines(palette) {
  return Object.entries(palette).map(([key, value]) => `--${kebab(key)}: ${value};`)
}

/**
 * The families the faces are registered under, with what to fall back to
 * while one loads: the serif to a serif, the display face to the system's.
 */
function fontStack(key, family) {
  const fallback = key.startsWith('serif')
    ? "Georgia, 'Times New Roman', serif"
    : "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif"
  return `'${family}', ${fallback}`
}

/**
 * Every token as a custom property. Pure, so a test can hold it against the
 * tokens themselves.
 */
export function themeCss(tokens) {
  const { hue, dark, light, radius, space, type, labelTracking, fonts, motion } = tokens
  const shared = [
    `--accent-hue: ${hue};`,
    ...Object.entries(radius).map(([key, value]) => `--radius-${kebab(key)}: ${value}px;`),
    ...Object.entries(space).map(([key, value]) => `--space-${kebab(key)}: ${value}px;`),
    ...Object.entries(type).map(([key, value]) => `--type-${kebab(key)}: ${value}px;`),
    `--label-tracking: ${labelTracking}px;`,
    ...Object.entries(fonts).map(
      ([key, family]) => `--font-${kebab(key)}: ${fontStack(key, family)};`,
    ),
    // The spring is for native; a stylesheet has the fades.
    ...Object.entries(motion)
      .filter(([, value]) => typeof value === 'number')
      .map(([key, value]) => `--motion-${kebab(key)}: ${value}ms;`),
  ]
  return (
    HEADER +
    '\n' +
    block(':root, :host', ['color-scheme: dark;', ...paletteLines(dark), ...shared]) +
    '\n@media (prefers-color-scheme: light) {\n' +
    block(':root, :host', ['color-scheme: light;', ...paletteLines(light)], '  ') +
    '}\n'
  )
}

/**
 * Where a face's file is: the token is the file's own name, as `expo-font`
 * registers it — `InstrumentSerif_400Regular_Italic` is
 * `@expo-google-fonts/instrument-serif/400Regular_Italic/InstrumentSerif_400Regular_Italic.ttf`.
 */
export function fontFile(family) {
  const cut = family.indexOf('_')
  const pkg = `@expo-google-fonts/${kebab(family.slice(0, cut))}`
  return { pkg, path: `${family.slice(cut + 1)}/${family}.ttf`, file: `${family}.ttf` }
}

/** The faces, served from the extension's own `fonts/` folder. */
export function fontsCss(fonts) {
  const faces = Object.values(fonts).map(family =>
    block('@font-face', [
      `font-family: '${family}';`,
      `src: url('/fonts/${fontFile(family).file}') format('truetype');`,
      // The weight and the slant are in the file; the family is the face.
      'font-display: block;',
    ]),
  )
  return `${HEADER}\n${faces.join('\n')}`
}

/**
 * Write both files, and copy the faces into `fontsOut` for the build to ship.
 * The tokens are read from the compiled package, which `build:extension`
 * builds first.
 */
export async function writeTheme(fontsOut) {
  const client = await import('@selfmp3/client/core')
  const hue = client.DEFAULT_ACCENT_HUE
  const tokens = {
    hue,
    dark: client.darkPalette(hue),
    light: client.lightPalette(hue),
    radius: client.radius,
    space: client.space,
    type: client.type,
    labelTracking: client.labelTracking,
    fonts: client.fonts,
    motion: client.motion,
  }
  const ui = join(root, 'src', 'ui')
  writeFileSync(join(ui, 'theme.css'), themeCss(tokens))
  writeFileSync(join(ui, 'fonts.css'), fontsCss(tokens.fonts))

  if (fontsOut) {
    const require = createRequire(import.meta.url)
    mkdirSync(fontsOut, { recursive: true })
    for (const family of Object.values(tokens.fonts)) {
      const { pkg, path, file } = fontFile(family)
      // The package's index is what its exports let a resolver reach.
      const base = dirname(require.resolve(pkg))
      copyFileSync(join(base, path), join(fontsOut, file))
    }
  }
}

// `node scripts/theme.mjs` writes the two stylesheets on their own, without a build.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await writeTheme(null)
}
