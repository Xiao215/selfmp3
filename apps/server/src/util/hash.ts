import { createHash } from 'node:crypto'

/** The SHA-256 of some bytes or text, as hex: how the bucket names a file by its contents. */
export function sha256(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex')
}
