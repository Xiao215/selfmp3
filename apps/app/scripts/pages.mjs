import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderBucketGuidePage, renderPrivacyPage } from '@selfmp3/shared'

/**
 * The plain pages published beside the app — public/privacy.html from the
 * policy in packages/shared/src/privacy.ts, public/bucket.html from the guide
 * in packages/shared/src/bucketGuide.ts: written before every web export and
 * every web dev start, and ignored by git, so the pages and the words never
 * drift apart. Needs the packages built first (`npm run build:packages`), as
 * everything importing them does.
 */
const pub = resolve(dirname(fileURLToPath(import.meta.url)), '../public')
mkdirSync(pub, { recursive: true })
for (const [name, page] of [
  ['privacy.html', renderPrivacyPage()],
  ['bucket.html', renderBucketGuidePage()],
]) {
  const out = resolve(pub, name)
  writeFileSync(out, page)
  console.log(`wrote ${out}`)
}
