import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ApplyMetadata, MetadataLookupResponse } from '@selfmp3/shared'
import {
  queryKeys,
  useApplyMetadata,
  useMetadataLookup,
  type ServerConnection,
} from '@selfmp3/client'
import { apiFor } from '../../api/client'
import { library as cloudLibrary } from '../../replica'

/**
 * Whom "Fix metadata…" talks to: whatever answers this device, or — from a
 * cloud library, with the server within reach — that server directly.
 *
 * The lookup is the server's because the server is what asks iTunes and
 * MusicBrainz, keeps the day-long cache of their answers, and downloads the
 * cover it is told to. None of that can happen in the bucket.
 *
 * `songId` is the song in the answering library's own numbering — the caller
 * translates (`useServerSongIds`) before asking.
 */
interface MetadataSource {
  readonly lookup: {
    readonly data: MetadataLookupResponse | undefined
    readonly isPending: boolean
    readonly isError: boolean
    readonly isSuccess: boolean
  }
  readonly apply: {
    readonly mutate: (input: ApplyMetadata, options: { onSuccess: () => void }) => void
    readonly isPending: boolean
    readonly isError: boolean
    readonly error: Error | null
  }
}

const noServer = (): Promise<never> => Promise.reject(new Error('no server to ask'))

export function useMetadataSource(
  via: ServerConnection | undefined,
  songId: number,
): MetadataSource {
  const client = useQueryClient()
  const ownLookup = useMetadataLookup(songId, via === undefined)
  const ownApply = useApplyMetadata()

  const serverLookup = useQuery({
    queryKey: ['via-server', via?.baseUrl, 'metadata', 'lookup', songId] as const,
    queryFn: () => (via ? apiFor(via).lookupMetadata(songId) : noServer()),
    enabled: via !== undefined,
    staleTime: 10 * 60_000,
    retry: false,
  })

  /*
   * Applied on the server, so the correction lands in its database and reaches
   * this device the way every other change does: with the server's next
   * snapshot. Asking for the library again here would only redraw the same old
   * title, so this marks the cloud copy stale and lets the next look fetch it.
   */
  const serverApply = useMutation({
    mutationFn: (input: ApplyMetadata) =>
      via ? apiFor(via).applyMetadata(songId, input) : noServer(),
    onSuccess: () => {
      cloudLibrary.markCloudLibraryStale()
      void client.invalidateQueries({ queryKey: queryKeys.library })
      // A corrected title or artist is a new search: the next look-up asks again.
      void client.invalidateQueries({ queryKey: ['via-server', via?.baseUrl, 'metadata'] })
    },
  })

  if (via) {
    return {
      lookup: serverLookup,
      apply: {
        mutate: (input, options) => serverApply.mutate(input, options),
        isPending: serverApply.isPending,
        isError: serverApply.isError,
        error: serverApply.error,
      },
    }
  }
  return {
    lookup: ownLookup,
    apply: {
      mutate: (input, options) =>
        ownApply.mutate(
          { id: songId, input },
          {
            onSuccess: () => {
              void client.invalidateQueries({ queryKey: queryKeys.metadataLookup(songId) })
              options.onSuccess()
            },
          },
        ),
      isPending: ownApply.isPending,
      isError: ownApply.isError,
      error: ownApply.error,
    },
  }
}
