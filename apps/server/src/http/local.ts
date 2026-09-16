import type { Request } from 'express'

/**
 * Whether a request came from the machine the server is running on.
 *
 * Two things ask this, and both turn on the same distinction. "Show in Finder"
 * (`services/reveal.ts`) only makes sense for a browser on that same machine: a
 * phone asking would open a Finder window on the server across the room. And
 * the bearer check (`middleware.ts`) exempts it, because somebody at the
 * keyboard can read `selfmp3.db` and the library folder anyway — asking them
 * for a key they could pick up buys nothing and would make the server's own
 * page demand a token for no reason.
 *
 * Requests must arrive over loopback *and* ask for a loopback host. The second
 * check matters because `tailscale serve` also connects from loopback — but a
 * request through it asks for the tailnet name, not `localhost`. Checking the
 * socket alone would hand every Tailscale request a free pass, which for the
 * bearer check is a straight authentication bypass: Tailscale is exactly the
 * remote case the token protects.
 *
 * **`req.ip` is the wrong thing to ask**, and is why this reads the socket
 * directly. The app sets `trust proxy` for `tailscale serve`, so express takes
 * `req.ip` from `X-Forwarded-For` — a header anyone who can open a socket can
 * write. A laptop across the café could claim to be 127.0.0.1 and be waved
 * through. The socket's peer address is the one thing about a request the
 * sender did not choose: a TCP handshake has to complete before a byte of HTTP
 * arrives, so a forged source address never gets a request here at all.
 *
 * A forwarding header disqualifies outright, on top of both. Anything that adds
 * one stood between the sender and here, so the sender was not here — and it
 * fails the safe way round: an attacker adding one can only narrow their own
 * access, and cannot remove the one a real proxy put there.
 */

const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

export function isLocalRequest(req: Pick<Request, 'socket' | 'headers'>): boolean {
  if (req.headers['x-forwarded-for'] !== undefined) return false
  if (req.headers['forwarded'] !== undefined) return false

  const remote = req.socket.remoteAddress ?? ''
  const host = (req.headers.host ?? '')
    .replace(/:\d+$/, '')
    .replace(/^\[(.*)\]$/, '$1')
    .toLowerCase()
  return LOOPBACK_ADDRESSES.has(remote) && LOOPBACK_HOSTS.has(host)
}
