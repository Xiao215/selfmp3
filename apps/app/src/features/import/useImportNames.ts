import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { STALE, type Api, type Review } from '@selfmp3/client'
import { useSmartSwitches } from '../smart/useSmartSwitches'
import type { DraftSource } from './importDraft.model'
import {
  rowsToAsk,
  suggestionsByRow,
  type AskedRow,
  type NameSuggestion,
} from './importNames.model'

/**
 * A9 · the model reads a review's names (docs/features/ai.md): once, as the
 * review opens, every row coming in is sent to the server, and what comes
 * back is a suggestion for the rows whose names look wrong.
 *
 * The rows are the ones on screen when the review first had any, not as they
 * change: a name typed into a row is not a new question for the model with
 * every letter. A row's suggestion is only offered while its names are still
 * the ones the model read (`suggestionFor`).
 *
 * Quiet by design: off in Settings, no model, the server away or the model
 * failing all mean no suggestions, and the review is the review it always was.
 */
export function useImportNames(
  api: Pick<Api, 'importNames'>,
  key: DraftSource,
  review: Review | null,
): ReadonlyMap<number, NameSuggestion> {
  const on = useSmartSwitches().import
  const [asked, setAsked] = useState<readonly AskedRow[] | null>(() =>
    review ? rowsToAsk(review) : null,
  )
  // A review that arrives after the page: its rows as they first are, once.
  if (asked === null && review) setAsked(rowsToAsk(review))
  const list = review?.playlistTitle ?? null

  const answer = useQuery({
    queryKey: ['import-names', key, list, asked],
    queryFn: ({ signal }) =>
      api.importNames(
        {
          list,
          rows: (asked ?? []).map(({ title, artist, album, duration }) => ({
            title,
            artist,
            album,
            duration,
          })),
        },
        signal,
      ),
    enabled: on && asked !== null && asked.length > 0,
    staleTime: STALE.tenMinutes,
    retry: false,
  })
  return useMemo(
    () => (answer.data && asked ? suggestionsByRow(asked, answer.data) : new Map()),
    [answer.data, asked],
  )
}
