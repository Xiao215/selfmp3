import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  INSTALL_PAGE_FONTS,
  PLAIN_PAGES,
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
const pages = {
  privacy: renderPrivacyPage,
  bucket: renderBucketGuidePage,
  install: renderInstallPage,
}
for (const name of PLAIN_PAGES) {
  const out = resolve(pub, `${name}.html`)
  const page = pages[name]()
  writeFileSync(out, page)
  console.log(`wrote ${out}`)
}

// The plain pages wear the app's faces (the install page both, the others the
// wordmark's), served from beside them rather than fetched.
const require = createRequire(import.meta.url)
mkdirSync(resolve(pub, 'fonts'), { recursive: true })
for (const [name, from] of Object.entries(INSTALL_PAGE_FONTS)) {
  copyFileSync(require.resolve(`@expo-google-fonts/${from}`), resolve(pub, 'fonts', name))
}
