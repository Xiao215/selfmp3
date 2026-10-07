import type { ServerConnection } from '@selfmp3/client'

import { bucketMedia } from '../ports/bucketMedia'
import { mediaUrlFor } from './client'
import { serverRoutes, type MediaSources } from './mediaAddress.model'

/**
 * The remote places this device has for a library's media: the bucket's,
 * through whatever this platform has that can attach the doorman's header, and
 * the connected server's. Which of the two answers is the address model's rule
 * (`mediaAddress.model.ts`); this only gathers what there is.
 *
 * `coverSize` is what a server is asked to resize covers to; left out, the
 * original, which is what a caller that only wants to play something passes.
 */
export function mediaSourcesFor(
  connection: ServerConnection | null,
  fromCloud: boolean,
  coverSize?: number,
): Omit<MediaSources, 'local'> {
  return {
    bucket: bucketMedia,
    server: connection ? serverRoutes(mediaUrlFor(connection), coverSize) : null,
    fromCloud,
  }
}
