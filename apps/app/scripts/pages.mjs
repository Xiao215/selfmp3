import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  INSTALL_PAGE_FONTS,
  renderBucketGuidePage,
  renderInstallPage,
  renderPrivacyPage,
} from '@selfmp3/shared'

/**
 * The plain pages published beside the app — public/privacy.html from the
 * policy in packages/shared/src/privacy.ts, public/bucket.html from the guide
 * in packages/shared/src/bucketGuide.ts, public/install.html from the iPhone
 * app's install page in packages/shared/src/installPage.ts, with the app's
 * fonts copied into public/fonts for it: written before every web export and
 * every web dev start, and ignored by git, so the pages and the words never
 * drift apart. Needs the packages built first (`npm run build:packages`), as
 * everything importing them does.
 */
const pub = resolve(dirname(fileURLToPath(import.meta.url)), '../public')
mkdirSync(pub, { recursive: true })
for (const [name, page] of [
  ['privacy.html', renderPrivacyPage()],
  ['bucket.html', renderBucketGuidePage()],
  ['install.html', renderInstallPage()],
]) {
  const out = resolve(pub, name)
  writeFileSync(out, page)
  console.log(`wrote ${out}`)
}

// The install page wears the app's faces, served from beside it rather than fetched.
const require = createRequire(import.meta.url)
mkdirSync(resolve(pub, 'fonts'), { recursive: true })
for (const [name, from] of Object.entries(INSTALL_PAGE_FONTS)) {
  copyFileSync(require.resolve(`@expo-google-fonts/${from}`), resolve(pub, 'fonts', name))
}
