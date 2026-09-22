import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderPrivacyPage } from '@selfmp3/shared'

/**
 * public/privacy.html, from the policy in packages/shared/src/privacy.ts:
 * written before every web export and every web dev start, and ignored by
 * git, so the page and the words never drift apart. Needs the packages
 * built first (`npm run build:packages`), as everything importing them does.
 */
const out = resolve(dirname(fileURLToPath(import.meta.url)), '../public/privacy.html')
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, renderPrivacyPage())
console.log(`wrote ${out}`)
