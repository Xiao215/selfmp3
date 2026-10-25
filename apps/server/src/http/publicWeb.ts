import dns, { type LookupAddress } from 'node:dns'
import net from 'node:net'
import { Agent, fetch } from 'undici'
import { readCapped } from '../services/fetching.js'

/**
 * Fetching an address someone else chose — a cover's link from a look-up, a
 * thumbnail yt-dlp reported, artwork a client sent — from the open web only.
 *
 * The server sits on a home network and a tailnet, beside the doorman's
 * secrets and its own API. A link must not be able to point it at any of that:
 * `http://127.0.0.1:4000/api/...`, the router, `169.254.169.254`, a Pi on the
 * tailnet. So only http(s) is fetched, an address written as numbers must be a
 * public one, and a name is checked against what it resolved to at the moment
 * of connecting (not a look-up made beforehand, which the name's owner could
 * answer differently the second time). Every redirect is followed by hand and
 * checked the same way.
 */

/** Addresses that are not the open internet. */
const NOT_PUBLIC = new net.BlockList()
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // carrier-grade NAT, and Tailscale's addresses
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  NOT_PUBLIC.addSubnet(address, prefix, 'ipv4')
}
for (const [address, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['100::', 64],
  ['2001:db8::', 32],
  ['fc00::', 7], // unique local, and Tailscale's IPv6 addresses
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8],
] as const) {
  NOT_PUBLIC.addSubnet(address, prefix, 'ipv6')
}

/**
 * Whether an IP address is on the open internet. An IPv4 address written as
 * IPv6 (`::ffff:127.0.0.1`) is judged as the IPv4 one.
 */
export function isPublicAddress(address: string): boolean {
  const family = net.isIP(address)
  if (family === 0) return false
  return !NOT_PUBLIC.check(address, family === 4 ? 'ipv4' : 'ipv6')
}

class NotPublic extends Error {
  constructor(where: string) {
    super(`${where} is not on the open web`)
  }
}

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void

/** `dns.lookup`, refusing a name that resolves anywhere but the open web. */
function publicLookup(allowed: (address: string) => boolean) {
  return (hostname: string, options: dns.LookupOptions, callback: LookupCallback): void => {
    dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
      if (error) return callback(error, [])
      const usable = addresses.filter(entry => allowed(entry.address))
      // One address off the open web is enough to refuse the name: a public
      // first answer with a private second is still a way in.
      if (usable.length === 0 || usable.length < addresses.length) {
        return callback(new NotPublic(hostname), [])
      }
      if (options.all) return callback(null, usable)
      const [first] = usable as [LookupAddress]
      callback(null, first.address, first.family)
    })
  }
}

const REDIRECTS = 5

interface PublicFile {
  contentType: string
  /** Null when it ran past the limit. */
  data: Buffer | null
}

/**
 * GET `url` from the open web, following up to five redirects, each checked,
 * and read at most `limit` bytes of it. Null for an answer that is not a 2xx;
 * throws if any step leads off the open web. `allowed` is for tests, which can
 * only stand up a server on this machine.
 */
export async function fetchPublic(
  url: string,
  { signal, limit }: { signal: AbortSignal; limit: number },
  allowed: (address: string) => boolean = isPublicAddress,
): Promise<PublicFile | null> {
  const dispatcher = new Agent({
    allowH2: false,
    connect: { lookup: publicLookup(allowed) },
  })
  try {
    let at = new URL(url)
    for (let hop = 0; hop <= REDIRECTS; hop++) {
      if (at.protocol !== 'http:' && at.protocol !== 'https:') throw new NotPublic(at.href)
      const host = at.hostname.replace(/^\[|\]$/g, '')
      if (net.isIP(host) && !allowed(host)) throw new NotPublic(host)

      const response = await fetch(at, { signal, redirect: 'manual', dispatcher }).catch(
        (error: unknown) => {
          // fetch reports a refused look-up as "fetch failed"; say which.
          throw error instanceof Error && error.cause instanceof NotPublic ? error.cause : error
        },
      )
      const location = response.headers.get('location')
      if (response.status >= 300 && response.status < 400 && location) {
        await response.body?.cancel()
        at = new URL(location, at)
        continue
      }
      if (!response.ok) {
        await response.body?.cancel()
        return null
      }
      const contentType = response.headers.get('content-type') ?? ''
      const declared = Number(response.headers.get('content-length') ?? Number.NaN)
      if (Number.isFinite(declared) && declared > limit) {
        await response.body?.cancel()
        return { contentType, data: null }
      }
      // undici's own Response, the same shape as the platform's.
      return { contentType, data: await readCapped(response as unknown as Response, limit) }
    }
    throw new Error(`more than ${REDIRECTS} redirects from ${url}`)
  } finally {
    await dispatcher.destroy()
  }
}
