import { bytesToBase64, type ImportDeviceFileMeta } from '@selfmp3/shared'

/** The meta header's value: base64url JSON, as the server's file route reads it. */
export function metaHeader(meta: ImportDeviceFileMeta): string {
  return bytesToBase64(new TextEncoder().encode(JSON.stringify(meta)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}
