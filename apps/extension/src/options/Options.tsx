import { DEFAULT_LOCAL_SERVER_URL } from '@selfmp3/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { ask, BridgeError, type Status } from '../bridge.js'
import { Logo, TagChip } from '../ui/parts.js'
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

  // The tags every import gets, to show under "When you import". They are the
  // server's setting, so they are shown here and changed in the app.
  const choices = useQuery({
    queryKey: ['choices'],
    queryFn: () => ask({ type: 'choices' }),
    enabled: mode === 'server' || mode === 'bucket',
    retry: false,
  })
  const defaults = (choices.data?.tags ?? []).filter(tag =>
    choices.data?.defaultTagIds.includes(tag.id),
  )

  return (
    <main className="options">
      <div className="options-intro">
        <Logo>self.mp3 for your browser</Logo>
        <h1>
          Save what you are already looking at<i>.</i>
        </h1>
        <p className="lede">
          It imports the song, playlist, album or artist on the page into your own library. It never
          plays anything, never reads your history, and only talks to your server or your bucket.
        </p>

        <section className="card account" aria-live="polite">
          {account ? (
            <>
              <span className="avatar" aria-hidden="true">
                {account.slice(0, 1).toUpperCase()}
              </span>
              <span className="account-text">
                <span className="account-name">Connected as {account}</span>
                <span className="account-sub">
                  {accountLine(mode, server?.baseUrl ?? null, songCount)}
                </span>
              </span>
              <button
                type="button"
                className="tonal"
                disabled={signOut.isPending}
                onClick={() => signOut.mutate()}
              >
                {signOut.isPending ? 'Signing out…' : 'Sign out'}
              </button>
            </>
          ) : (
            <div className="account-in">
              <p>
                Sign in with the same Google account as your phone and the app. Nothing is typed:
                your server is found by the addresses it writes into every sync, and links wait in
                your bucket while it is off.
              </p>
              {signIn.error && (
                <p className="error" role="alert">
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
            </div>
          )}
        </section>
      </div>

      <div className="options-side">
        {defaults.length > 0 && (
          <section className="group">
            <h2 className="label">When you import</h2>
            <div className="card setting">
              <span>Always tag with</span>
              <span className="chips">
                {defaults.map(tag => (
                  <TagChip key={tag.id} tag={tag} state="fixed" />
                ))}
              </span>
            </div>
            <p className="hint">
              Your server adds these; change them in the app, Settings → Importing.
            </p>
          </section>
        )}

        {server?.typed && (
          <section className="group">
            <h2 className="label">This server</h2>
            <div className="card setting">
              <span>
                {account ? 'Also pointed at ' : 'Pointed at '}
                <b>{server.baseUrl}</b>
                {!account && songCount !== null ? ` · ${songCount} songs` : ''}
                {mode === 'away' && <span className="quiet"> · it isn’t answering right now.</span>}
              </span>
              <button
                type="button"
                className="tonal"
                disabled={disconnect.isPending}
                onClick={() => disconnect.mutate()}
              >
                Forget this address
              </button>
            </div>
          </section>
        )}

        <form
          className="group"
          onSubmit={event => {
            event.preventDefault()
            connect.mutate()
          }}
        >
          <h2 className="label">Another way to connect</h2>
          <div className="address">
            <input
              id="address"
              aria-label="Address"
              value={address}
              placeholder="https://your-server.ts.net"
              autoComplete="url"
              onChange={event => setAddress(event.target.value)}
            />
            <button type="submit" className="tonal" disabled={connect.isPending || !address.trim()}>
              {connect.isPending ? 'Connecting…' : 'Use this address'}
            </button>
          </div>
          <p className="hint">
            For a library with no bucket, or a server this computer can reach that your library has
            not been told about; it is tried before the ones from your sync. On this computer,{' '}
            <code>{DEFAULT_LOCAL_SERVER_URL}</code>. Over Tailscale, your server’s{' '}
            <code>https://…ts.net</code> address.
          </p>
          {wantsToken && (
            <>
              <label className="field">
                <span className="label">Token</span>
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
            <p className="error" role="alert">
              {connect.error.message}
            </p>
          )}
        </form>
      </div>
    </main>
  )
}

/** The line under the account: which way in is live, and how big the library is. */
function accountLine(
  mode: Status['mode'],
  baseUrl: string | null,
  songCount: number | null,
): string {
  const songs = songCount !== null ? ` · ${songCount} songs` : ''
  if (mode === 'server') return `Your server answers at ${baseUrl ?? 'its own address'}${songs}`
  if (mode === 'bucket') return `Your server isn’t answering, so links wait in your bucket${songs}`
  return 'Looking for your server.'
}
