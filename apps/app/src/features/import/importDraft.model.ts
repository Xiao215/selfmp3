import { z } from 'zod'
import {
  ImportFromSchema,
  ImportPreviewItemSchema,
  UnreadLinkSchema,
  linkIdentity,
  type ImportPreviewItem,
} from '@selfmp3/shared'
import type { Review, ServerConnection } from '@selfmp3/client'

/**
 * What Import holds between a link being looked up and imported: the links
 * typed, the review, and the tags it will arrive with — and how it is written
 * down, so a reload does not lose it.
 *
 * The rules are here, pure; the store around them (importDraft.store.ts) reads
 * and writes the `prefs` port, which a pure test cannot.
 */

/**
 * Whose ids the draft's tags are: this device's own server, or the server
 * behind its cloud library. Not the server's address — a cloud library's
 * server is raced at every address it has (`reach.ts`), and whichever answers
 * first is the same server with the same tags. Keying the draft by the winner
 * threw a forty-track review away each time a different address won.
 */
export type DraftSource = 'own' | 'cloud'

/** The source a screen's draft belongs to, from how it reached its server. */
export function draftSourceFor(via: ServerConnection | undefined): DraftSource {
  return via === undefined ? 'own' : 'cloud'
}

/**
 * Words typed into the box, and what they found (docs/features/import-sources.md,
 * "Searching"): the review's rows, ticked to import, under the box. Songs
 * ticked in an earlier search stay ticked above a new search's songs, so a
 * few songs can be gathered one search at a time; `picked` is how many rows
 * at the top are those.
 */
interface DraftSearch {
  readonly query: string
  readonly review: Review
  readonly picked: number
}

export interface ImportDraft {
  readonly source: DraftSource
  readonly links: string
  readonly review: Review | null
  readonly search: DraftSearch | null
  readonly tagIds: ReadonlySet<number>
}

/** Which of the draft's lists a change is to: a looked-up link's review, or a search's songs. */
export type DraftList = 'review' | 'search'

/**
 * A new search's songs, under the songs ticked in the searches before it.
 * Nothing found is ticked: a search is browsing, and what it found is
 * yours to pick. A song ticked before and found again is the ticked one,
 * kept above, not a second row: the same song by any link the two rows share.
 * One search can find a song on both 网易云 and YouTube and the next on
 * YouTube alone, so the rows' own links (`url`) may differ while the YouTube
 * video under both is the same.
 */
export function withSearchResults(
  previous: DraftSearch | null,
  query: string,
  items: readonly ImportPreviewItem[],
): DraftSearch {
  const before = previous?.review
  const kept = before ? before.items.filter((_, index) => before.chosen.has(index)) : []
  const keys = new Set(kept.flatMap(songLinks))
  const found = items.filter(item => !songLinks(item).some(link => keys.has(link)))
  return {
    query,
    picked: kept.length,
    review: {
      items: [...kept, ...found],
      chosen: new Set(kept.map((_, index) => index)),
      playlistTitle: query,
      from: 'search',
      unread: [],
    },
  }
}

/** Every link a row's song goes by, each as `linkIdentity` reads it. */
const songLinks = (item: ImportPreviewItem): string[] =>
  [item.url, item.netease?.url, item.youtube?.url].flatMap(url => {
    const identity = linkIdentity(url)
    return identity ? [identity] : []
  })

export type DraftChanges = Partial<Omit<ImportDraft, 'source'>>

export function emptyDraft(source: DraftSource): ImportDraft {
  return { source, links: '', review: null, search: null, tagIds: new Set() }
}

/** The `prefs` key the draft is kept under. */
export const IMPORT_DRAFT_KEY = 'import-draft'

/** A review as it is written down: its ticks as an array. */
const StoredReviewSchema = z.object({
  items: z.array(ImportPreviewItemSchema),
  chosen: z.array(z.number().int().nonnegative()),
  playlistTitle: z.string().nullable(),
  from: ImportFromSchema,
  unread: z.array(UnreadLinkSchema).default([]),
})
type StoredReview = z.infer<typeof StoredReviewSchema>

/** The draft as it is written down: sets as arrays, and nothing else changed. */
const StoredDraftSchema = z.object({
  source: z.enum(['own', 'cloud']),
  links: z.string(),
  review: StoredReviewSchema.nullable(),
  search: z
    .object({
      query: z.string(),
      review: StoredReviewSchema,
      picked: z.number().int().nonnegative(),
    })
    .nullable(),
  tagIds: z.array(z.number().int()),
})

/**
 * A draft out of what was stored, or null for anything that is not one.
 *
 * Defensive because it is read from a store a person can edit (`localStorage`
 * in a browser): a draft that does not parse, whatever wrote it, reads as no
 * draft rather than a crash, and the review is simply looked up again.
 */
export function parseImportDraft(raw: string | null): ImportDraft | null {
  if (!raw) return null
  let stored: unknown
  try {
    stored = JSON.parse(raw)
  } catch {
    return null
  }
  const result = StoredDraftSchema.safeParse(stored)
  if (!result.success) return null
  const { source, links, review, search, tagIds } = result.data
  return {
    source,
    links,
    review: review === null ? null : readReview(review),
    search:
      search === null
        ? null
        : {
            query: search.query,
            review: readReview(search.review),
            picked: Math.min(search.picked, search.review.items.length),
          },
    tagIds: new Set(tagIds),
  }
}

function readReview(review: StoredReview): Review {
  return {
    items: review.items,
    chosen: new Set(review.chosen.filter(index => index < review.items.length)),
    playlistTitle: review.playlistTitle,
    from: review.from,
    unread: review.unread,
  }
}

function writeReview(review: Review): StoredReview {
  return {
    items: [...review.items],
    chosen: [...review.chosen],
    playlistTitle: review.playlistTitle,
    from: review.from,
    unread: [...review.unread],
  }
}

export function serialiseImportDraft(draft: ImportDraft): string {
  return JSON.stringify({
    source: draft.source,
    links: draft.links,
    review: draft.review === null ? null : writeReview(draft.review),
    search:
      draft.search === null ? null : { ...draft.search, review: writeReview(draft.search.review) },
    tagIds: [...draft.tagIds],
  })
}
