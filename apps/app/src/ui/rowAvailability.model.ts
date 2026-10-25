/** What a song row says about whether its song can play here. */
export interface RowAvailability {
  /** Kept on this device: the one mark a row carries for where its song is. */
  readonly downloaded: boolean
  /** Not here, with nothing to stream it from now: drawn faded. */
  readonly unavailable: boolean
}

/** Where songs come from at the moment, for every row at once. */
interface Sources {
  /** An installed app, which keeps songs; a browser streams everything. */
  readonly installed: boolean
  /** A library from the bucket with no connection, or with the bucket refusing reads today. */
  readonly streamBlocked: boolean
  /** The library's server did not answer. */
  readonly libraryUnreachable: boolean
}

/**
 * One rule for every list of songs — Library, Search, a tag's, an artist's, a
 * playlist's, an answer's and Up next: a song that is not here and has nowhere
 * to stream from is faded, so the list says so rather than a tap finding out.
 *
 * There had been three: Library's, the ordered lists' (which agreed with it in
 * other words), and Up next's, which knew only the bucket's side; Search and
 * the place pages faded nothing.
 *
 * A song that is not here carries no mark of its own (only the kept ones
 * do), and a browser's server being away fades nothing there: every song is
 * equally out of reach, which the page already says.
 */
export function rowAvailability(here: boolean, sources: Sources, kept = false): RowAvailability {
  return {
    downloaded: here,
    // A song a browser's worker kept for having played it is no download, but
    // it plays from here when nothing can be streamed.
    unavailable:
      !here &&
      !kept &&
      (sources.streamBlocked || (sources.installed && sources.libraryUnreachable)),
  }
}
