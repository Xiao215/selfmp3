import { z } from 'zod'
import { ImportPreviewItemSchema } from '@selfmp3/shared'
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

export interface ImportDraft {
  readonly source: DraftSource
  readonly links: string
  readonly review: Review | null
  readonly tagIds: ReadonlySet<number>
}

export type DraftChanges = Partial<Omit<ImportDraft, 'source'>>

export function emptyDraft(source: DraftSource): ImportDraft {
  return { source, links: '', review: null, tagIds: new Set() }
}

/** The `prefs` key the draft is kept under. */
export const IMPORT_DRAFT_KEY = 'import-draft'

/** The draft as it is written down: sets as arrays, and nothing else changed. */
const StoredDraftSchema = z.object({
  source: z.enum(['own', 'cloud']),
  links: z.string(),
  review: z
    .object({
      items: z.array(ImportPreviewItemSchema),
      chosen: z.array(z.number().int().nonnegative()),
      playlistTitle: z.string().nullable(),
    })
    .nullable(),
  tagIds: z.array(z.number().int()),
})

/**
 * A draft out of what was stored, or null for anything that is not one.
 *
 * Defensive because it is read from a store a person can edit (`localStorage`
 * in a browser), and because what an older build wrote may not be the shape
 * this one expects: a draft that cannot be read is no draft, not a crash.
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
  const { source, links, review, tagIds } = result.data
  return {
    source,
    links,
    review:
      review === null
        ? null
        : {
            items: review.items,
            chosen: new Set(review.chosen.filter(index => index < review.items.length)),
            playlistTitle: review.playlistTitle,
          },
    tagIds: new Set(tagIds),
  }
}

export function serialiseImportDraft(draft: ImportDraft): string {
  return JSON.stringify({
    source: draft.source,
    links: draft.links,
    review:
      draft.review === null
        ? null
        : {
            items: draft.review.items,
            chosen: [...draft.review.chosen],
            playlistTitle: draft.review.playlistTitle,
          },
    tagIds: [...draft.tagIds],
  })
}
