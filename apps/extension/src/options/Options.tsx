import { DEFAULT_LOCAL_SERVER_URL, plural, signInCodeFromUrl } from '@selfmp3/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { ask, BridgeError, type Status } from '../bridge.js'
import { Logo } from '../ui/parts.js'
import { signInFailure } from './signIn.js'

/**
 * Where the extension imports to: the same Google account as every other
 * device, or one server's address typed in.
 *
 * Signing in is the way in that keeps working: the server is asked directly
 * whenever it answers, and when it does not the link waits in the bucket for it
 * (I3, docs/features/browser-extension.md). An address is still offered, folded
 * away under "Connect by address instead", for a server this computer can reach
 * that the bucket has never been told about — a development server on
 * localhost, say. Every server needs a bucket, so the library behind a typed
 * address lives in one all the same. The page as it opens says none of that:
 * no bucket, server, sync or address until the fold is opened.
 *
 * Each library has its own token on its server (docs/features/shared-server.md),
 * but a server holding one library does not ask its own machine for it, so on
 * localhost the field is one a person would have to work out they can ignore.
 * The worker already tells "needs a token" apart from "wrong token" (`connect`
 * in background/handlers.ts), so the address alone is tried first and the token
 * is asked for only when the server has actually refused without one.
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

  // The extension's own options (background/options.ts): kept by the worker, not by any page.
  const options = useQuery({ queryKey: ['options'], queryFn: () => ask({ type: 'options' }) })
  const setSignIn = useMutation({
    mutationFn: (useYouTubeSignIn: boolean) => ask({ type: 'setOptions', useYouTubeSignIn }),
    onSuccess: next => queryClient.setQueryData(['options'], next),
  })

  /*
   * Three steps, all here: the worker writes the attempt down and hands back
   * where to go, Chrome runs the window, and the code that comes back in the
   * address is spent by the worker, which is the one that holds the session.
   */
  const signIn = useMutation({
    mutationFn: async (): Promise<Status> => {
      const { url } = await ask({ type: 'signIn' })
      const back = await chrome.identity.launchWebAuthFlow({ url, interactive: true })
      const code = back ? signInCodeFromUrl(back) : null
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
  const noServer = status.data?.noServer ?? false

  return (
    <main className="options">
      <div className="options-intro">
        <Logo>self.mp3 for your browser</Logo>
        <h1>
          Save what you are already looking at<i>.</i>
        </h1>
        <p className="lede">
          Adds the song, playlist, album or artist on the page to your library. It never plays
          anything or reads your history.
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
                  {accountLine(mode, server?.baseUrl ?? null, songCount, noServer)}
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
              {signIn.error && (
                <p className="error" role="alert">
                  {signInFailure(signIn.error)}
                </p>
              )}
              {/* The popup's Sign in brings you here, so the button has the focus. */}
              <button
                type="button"
                className="primary"
                autoFocus
                disabled={signIn.isPending}
                onClick={() => signIn.mutate()}
              >
                {signIn.isPending ? 'Waiting for Google…' : 'Sign in with Google'}
              </button>
              <p className="account-hint">Use the same account as your phone.</p>
            </div>
          )}
        </section>
      </div>

      <div className="options-side">
        <section className="group">
          <h2 className="label">Downloading in the web app</h2>
          <label className="card setting">
            <span>Use my YouTube sign-in</span>
            <input
              type="checkbox"
              checked={options.data?.useYouTubeSignIn ?? false}
              disabled={!options.data || setSignIn.isPending}
              onChange={event => {
                const on = event.target.checked
                // Taken only now, on the person's own click; `cookies` carries no warning, so Chrome shows no prompt.
                const permission = on
                  ? chrome.permissions.request({ permissions: ['cookies'] })
                  : chrome.permissions.remove({ permissions: ['cookies'] }).then(() => true)
                void permission
                  .catch(() => !on)
                  .then(granted => {
                    if (granted) setSignIn.mutate(on)
                  })
              }}
            />
          </label>
          <p className="hint">
            When the web app downloads a song in this browser, YouTube counts it against your
            account instead of your network, which lets many more through. Only the request that
            asks for a song goes signed in, never one that could like, subscribe or comment — but
            YouTube may flag an account that downloads a lot.
          </p>
        </section>

        {server?.typed && (
          <section className="group">
            <h2 className="label">This server</h2>
            <div className="card setting">
              <span>
                {account ? 'Also pointed at ' : 'Pointed at '}
                <b>{server.baseUrl}</b>
                {!account && songCount !== null ? ` · ${plural(songCount, 'song', 'songs')}` : ''}
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

        {/* Folded away: an address is for a server sign-in cannot find. */}
        <details className="group by-address" open={server?.typed || wantsToken || undefined}>
          <summary>Connect by address instead</summary>
          <form
            className="group"
            onSubmit={event => {
              event.preventDefault()
              connect.mutate()
            }}
          >
            <div className="address">
              <input
                id="address"
                aria-label="Address"
                value={address}
                placeholder="https://your-server.ts.net"
                autoComplete="url"
                onChange={event => setAddress(event.target.value)}
              />
              <button
                type="submit"
                className="tonal"
                disabled={connect.isPending || !address.trim()}
              >
                {connect.isPending ? 'Connecting…' : 'Use this address'}
              </button>
            </div>
            <p className="hint">
              For a server this computer can reach that your library has not been told about; it is
              tried before the ones from your sync. On this computer,{' '}
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
                  Your library’s token on that server: its log prints it when it holds one library,
                  and otherwise it is in its <code>data/hub.json</code>. The extension keeps it in
                  its own storage, which no web page can read.
                </p>
              </>
            )}
            {connect.error && (
              <p className="error" role="alert">
                {connect.error.message}
              </p>
            )}
          </form>
        </details>
      </div>
    </main>
  )
}

/** The line under the account: which way in is live, and how big the library is. */
function accountLine(
  mode: Status['mode'],
  baseUrl: string | null,
  songCount: number | null,
  noServer: boolean,
): string {
  const songs = songCount !== null ? ` · ${plural(songCount, 'song', 'songs')}` : ''
  if (mode === 'server') return `Your server answers at ${baseUrl ?? 'its own address'}${songs}`
  // Joining is the app's to do (connection.ts), so this says where to do it.
  if (mode === 'bucket' && noServer) {
    return `No computer works for your library yet. Open self.mp3 to connect one; links wait in your bucket until then${songs}`
  }
  if (mode === 'bucket') return `Your server isn’t answering, so links wait in your bucket${songs}`
  return 'Looking for your server.'
}
