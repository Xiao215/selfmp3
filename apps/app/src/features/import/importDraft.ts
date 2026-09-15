import { useSyncExternalStore } from 'react'
import type { Review } from '@selfmp3/client'

/**
 * What the Import screen holds between a link being fetched and imported:
 * the links typed, the review, and how it is to be tagged and filed.
 *
 * Kept outside the screen, because the screen does not stay: a look at the
 * library from the sidebar unmounts it, and a forty-track review chosen and
 * corrected by hand was gone on the way back. One draft, for the app's life;
 * a draft made against one server is not shown for another, since tag and
 * playlist ids are that server's.
 */
export interface ImportDraft {
  /** Whose ids the draft's tags and playlists are: a server's address, or this device's own. */
  readonly source: string
  readonly links: string
  readonly review: Review | null
  readonly tagIds: ReadonlySet<number>
  /** `0` for "don't add to a playlist". */
  readonly playlistId: number
  readonly createPlaylist: boolean
}

export type DraftChanges = Partial<Omit<ImportDraft, 'source'>>

const EMPTY: Omit<ImportDraft, 'source'> = {
  links: '',
  review: null,
  tagIds: new Set<number>(),
  playlistId: 0,
  createPlaylist: false,
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

/** The draft for one source, and a way to change part of it. */
export function useImportDraft(
  source: string,
): readonly [ImportDraft, (changes: DraftChanges) => void] {
  const current = useSyncExternalStore(subscribe, () => draft, () => draft)
  const shown = current.source === source ? current : draftFor(source)
  return [shown, changes => patchDraft(source, changes)]
}

/** Tests only: back to nothing typed. */
export function resetImportDraft(): void {
  draft = { source: '', ...EMPTY }
  for (const listener of listeners) listener()
}
