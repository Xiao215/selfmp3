import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { ask, BridgeError, type Status } from '../bridge.js'
import { codeFromRedirect, signInFailure } from './signIn.js'

/**
 * Where the extension imports to: the same Google account as every other
 * device, or one server's address typed in.
 *
 * Signing in is the way in that keeps working: the server is asked directly
 * whenever it answers, and when it does not the link waits in the bucket for it
 * (I3, docs/features/browser-extension.md). An address is still offered under it, for a library
 * with a server and no bucket at all, and for a server this computer can reach
 * that the bucket has never been told about.
 *
 * Nearly nobody sets `SELFMP3_AUTH_TOKEN` — it is off by default and most
 * servers are reached over localhost or a tailnet — so asking everyone for one
 * up front is a field almost every person has to work out they can ignore. The
 * worker already tells "needs a token" apart from "wrong token" (`connect` in
 * background/handlers.ts), so the address alone is tried first and the token is
 * asked for only when the server has actually refused without one.
 */
export function Options(): ReactNode {
  const queryClient = useQueryClient()
  const [address, setAddress] = useState('')
  const [token, setToken] = useState('')
  /** The server answered 401, so it wants a token and the field is worth showing. */
  const [wantsToken, setWantsToken] = useState(false)

  const status = useQuery({
    queryKey: ['status'],
    queryFn: () => ask({ type: 'status' }),
    retry: false,
  })
  const remember = (next: Status): void => {
    queryClient.setQueryData(['status'], next)
  }

  /*
   * Three steps, all here: the worker writes the attempt down and hands back
   * where to go, Chrome runs the window, and the code that comes back in the
   * address is spent by the worker, which is the one that holds the session.
   */
  const signIn = useMutation({
    mutationFn: async (): Promise<Status> => {
      const { url } = await ask({ type: 'signIn' })
      const back = await chrome.identity.launchWebAuthFlow({ url, interactive: true })
      const code = back ? codeFromRedirect(back) : null
      if (!code) throw new Error('Google came back without a sign-in code.')
      return ask({ type: 'claimSignIn', code })
    },
    onSuccess: remember,
  })

  const signOut = useMutation({
    mutationFn: () => ask({ type: 'signOut' }),
    onSuccess: remember,
  })

  const connect = useMutation({
    mutationFn: () => ask({ type: 'connect', baseUrl: address, token: token || null }),
    onSuccess: next => {
      remember(next)
      setToken('')
      setWantsToken(false)
    },
    onError: error => {
      if (error instanceof BridgeError && error.status === 401) setWantsToken(true)
    },
  })
  const disconnect = useMutation({
    mutationFn: () => ask({ type: 'disconnect' }),
    onSuccess: remember,
  })

  const server = status.data?.server ?? null
  const account = status.data?.account ?? null
  const songCount = status.data?.songCount ?? null
  const mode = status.data?.mode ?? 'none'

  return (
    <main className="options">
      <h1>
        <span className="logo">
          self<i>.</i>mp3
        </span>{' '}
        extension
      </h1>
      <p className="lede">
        Importing goes through your self.mp3 server — it is the one that runs yt-dlp. Sign in and
        the extension finds it by itself, and leaves links in your bucket for it when it is off.
      </p>

      <section className="card" aria-live="polite">
        <h2>Your library</h2>
        {account ? (
          <>
            <p>
              Signed in as <b>{account}</b>
              {songCount !== null ? ` · ${songCount} songs` : ''}
            </p>
            <p className="hint">
              {mode === 'server'
                ? `Your server is answering at ${server?.baseUrl ?? 'its own address'}, so links are imported straight away.`
                : mode === 'bucket'
                  ? 'Your server isn’t answering, so links wait in your bucket until it is awake.'
                  : 'Looking for your server.'}
            </p>
            <button
              type="button"
              className="secondary"
              disabled={signOut.isPending}
              onClick={() => signOut.mutate()}
            >
              {signOut.isPending ? 'Signing out…' : 'Sign out'}
            </button>
          </>
        ) : (
          <>
            <p className="hint">
              The same Google account as your phone and the app. Nothing is typed, and your server
              is found by the addresses it writes into every sync.
            </p>
            {signIn.error && (
              <p className="banner bad" role="alert">
                {signInFailure(signIn.error)}
              </p>
            )}
            <button
              type="button"
              className="primary"
              disabled={signIn.isPending}
              onClick={() => signIn.mutate()}
            >
              {signIn.isPending ? 'Waiting for Google…' : 'Sign in with Google'}
            </button>
          </>
        )}
      </section>

      {server?.typed && (
        <section className="card">
          <p>
            {account ? 'Also pointed at ' : 'Pointed at '}
            <b>{server.baseUrl}</b>
            {!account && songCount !== null ? ` · ${songCount} songs` : ''}
            {mode === 'away' && <span className="hint"> · it isn’t answering right now.</span>}
          </p>
          <button
            type="button"
            className="secondary"
            disabled={disconnect.isPending}
            onClick={() => disconnect.mutate()}
          >
            Forget this address
          </button>
        </section>
      )}

      <form
        className="card"
        onSubmit={event => {
          event.preventDefault()
          connect.mutate()
        }}
      >
        <h2>Or point it at one server</h2>
        <p className="hint">
          For a library with no bucket, or a server this computer can reach that your library has
          not been told about. An address here is tried before the ones from your sync.
        </p>
        <label className="field">
          <span>Address</span>
          <input
            id="address"
            value={address}
            placeholder="http://localhost:4600"
            autoComplete="url"
            onChange={event => setAddress(event.target.value)}
          />
        </label>
        <p className="hint">
          On this computer, <code>http://localhost:4600</code>. Over Tailscale, your server’s{' '}
          <code>https://…ts.net</code> address.
        </p>
        {wantsToken && (
          <>
            <label className="field">
              <span>Token</span>
              <input
                id="token"
                type="password"
                value={token}
                autoComplete="off"
                autoFocus
                onChange={event => setToken(event.target.value)}
              />
            </label>
            <p className="hint">
              This server was started with <code>SELFMP3_AUTH_TOKEN</code> set. It is the same
              value; the extension keeps it in its own storage, which no web page can read.
            </p>
          </>
        )}
        {connect.error && (
          <p className="banner bad" role="alert">
            {connect.error.message}
          </p>
        )}
        <button type="submit" className="primary" disabled={connect.isPending || !address.trim()}>
          {connect.isPending ? 'Connecting…' : 'Connect'}
        </button>
      </form>
    </main>
  )
}
