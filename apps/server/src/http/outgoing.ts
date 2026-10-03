import { Agent, setGlobalDispatcher } from 'undici'

/**
 * Every request this server makes — the doorman, lyrics, covers, lookups —
 * over HTTP/1.1, whichever Node runs it.
 *
 * Node 26's fetch speaks HTTP/2 wherever the other end offers it, and
 * Cloudflare, in front of the doorman, does. All of a host's requests then ride
 * one connection, and when that connection broke the wrong way fetch went on
 * handing every later request to the dead session ("The session has been
 * destroyed") until the server was restarted: the cloud pass said it could not
 * reach a doorman that answered everyone else. On HTTP/1.1, which Node 22's
 * fetch speaks, a broken connection is dropped and the next request opens a
 * new one. Nothing here gains from HTTP/2: the requests are few and one at a
 * time.
 *
 * undici's own `setGlobalDispatcher` is the dispatcher Node's built-in fetch
 * reads too, from Node 22 on.
 */
export function speakHttp1(): void {
  setGlobalDispatcher(new Agent({ allowH2: false }))
}
