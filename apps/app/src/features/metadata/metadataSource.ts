import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ApplyMetadata, MetadataLookupResponse } from '@selfmp3/shared'
import {
  queryKeys,
  useApplyMetadata,
  useMetadataLookup,
  usePatchSong,
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
 * translates (`useServerSongIds`) before asking — and `ownId` the same song in
 * this device's.
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

/**
 * How long a server's lookup answer is taken as current. The server keeps the
 * catalogues' answers for a day; the dialog re-asks after an apply anyway.
 */
const LOOKUP_STALE_MS = 10 * 60_000

export function useMetadataSource(
  via: ServerConnection | undefined,
  songId: number,
  ownId: number,
): MetadataSource {
  const client = useQueryClient()
  const ownLookup = useMetadataLookup(songId, via === undefined)
  const ownApply = useApplyMetadata()
  const patchHere = usePatchSong()

  const serverLookup = useQuery({
    queryKey: ['via-server', via?.baseUrl, 'metadata', 'lookup', songId] as const,
    queryFn: () => (via ? apiFor(via).lookupMetadata(songId) : noServer()),
    enabled: via !== undefined,
    staleTime: LOOKUP_STALE_MS,
    retry: false,
  })

  /*
   * The names are this device's own edit, like any other made on a cloud
   * library: they show the moment the dialog closes and reach the bucket, and
   * the server, from here. Only a cover goes to the server, which downloads it
   * and puts it in the bucket — that one arrives with the server's next sync,
   * so the cloud copy is marked stale for the look after it.
   */
  const serverApply = useMutation({
    mutationFn: async ({ artworkUrl, ...fields }: ApplyMetadata) => {
      if (!via) return noServer()
      if (Object.keys(fields).length > 0) {
        await patchHere.mutateAsync({ id: ownId, patch: fields })
      }
      if (artworkUrl) {
        await apiFor(via).applyMetadata(songId, { artworkUrl })
        cloudLibrary.markCloudLibraryStale()
      }
    },
    onSuccess: () => {
      // A corrected title or artist is a new search: the next look-up asks again.
      void client.invalidateQueries({ queryKey: ['via-server', via?.baseUrl, 'metadata'] })
    },
  })

  if (via) {
    return {
      lookup: serverLookup,
      apply: {
        mutate: serverApply.mutate,
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
