import { useSyncExternalStore } from 'react'
import { prefs } from '../../ports/prefs'
import type { DraftChanges, DraftSource, ImportDraft } from './importDraft.model'
import { createImportDraftStore } from './importDraft.store'

/**
 * The app's import draft (importDraft.store.ts), kept with this device's
 * other small preferences, and the hook the Import screens read it through.
 */
const store = createImportDraftStore(prefs)

export const { draftFor, patchDraft, toggleChosenIn, chooseAllIn, renameIn } = store

/** Drop one source's draft: on signing out of the cloud, or leaving a server. */
export function forgetImportDraft(source: DraftSource): void {
  store.forget(source)
}

/** The draft for one source, and a way to change part of it. */
export function useImportDraft(
  source: DraftSource,
): readonly [ImportDraft, (changes: DraftChanges) => void] {
  const current = useSyncExternalStore(store.subscribe, store.current, store.current)
  const shown = current.source === source ? current : draftFor(source)
  return [shown, changes => patchDraft(source, changes)]
}

/** Tests only: back to nothing typed. */
export function resetImportDraft(): void {
  store.reset()
}
