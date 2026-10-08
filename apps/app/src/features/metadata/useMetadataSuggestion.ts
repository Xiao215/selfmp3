import { useEffect, useRef } from 'react'
import { useMutation, type UseMutationResult } from '@tanstack/react-query'
import type { MetadataSuggestion } from '@selfmp3/shared'
import { ApiError } from '@selfmp3/client'
import { useSmartServer } from '../smart/useSmartServer'
import { useSmartSwitches } from '../smart/useSmartSwitches'

interface Suggesting {
  /** The switch in Settings › Smart features: off, the card is not drawn. */
  readonly on: boolean
  /** Asked for the song; `true` asks afresh rather than for the answer the server kept. */
  readonly ask: UseMutationResult<MetadataSuggestion, Error, boolean>
}

/**
 * Fix metadata's Suggested card: the model's reading of the song's names and
 * the catalogues' listings, asked of the server — which holds the model and
 * the lookups — with the smart features' long wait (`useSmartServer`), not
 * the fifteen seconds an ordinary request gets.
 *
 * Asked when someone presses for it, or by the dialog when nothing matched,
 * rather than every time the dialog opens: each answer is a model call. The
 * server keeps answers for the same question, so pressing it again after
 * closing the dialog is quick. Closing the dialog stops one under way.
 *
 * `askFor` is the song's id in the server's numbering, as the dialog has it.
 */
export function useMetadataSuggestion(askFor: number): Suggesting {
  const switches = useSmartSwitches()
  const server = useSmartServer()
  const waiting = useRef<AbortController | null>(null)
  useEffect(() => () => waiting.current?.abort(), [])

  const ask = useMutation({
    mutationFn: async (again: boolean): Promise<MetadataSuggestion> => {
      // Suggesting is asked of the server, which holds the model: without it
      // the library is, as far as this card goes, unreachable.
      if (!server.api) throw new ApiError(0, 'no server to suggest with', 'offline')
      waiting.current?.abort()
      const stop = new AbortController()
      waiting.current = stop
      return server.api.suggestMetadata(askFor, again, stop.signal)
    },
  })

  return { on: switches.metadata, ask }
}
