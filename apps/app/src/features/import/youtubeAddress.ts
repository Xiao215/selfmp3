/**
 * Where YouTube last saw this device: the address it wrote into the link of
 * the last song downloaded here (`youtubeAddressOf`, in a file's meta), for
 * the server to compare with its own (docs/features/client-download.md,
 * "One address").
 *
 * Believed for an hour. A phone moves between networks, and an address
 * from the last one says nothing of this one — but the next song downloaded
 * here says it again, and a stale one only ever sends songs to the server
 * that this device could have downloaded.
 */

const FRESH_MS = 60 * 60_000

let last: { address: string; at: number } | null = null

export const youtubeAddress = {
  note(address: string | null, now = Date.now()): void {
    if (address) last = { address, at: now }
  },
  get(now = Date.now()): string | null {
    return last && now - last.at < FRESH_MS ? last.address : null
  },
}
