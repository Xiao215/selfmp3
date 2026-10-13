/** What the player tells either `bucketMedia` twin; only the phone's reads it. */
export interface BucketMediaSetup {
  /** A song's key in the bucket, or null for one this library does not have. */
  readonly pathOf: (songId: number) => string | null
  /** The doorman session's token, or null while signed out. */
  readonly bearer: string | null
}
