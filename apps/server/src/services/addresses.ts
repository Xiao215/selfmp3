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
      // Tailscale hands out addresses in 100.64.0.0/10 — worth calling out,
      // since that is the one that works from your phone anywhere.
      const tailscale = /^100\.(6[4-9]|[7-9]\d|1[0-1]\d|12[0-7])\./.test(address.address)
      addresses.push({ url: `http://${address.address}:${port}`, tailscale })
    }
  }
  return addresses
}

/**
 * Of those, the ones that are not this computer talking to itself.
 *
 * What is on this list is what somebody else can reach: another laptop on the
 * café Wi-Fi as much as your phone at home. The server publishes these into the
 * bucket so a signed-in device can find it (`CloudServerSchema`), and publishes
 * its token beside them — so with no token set, the addresses are an open door
 * and the boot log says so.
 */
export function beyondThisComputer(addresses: readonly { url: string }[]): string[] {
  return addresses
    .map(address => address.url)
    .filter(url => !/^https?:\/\/(localhost|127\.\d+\.\d+\.\d+|\[::1\])(:|\/|$)/.test(url))
}
