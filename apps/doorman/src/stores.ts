import { Bucket, type BucketDeps, type BucketTarget } from './bucket.js'
import { Drive, type DriveDeps, type DriveTarget } from './drive.js'
import type { DoormanStorage } from '@selfmp3/shared'
import type { Store } from './store.js'

/**
 * Where an account keeps its library, opened: everything the doorman needs to
 * reach it, the key or token included. Sealed in KV (accounts.ts), opened
 * only inside the Worker, never sent anywhere.
 */
export type AccountStorage = (
  ({ readonly kind: 'bucket' } & BucketTarget) | ({ readonly kind: 'drive' } & DriveTarget)
) & {
  /** Where the library was before it was moved here (move.ts), for `/v1/me` to say. */
  readonly movedFrom?: DoormanStorage | undefined
}

/** What the drivers need of the Worker: fetch, a clock, and what each keeps between requests. */
export interface StoreDeps {
  readonly bucket: BucketDeps
  readonly drive: DriveDeps
}

/** The account's storage as a `Store`: the driver its kind names. */
export function openStore(storage: AccountStorage, deps: StoreDeps): Store {
  return storage.kind === 'drive'
    ? new Drive(storage, deps.drive)
    : new Bucket(storage, deps.bucket)
}
