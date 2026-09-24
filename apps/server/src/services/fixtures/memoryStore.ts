import { Readable } from 'node:stream'
import {
  CloudError,
  type CloudObject,
  type CloudPutOptions,
  type CloudStore,
} from '../../bucket/store.js'

/**
 * A bucket in memory, for tests. Here rather than beside `bucket/store.ts`
 * because nothing the server ships uses it, and `fixtures/` is outside the
 * build (apps/server/tsconfig.json). It keeps what each upload said about itself
 * so a test can check the headers, counts uploads so a test can prove a file
 * was not sent twice, and can be told to fail like a bucket that is out of
 * reach or refuses the key.
 */
export class MemoryCloudStore implements CloudStore {
  readonly description = 'memory'
  readonly objects = new Map<string, { body: Buffer } & CloudPutOptions>()
  /** Every key put, in order, including repeats. */
  readonly puts: string[] = []
  /** Every key read, in order, so a test can prove a file was not fetched twice. */
  readonly gets: string[] = []
  /** While set, every operation fails with this. */
  failure: CloudError | null = null
  /** Keys the bucket will not take, each with its reason: a full bucket refuses the next file, not the last. */
  readonly refused = new Map<string, CloudError>()

  goOffline(): void {
    this.failure = new CloudError('network', 'Could not reach the bucket.')
  }

  comeBack(): void {
    this.failure = null
  }

  head(key: string): Promise<CloudObject | null> {
    return this.#answer(() => {
      const object = this.objects.get(key)
      return object ? { key, size: object.body.length } : null
    })
  }

  get(key: string): Promise<Buffer | null> {
    return this.#answer(() => {
      this.gets.push(key)
      return this.objects.get(key)?.body ?? null
    })
  }

  range(key: string, start: number, end: number): Promise<NodeJS.ReadableStream | null> {
    return this.#answer(() => {
      const object = this.objects.get(key)
      if (!object) return null
      this.gets.push(key)
      return Readable.from([object.body.subarray(start, end + 1)])
    })
  }

  put(key: string, body: Buffer, options: CloudPutOptions): Promise<void> {
    return this.#answer(() => {
      this.puts.push(key)
      const refusal = this.refused.get(key)
      if (refusal) throw refusal
      this.objects.set(key, { body: Buffer.from(body), ...options })
    })
  }

  list(prefix: string): Promise<CloudObject[]> {
    return this.#answer(() =>
      [...this.objects.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, object]) => ({ key, size: object.body.length }))
        .sort((a, b) => a.key.localeCompare(b.key)),
    )
  }

  delete(key: string): Promise<void> {
    return this.#answer(() => {
      this.objects.delete(key)
    })
  }

  /** Keys under a folder, for assertions. */
  keys(prefix = ''): string[] {
    return [...this.objects.keys()].filter(key => key.startsWith(prefix)).sort()
  }

  /** Like a real bucket, every answer arrives later — or fails, when told to. */
  #answer<T>(work: () => T): Promise<T> {
    if (this.failure) return Promise.reject(this.failure)
    return Promise.resolve().then(work)
  }
}
