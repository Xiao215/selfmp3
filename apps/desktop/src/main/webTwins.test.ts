import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * No `.web` file in the app takes a value from its own base name.
 *
 * `x.web.ts` importing from `./x` reads to TypeScript as the native twin, and to
 * Metro — which prefers `.web` on web — as the file itself. A type import is
 * erased before Metro sees it, so that is common and fine; a value import is a
 * module requiring itself. That is how the installed desktop app opened to an empty
 * window (`apps/app/src/ports/titleBarDragId.ts` has the story): typecheck
 * cannot see it, and a browser tab never read the value, so it is checked here,
 * on the source.
 *
 * Here rather than in `apps/app` because the app's tsconfig has no Node types,
 * and because the shell is where it showed.
 */
const appSrc = join(__dirname, '..', '..', '..', 'app', 'src')

/** Every `import … from './base'` or `export … from './base'` that is not `type`-only. */
function valueImportsOf(source: string, base: string): string[] {
  const statement = /\b(?:import|export)\b((?:(?!\b(?:import|export)\b)[\s\S])*?)\bfrom\s*['"]\.\/([^'"]+)['"]/g
  return [...source.matchAll(statement)]
    .filter(match => match[2] === base && !/^\s*type\b/.test(match[1] ?? ''))
    .map(match => match[0])
}

describe('a .web file and its native twin', () => {
  it('tells a value import from a type import', () => {
    expect(valueImportsOf("import { A } from './x'\nimport type { B } from './x'\n", 'x')).toEqual([
      "import { A } from './x'",
    ])
    expect(valueImportsOf("export { C } from './x'", 'x')).toHaveLength(1)
    expect(valueImportsOf("import { D } from './xy'\nimport { E } from '../x'", 'x')).toEqual([])
  })

  it('never imports a value from its own base name, which on web is itself', () => {
    const webFiles = (readdirSync(appSrc, { recursive: true }) as string[]).filter(file =>
      /\.web\.tsx?$/.test(file),
    )
    const offenders = webFiles.flatMap(file => {
      const base = (file.split(/[\\/]/).pop() ?? '').replace(/\.web\.tsx?$/, '')
      return valueImportsOf(readFileSync(join(appSrc, file), 'utf8'), base).map(found => `${file}: ${found}`)
    })

    expect(webFiles.length).toBeGreaterThan(0)
    expect(offenders).toEqual([])
  })
})
