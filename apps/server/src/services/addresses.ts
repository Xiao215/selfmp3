import os from 'node:os'

/** One address this server listens on, and whether Tailscale handed it out. */
interface ListenAddress {
  readonly url: string
  readonly tailscale: boolean
}

/**
 * Every address this server can actually be reached on.
 *
 * The boot log prints them, and the cloud snapshot carries them
 * (services/cloudSnapshot.ts) so a device signed in to the bucket can find
 * this server when it is near enough — the same Wi-Fi, or the same tailnet — for
 * what only the server can do: read a link and play a song before importing it.
 */
export function listenAddresses(host: string, port: number): ListenAddress[] {
  if (host !== '0.0.0.0' && host !== '::')
    return [{ url: `http://${host}:${port}`, tailscale: false }]

  const addresses: ListenAddress[] = [{ url: `http://localhost:${port}`, tailscale: false }]
  for (const found of Object.values(os.networkInterfaces())) {
    for (const address of found ?? []) {
      if (address.family !== 'IPv4' || address.internal) continue
      if (isTranslatorAddress(address.address)) continue
      // Tailscale hands out addresses in 100.64.0.0/10 — worth calling out,
      // since that is the one that works from your phone anywhere.
      const tailscale = /^100\.(6[4-9]|[7-9]\d|1[0-1]\d|12[0-7])\./.test(address.address)
      addresses.push({ url: `http://${address.address}:${port}`, tailscale })
    }
  }
  return addresses
}

/**
 * An IPv4 address that exists only so this computer can speak IPv4 on a
 * network that has none.
 *
 * On an IPv6-only Wi-Fi, macOS gives itself 192.0.0.2 (RFC 7335's 192.0.0.0/29)
 * and translates through it. Nothing else on the network can reach it — the
 * phone beside the laptop has the very same address for itself — so publishing
 * it as "the Wi-Fi address" sends every device to a door that is not there,
 * and leaves the tunnel as the only way in from the same room.
 */
export function isTranslatorAddress(ip: string): boolean {
  return /^192\.0\.0\.[0-7]$/.test(ip)
}

/** As many as a snapshot will carry (`CloudServerSchema`). */
const PUBLISHED_LIMIT = 16

/**
 * Every address to publish into the bucket: the ones found on this computer,
 * and the one in front of it.
 *
 * `listenAddresses` can only report what this machine can see, and everything
 * it sees is a local `http://` address. Two things that leaves out, and
 * `SELFMP3_PUBLIC_URL` is both of their answers: a device somewhere else on the
 * internet, which has no local address to try, and the published web app, which
 * is served over HTTPS and so is not allowed to call an `http://` address at
 * all — not even one on the same Wi-Fi.
 *
 * The public address goes last, and the local ones stay: a device is racing all
 * of these at once (`packages/client/src/connection/reach.ts`), so at home the
 * Wi-Fi address still answers first and the tunnel is only paid for when
 * nothing else replies.
 */
export function publishedAddresses(
  host: string,
  port: number,
  publicUrl: string | null,
): ListenAddress[] {
  return withPublicAddress(listenAddresses(host, port), publicUrl)
}

/** The list above, with the public address added — separate so it can be tested. */
export function withPublicAddress(
  found: readonly ListenAddress[],
  publicUrl: string | null,
): ListenAddress[] {
  const addresses = [...found]
  if (publicUrl && !addresses.some(address => address.url === publicUrl)) {
    // A snapshot carries at most sixteen (`CloudServerSchema`), and a host with
    // a great many interfaces — a Docker box with a `veth` per container — can
    // find that many on its own. The public address is the one that cannot be
    // rediscovered by looking, so it is the one that stays.
    while (addresses.length >= PUBLISHED_LIMIT) addresses.pop()
    addresses.push({ url: publicUrl, tailscale: false })
  }
  return addresses.slice(0, PUBLISHED_LIMIT)
}

/**
 * Of those, the ones that are not this computer talking to itself.
 *
 * What is on this list is what somebody else can reach: another laptop on the
 * café Wi-Fi as much as your phone at home. The server publishes these into the
 * bucket so a signed-in device can find it (`CloudServerSchema`), and publishes
 * its token beside them — which is what makes the difference between the two:
 * your phone is handed the key with the sync, the café is not. The boot log
 * names these addresses and says so.
 */
export function beyondThisComputer(addresses: readonly { url: string }[]): string[] {
  return addresses
    .map(address => address.url)
    .filter(url => !/^https?:\/\/(localhost|127\.\d+\.\d+\.\d+|\[::1\])(:|\/|$)/.test(url))
}
