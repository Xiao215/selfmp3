import { useSyncExternalStore } from 'react'
import type { Review } from '@selfmp3/client'
import { renameSong, toggleLeftOut, type Rename } from './review.model'

/**
 * What Import holds between a link being looked up and imported: the links
 * typed, the review, and the tags it will arrive with.
 *
 * Kept outside the screens, because they do not stay: the review is a page of
 * its own (`/import/review`), a look at the library from the sidebar unmounts
 * either, and a forty-track review thinned and corrected by hand was gone on
 * the way back. One draft, for the app's life; a draft made against one server
 * is not shown for another, since tag ids are that server's.
 */
interface ImportDraft {
  /** Whose ids the draft's tags are: a server's address, or this device's own. */
  readonly source: string
  readonly links: string
  readonly review: Review | null
  readonly tagIds: ReadonlySet<number>
}

type DraftChanges = Partial<Omit<ImportDraft, 'source'>>

const EMPTY: Omit<ImportDraft, 'source'> = {
  links: '',
  review: null,
  tagIds: new Set<number>(),
}

let draft: ImportDraft = { source: '', ...EMPTY }
const listeners = new Set<() => void>()

/** The draft as one source sees it: its own, or nothing yet. */
export function draftFor(source: string): ImportDraft {
  return draft.source === source ? draft : { source, ...EMPTY }
}

/** Change part of one source's draft; another source's is replaced, not mixed with. */
export function patchDraft(source: string, changes: DraftChanges): void {
  draft = { ...draftFor(source), ...changes }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Leave one song of the review out, or bring it back. Nothing, with no review. */
export function leaveOutIn(source: string, index: number): void {
  const { review } = draftFor(source)
  if (review) patchDraft(source, { review: toggleLeftOut(review, index) })
}

/** Rename one song of the review: its title, its artist, or both. */
export function renameIn(source: string, index: number, rename: Rename): void {
  const { review } = draftFor(source)
  if (review) patchDraft(source, { review: renameSong(review, index, rename) })
}

/** The draft for one source, and a way to change part of it. */
export function useImportDraft(
  source: string,
): readonly [ImportDraft, (changes: DraftChanges) => void] {
  const current = useSyncExternalStore(
    subscribe,
    () => draft,
    () => draft,
  )
  const shown = current.source === source ? current : draftFor(source)
  return [shown, changes => patchDraft(source, changes)]
}

/** Tests only: back to nothing typed. */
export function resetImportDraft(): void {
  draft = { source: '', ...EMPTY }
  for (const listener of listeners) listener()
}
