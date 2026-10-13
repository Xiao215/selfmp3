import { chooseSource, lookAgain, withFound, type Review } from '@selfmp3/client'
import type { ImportFound, ImportSource } from '@selfmp3/shared'
import type { PrefStore } from '../../ports/prefs'
import {
  emptyDraft,
  IMPORT_DRAFT_KEY,
  parseImportDraft,
  serialiseImportDraft,
  type DraftChanges,
  type DraftList,
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
  /*
   * Each change below is to the review, or — given `list` — to a search's
   * songs, which are review rows too and change the same way.
   */
  /** Tick one song, or untick it. Nothing, with no such list. */
  toggleChosenIn(source: DraftSource, index: number, list?: DraftList): void
  /** Tick every song that can be, or untick them all. */
  chooseAllIn(source: DraftSource, on: boolean, list?: DraftList): void
  /** Rename one song: its title, its artist, its album, or any of them. */
  renameIn(source: DraftSource, index: number, rename: Rename, list?: DraftList): void
  /** Take one song from 网易云 or from YouTube (`chooseSource`). */
  chooseSourceIn(source: DraftSource, index: number, from: ImportSource, list?: DraftList): void
  /** Look for one song on YouTube again, by its name as it is now. */
  lookAgainIn(source: DraftSource, index: number, list?: DraftList): void
  /**
   * What YouTube said for some rows, written in — only into a row still
   * looking for the very song that was asked about: a list replaced
   * meanwhile, or a name changed and looked for again, is not answered by an
   * old question.
   */
  foundIn(
    source: DraftSource,
    asked: readonly { index: number; title: string; artist: string }[],
    found: readonly (ImportFound | null)[],
    list?: DraftList,
  ): void
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

  const patchReview = (
    source: DraftSource,
    change: (review: Review) => Review,
    list: DraftList = 'review',
  ): void => {
    const draft = draftFor(source)
    if (list === 'review') {
      if (draft.review) patchDraft(source, { review: change(draft.review) })
      return
    }
    if (draft.search) {
      patchDraft(source, { search: { ...draft.search, review: change(draft.search.review) } })
    }
  }

  return {
    draftFor,
    patchDraft,
    toggleChosenIn: (source, index, list) =>
      patchReview(source, review => toggleChosen(review, index), list),
    chooseAllIn: (source, on, list) => patchReview(source, review => chooseAll(review, on), list),
    renameIn: (source, index, rename, list) =>
      patchReview(source, review => renameSong(review, index, rename), list),
    chooseSourceIn: (source, index, from, list) =>
      patchReview(source, review => chooseSource(review, index, from), list),
    lookAgainIn: (source, index, list) =>
      patchReview(source, review => lookAgain(review, index), list),
    foundIn: (source, asked, found, list) =>
      patchReview(
        source,
        review => {
          const still = asked.flatMap((question, at) => {
            const item = review.items[question.index]
            const same =
              item?.youtube?.match === 'looking' &&
              item.title === question.title &&
              item.artist === question.artist
            return same ? [{ index: question.index, found: found[at] ?? null }] : []
          })
          if (still.length === 0) return review
          return withFound(
            review,
            still.map(answer => answer.index),
            still.map(answer => answer.found),
          )
        },
        list,
      ),
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
