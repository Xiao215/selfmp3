import type { Review } from '@selfmp3/client'
import type { PrefStore } from '../../ports/prefs'
import {
  emptyDraft,
  IMPORT_DRAFT_KEY,
  parseImportDraft,
  serialiseImportDraft,
  type DraftChanges,
  type DraftSource,
  type ImportDraft,
} from './importDraft.model'
import { chooseAll, renameSong, toggleChosen, type Rename } from './review.model'

/**
 * The one import draft, kept in the `prefs` port.
 *
 * Kept outside the screens, because they do not stay: the review is a page of
 * its own (`/import/review`), a look at the library from the sidebar unmounts
 * either, and a forty-track review thinned and corrected by hand was gone on
 * the way back. Kept in `prefs` rather than in memory alone, because a page
 * does not stay either: a phone's browser reloads a tab it put to sleep, and a
 * reload used to be back at an empty Import with the whole review lost.
 *
 * One draft at a time. A draft made against one source is not shown for
 * another, since tag ids are that server's, and writing for the other source
 * starts afresh rather than mixing the two.
 *
 * A factory over the port rather than the port itself, so the store can be
 * tested against a store in memory — the port reads a file on a phone.
 */
interface ImportDraftStore {
  /** The draft as one source sees it: its own, or nothing yet. */
  draftFor(source: DraftSource): ImportDraft
  /** Change part of one source's draft; another source's is replaced, not mixed with. */
  patchDraft(source: DraftSource, changes: DraftChanges): void
  /** Tick one song of the review, or untick it. Nothing, with no review. */
  toggleChosenIn(source: DraftSource, index: number): void
  /** Tick every song of the review that can be, or untick them all. */
  chooseAllIn(source: DraftSource, on: boolean): void
  /** Rename one song of the review: its title, its artist, its album, or any of them. */
  renameIn(source: DraftSource, index: number, rename: Rename): void
  /** Drop one source's draft: its server was left, so its tag ids mean nothing now. */
  forget(source: DraftSource): void
  /** The draft, whichever source it is for; the same object until it changes. */
  current(): ImportDraft
  subscribe(listener: () => void): () => void
  /** Tests only: back to nothing typed. */
  reset(): void
}

export function createImportDraftStore(prefs: PrefStore): ImportDraftStore {
  /** Read once, on first use, then kept. */
  let draft: ImportDraft | null = null
  const listeners = new Set<() => void>()

  const current = (): ImportDraft => {
    draft ??= parseImportDraft(prefs.get(IMPORT_DRAFT_KEY)) ?? emptyDraft('own')
    return draft
  }

  const write = (next: ImportDraft): void => {
    draft = next
    prefs.set(IMPORT_DRAFT_KEY, serialiseImportDraft(next))
    for (const listener of listeners) listener()
  }

  const draftFor = (source: DraftSource): ImportDraft => {
    const shown = current()
    return shown.source === source ? shown : emptyDraft(source)
  }

  const patchDraft = (source: DraftSource, changes: DraftChanges): void => {
    write({ ...draftFor(source), ...changes })
  }

  const patchReview = (source: DraftSource, change: (review: Review) => Review): void => {
    const { review } = draftFor(source)
    if (review) patchDraft(source, { review: change(review) })
  }

  return {
    draftFor,
    patchDraft,
    toggleChosenIn: (source, index) => patchReview(source, review => toggleChosen(review, index)),
    chooseAllIn: (source, on) => patchReview(source, review => chooseAll(review, on)),
    renameIn: (source, index, rename) =>
      patchReview(source, review => renameSong(review, index, rename)),
    forget: source => {
      if (current().source === source) write(emptyDraft(source))
    },
    current,
    subscribe: listener => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    reset: () => write(emptyDraft('own')),
  }
}
