import { z } from 'zod'
import type { KeyValueStore } from './store.js'

/**
 * The extension's own options, kept by the worker where no page can reach
 * them (store.ts says why IndexedDB).
 *
 * `useYouTubeSignIn`: when the web app downloads a song in the browser
 * (docs/features/client-download.md), its player request goes with this
 * browser's YouTube sign-in. YouTube then counts it against the account
 * rather than the address, which lets far more through — at the risk of the
 * account being flagged for downloading. Off unless the person turns it on,
 * and only here: the extension is what would send the sign-in, and no page
 * should be able to decide that for it.
 */

const OPTIONS_KEY = 'options'

export const ExtensionOptionsSchema = z.object({
  useYouTubeSignIn: z.boolean(),
})
type ExtensionOptions = z.infer<typeof ExtensionOptionsSchema>

const DEFAULTS: ExtensionOptions = { useYouTubeSignIn: false }

export async function readOptions(store: KeyValueStore): Promise<ExtensionOptions> {
  const parsed = ExtensionOptionsSchema.safeParse(await store.read(OPTIONS_KEY))
  return parsed.success ? parsed.data : DEFAULTS
}

export async function writeOptions(
  store: KeyValueStore,
  options: ExtensionOptions,
): Promise<ExtensionOptions> {
  await store.write(OPTIONS_KEY, options)
  return options
}
