import {
  DEFAULT_APP_URL,
  DEFAULT_LOCAL_SERVER_URL,
  plural,
  signInCodeFromUrl,
} from '@selfmp3/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { ask, BridgeError, type Status } from '../bridge.js'
import { hostOf } from '../popup/popup.model.js'
import { ErrorLine, Logo } from '../ui/parts.js'
import { NOTE_PATH } from '../ui/mark.js'
import { signInFailure } from './signIn.js'

/**
 * Where the extension imports to: the same Google account as every other
 * device, or one server's address typed in.
 *
 * One column (A1, the Oct 31 canvas): what it is, then one card that says
 * who it is signed in as and where an import goes from here (B1), then the
 * three ways to save (C1), and the address folded into a row at the foot
 * (D1).
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
  const [byAddress, setByAddress] = useState(false)

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
      setAddress('')
      setToken('')
      setWantsToken(false)
      setByAddress(false)
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
  /** Signed out, and nothing typed in that answers: signing in is the one thing to do. */
  const needsSignIn = !account && mode !== 'server'

  const signInButton = (
    <button
      type="button"
      className="primary google"
      autoFocus
      disabled={signIn.isPending}
      onClick={() => signIn.mutate()}
    >
      <GoogleMark />
      {signIn.isPending ? 'Waiting for Google…' : 'Sign in with Google'}
    </button>
  )
  const signInError = <ErrorLine message={signIn.error && signInFailure(signIn.error)} />

  return (
    <main className="options">
      <header className="options-head">
        <span className="brand">
          <Logo size={20} />
          <span className="brand-tag">for your browser</span>
        </span>
        <a className="open-app" href={DEFAULT_APP_URL} target="_blank" rel="noreferrer">
          Open self.mp3
          <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
            <path d="M7 17 17 7M8 7h9v9" />
          </svg>
        </a>
      </header>

      <section className="hero">
        <h1>
          Save what you are already looking at<i>.</i>
        </h1>
        <p className="lede">
          Songs, playlists, albums and artists, from the page you are on. It never plays anything or
          reads your history.
        </p>
      </section>

      {status.isPending ? (
        <section className="card connection" aria-busy="true">
          <p className="quiet">Checking…</p>
        </section>
      ) : needsSignIn ? (
        <section className="card connection sign-in" aria-live="polite">
          <div className="sign-in-row">
            <span className="sign-in-text">
              <b>{mode === 'away' ? 'Sign in to find your server' : 'One step: sign in'}</b>
              <span>Use the same account as your phone. There is nothing to type.</span>
            </span>
            {signInButton}
          </div>
          {signInError}
          {mode === 'away' && server && (
            <div className="dead-address">
              <span className="dot warning" aria-hidden="true" />
              <span className="dead-address-text">
                <b>{hostOf(server.baseUrl)}</b>, the address below, didn’t answer
              </span>
              <button
                type="button"
                className="tonal small"
                disabled={disconnect.isPending}
                onClick={() => disconnect.mutate()}
              >
                Forget it
              </button>
            </div>
          )}
        </section>
      ) : (
        <section className="card connection" aria-live="polite">
          {account ? (
            <div className="who">
              <span className="avatar" aria-hidden="true">
                {account.slice(0, 1).toUpperCase()}
              </span>
              <span className="who-text">
                <b>{account}</b>
                <span>Signed in with Google</span>
              </span>
              <button
                type="button"
                className="tonal"
                disabled={signOut.isPending}
                onClick={() => signOut.mutate()}
              >
                {signOut.isPending ? 'Signing out…' : 'Sign out'}
              </button>
            </div>
          ) : (
            <div className="who">
              <span className="who-text">
                <b>Not signed in</b>
                <span>Signed in, links wait in your bucket while this server sleeps.</span>
              </span>
              {signInButton}
            </div>
          )}
          {!account && signInError}
          <Route
            mode={mode}
            baseUrl={server?.baseUrl ?? null}
            songCount={songCount}
            noServer={noServer}
          />
        </section>
      )}

      <section className="ways" aria-labelledby="ways-title">
        <h2 id="ways-title" className="label">
          {needsSignIn ? 'Then, three ways to save' : 'Three ways to save'}
        </h2>
        <div className={needsSignIn ? 'ways-grid later' : 'ways-grid'}>
          <Way title="The button on YouTube" text="Beside Like on any video, YouTube Music too.">
            <span className="art-pill">Like</span>
            <span className="art-pill art-lit">
              <NoteMark size={11} />
              self.mp3
            </span>
          </Way>
          <Way title="Right-click a link" text="Anywhere: a chat, a search, a blog post.">
            <span className="art-menu">
              <span>Open link in new tab</span>
              <span>Copy link address</span>
              <span className="art-lit">Import link to self.mp3</span>
            </span>
          </Way>
          <Way
            title="The toolbar button"
            text="Pin it for tags, a whole playlist, or a pasted link."
          >
            <span className="art-toolbar">
              <span className="art-icon art-lit">
                <NoteMark size={13} />
              </span>
              <span className="art-popup">
                <span className="art-cover" />
                <span className="art-lines">
                  <span />
                  <span />
                </span>
              </span>
            </span>
          </Way>
        </div>
      </section>

      {/* For the web app's downloads in this browser (docs/features/client-download.md). */}
      <section className="card youtube-sign-in">
        <label className="typed">
          <span className="typed-text">
            <b>Use my YouTube sign-in</b>
            <span>
              When the web app downloads a song in this browser, YouTube counts it against your
              account instead of your network, which lets many more through. Only the request that
              asks for a song goes signed in, never one that could like, subscribe or comment — but
              YouTube may flag an account that downloads a lot.
            </span>
          </span>
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
      </section>

      <section className="card by-address">
        {server?.typed && (
          <div className="typed">
            <LinkMark />
            <span className="typed-text">
              <b>
                {account ? 'Tried first: ' : 'Pointed at '}
                {server.baseUrl}
                {!account && songCount !== null ? ` · ${plural(songCount, 'song', 'songs')}` : ''}
              </b>
              <span>{mode === 'away' ? 'Not answering right now' : 'Answering'}</span>
            </span>
            <button
              type="button"
              className="tonal small"
              disabled={disconnect.isPending}
              onClick={() => disconnect.mutate()}
            >
              Forget
            </button>
          </div>
        )}
        <button
          type="button"
          className="fold"
          aria-expanded={byAddress || wantsToken}
          aria-controls="address-form"
          onClick={() => setByAddress(open => !open)}
        >
          {!server?.typed && <LinkMark />}
          <span className="fold-text">
            <b>{server?.typed ? 'Use another address' : 'Connect by address instead'}</b>
            {!server?.typed && (
              <span>Rarely needed. For a copy of self.mp3 your account can’t find.</span>
            )}
          </span>
          <svg className="chevron" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path d="m9 6 6 6-6 6" />
          </svg>
        </button>
        {(byAddress || wantsToken) && (
          <form
            id="address-form"
            className="address-form"
            onSubmit={event => {
              event.preventDefault()
              connect.mutate()
            }}
          >
            <label className="field">
              <span className="label">Address</span>
              <input
                id="address"
                value={address}
                placeholder="https://your-server.ts.net"
                autoComplete="url"
                autoFocus
                onChange={event => setAddress(event.target.value)}
              />
            </label>
            <div className="try">
              <span>Try</span>
              <button
                type="button"
                className="try-chip"
                onClick={() => setAddress(DEFAULT_LOCAL_SERVER_URL)}
              >
                {hostOf(DEFAULT_LOCAL_SERVER_URL)}
              </button>
              <span>
                or your server’s https://…ts.net address. It is tried before the ones from your
                sync.
              </span>
            </div>
            {wantsToken && (
              <div className="token">
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
                  Its log prints it when it holds one library; otherwise it is in its{' '}
                  <code>data/hub.json</code>. Kept in the extension’s own storage.
                </p>
              </div>
            )}
            <ErrorLine message={connect.error?.message ?? null} />
            <div className="form-actions">
              <button
                type="button"
                className="tonal quiet-button"
                onClick={() => {
                  setByAddress(false)
                  setWantsToken(false)
                  connect.reset()
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="primary"
                disabled={connect.isPending || !address.trim()}
              >
                {connect.isPending ? 'Connecting…' : 'Use this address'}
              </button>
            </div>
          </form>
        )}
      </section>

      <footer className="options-foot">
        <span>Version {chrome.runtime.getManifest().version}</span>
        <span>Everything it keeps stays in its own storage, which no web page can read.</span>
      </footer>
    </main>
  )
}

/**
 * Where an import goes from here (B1): this browser, then the server or the
 * bucket, then the library, with the line in the state's colour.
 */
function Route({
  mode,
  baseUrl,
  songCount,
  noServer,
}: {
  mode: Status['mode']
  baseUrl: string | null
  songCount: number | null
  noServer: boolean
}): ReactNode {
  const songs = songCount !== null ? plural(songCount, 'song', 'songs') : 'Your songs'

  // Joining is the app's to do (connection.ts), so this says where to do it.
  if (mode === 'bucket' && noServer) {
    return (
      <div className="notice warning">
        <span className="notice-text">
          <b>No computer works for your library yet</b>
          <span>Open self.mp3 to connect one. Links wait in your bucket until then.</span>
        </span>
        <a className="primary" href={DEFAULT_APP_URL} target="_blank" rel="noreferrer">
          Open self.mp3
        </a>
      </div>
    )
  }

  const viaBucket = mode === 'bucket'
  return (
    <>
      <ol className={viaBucket ? 'route bucket' : 'route ready'}>
        <li>
          <span className="stop-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="17" height="17">
              <rect x="3" y="4" width="18" height="14" rx="2" />
              <path d="M3 8h18" />
            </svg>
          </span>
          <span className="stop-text">
            <b>This browser</b>
            <span>Where you press save</span>
          </span>
        </li>
        <li className="line" aria-hidden="true" />
        {viaBucket ? (
          <li className="lit">
            <span className="stop-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="17" height="17">
                <path d="M4 7h16l-1.5 12a2 2 0 0 1-2 1.8h-9a2 2 0 0 1-2-1.8z" />
                <path d="M8 7a4 4 0 0 1 8 0" />
              </svg>
            </span>
            <span className="stop-text">
              <b>Your bucket</b>
              <span>Links wait here</span>
            </span>
          </li>
        ) : (
          <li className="lit">
            <span className="stop-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="17" height="17">
                <rect x="3" y="4" width="18" height="7" rx="2" />
                <rect x="3" y="13" width="18" height="7" rx="2" />
                <path d="M7 7.5h.01M7 16.5h.01" />
              </svg>
            </span>
            <span className="stop-text">
              <b>Your server</b>
              <span>{baseUrl ? hostOf(baseUrl) : 'Answering'}</span>
            </span>
          </li>
        )}
        <li className={viaBucket ? 'line asleep' : 'line'} aria-hidden="true" />
        <li className={viaBucket ? 'asleep' : undefined}>
          <span className="stop-icon" aria-hidden="true">
            {viaBucket ? (
              <svg viewBox="0 0 24 24" width="17" height="17">
                <rect x="3" y="4" width="18" height="7" rx="2" />
                <rect x="3" y="13" width="18" height="7" rx="2" />
              </svg>
            ) : (
              <NoteMark size={15} />
            )}
          </span>
          <span className="stop-text">
            <b>{viaBucket ? 'Your server' : 'Your library'}</b>
            <span>{viaBucket ? 'Asleep' : songs}</span>
          </span>
        </li>
      </ol>
      <p className={viaBucket ? 'route-says bucket' : 'route-says ready'}>
        <span className="dot" aria-hidden="true" />
        {viaBucket
          ? 'Your server isn’t answering, so links wait in your bucket. It takes them when it wakes.'
          : 'Imports go straight to your server and reach your library in a minute or two.'}
      </p>
    </>
  )
}

/** One of the three ways to save (C1): a small drawing of it, and two lines. */
function Way({
  title,
  text,
  children,
}: {
  title: string
  text: string
  children: ReactNode
}): ReactNode {
  return (
    <div className="way">
      <div className="way-art" aria-hidden="true">
        {children}
      </div>
      <div className="way-text">
        <b>{title}</b>
        <span>{text}</span>
      </div>
    </div>
  )
}

function NoteMark({ size }: { size: number }): ReactNode {
  return (
    <svg className="note" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path d={NOTE_PATH} />
    </svg>
  )
}

function LinkMark(): ReactNode {
  return (
    <span className="link-mark" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="16" height="16">
        <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
        <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
      </svg>
    </span>
  )
}

/** Google's G, in its own colours, as its sign-in buttons carry it. */
function GoogleMark(): ReactNode {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.6 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6a5 5 0 0 1-2.2 3.3v2.7h3.5c2.1-1.9 3.3-4.8 3.3-8.1z"
      />
      <path
        fill="#34A853"
        d="M12 23c3 0 5.5-1 7.3-2.7l-3.5-2.7c-1 .7-2.3 1.1-3.8 1.1-2.9 0-5.4-2-6.3-4.7H2.1v2.8A11 11 0 0 0 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.7 14c-.2-.7-.4-1.3-.4-2s.1-1.4.4-2V7.2H2.1a11 11 0 0 0 0 9.7L5.7 14z"
      />
      <path
        fill="#EA4335"
        d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.1-3.1A11 11 0 0 0 2.1 7.2L5.7 10c.9-2.7 3.4-4.6 6.3-4.6z"
      />
    </svg>
  )
}
