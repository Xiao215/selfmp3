import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { SignInCodeSchema, formatSignInCode, type CloudConnect } from '@selfmp3/shared'
import { BrandMark, X } from '../components/Icons.js'
import { DOORMAN_URL } from '../lib/platform.js'
import { queryKeys } from '../lib/queries.js'
import {
  beginSignIn,
  claimSignIn,
  clearPendingSignIn,
  connectStorage,
  DoormanError,
  loadSession,
  pendingSignIn,
  refreshSession,
  signOut as endSession,
  type CloudSession,
} from '../lib/cloud/session.js'
import {
  flushCloudChanges,
  forgetCloudLibrary,
  markCloudLibraryStale,
  pendingCloudChanges,
} from '../lib/cloud/library.js'
import { clearAudioCache } from '../offline/audioCache.js'
import { clearRecent } from '../offline/recentCache.js'
import { clearSnapshot } from '../offline/mirror.js'
import { BucketFields } from './BucketFields.js'

/**
 * The web app's front door (docs/SYNC.md): built for the web, there is no Mac
 * behind it, so nothing else shows until you are signed in with Google and
 * your account has its bucket.
 *
 * Signing in leaves for Google's page and comes back. Where it comes back to
 * depends on the device: the same tab on a computer; on an iPhone home-screen
 * app, a sheet that opened over the app, with storage of its own. So the app
 * remembers the attempt before it leaves, and asks the doorman about it when
 * it loads and whenever it comes back to the front. What claims the session
 * is the code the doorman shows once Google is done — never the attempt
 * alone, so a sign-in link someone else sent you gets them nothing. Coming
 * back to the page that started it, the code is in the address and nothing
 * needs typing; the sheet shows the code to take back to the app instead.
 */

type Gate =
  | { readonly kind: 'loading' }
  | { readonly kind: 'no-doorman' }
  | { readonly kind: 'signed-out'; readonly message: string | null }
  | { readonly kind: 'waiting' }
  | { readonly kind: 'enter-code'; readonly error: string | null }
  | { readonly kind: 'returned-elsewhere'; readonly code: string | null }
  | { readonly kind: 'needs-storage'; readonly session: CloudSession }
  | { readonly kind: 'ready'; readonly session: CloudSession }

interface CloudAccount {
  readonly session: CloudSession
  /** Sign out, and forget everything this device kept for the account. */
  readonly signOut: () => Promise<void>
}

const CloudAccountContext = createContext<CloudAccount | null>(null)

/** The signed-in account, inside the gate; null anywhere else. */
export function useCloudAccount(): CloudAccount | null {
  return useContext(CloudAccountContext)
}

const POLL_MS = 2_000

const WRONG_CODE = 'That wasn’t the code shown after signing in. Sign in again.'

function gateFor(session: CloudSession): Gate {
  return session.me.storage ? { kind: 'ready', session } : { kind: 'needs-storage', session }
}

/** The code the doorman put in the address on the way back, if it did. */
function returnedCode(hash: string): string | null {
  const raw = /(?:^|[#&])signin-code=([0-9A-Za-z-]{1,32})/.exec(hash)?.[1]
  if (raw === undefined) return null
  const parsed = SignInCodeSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}

export function CloudGate({ children }: { children: ReactNode }) {
  const [gate, setGate] = useState<Gate>({ kind: 'loading' })

  /** Claim the session with the code, or say why not. */
  const claimWith = useCallback(async (code: string): Promise<void> => {
    const pending = pendingSignIn()
    if (!pending) {
      setGate({ kind: 'signed-out', message: 'The sign-in took too long. Try again.' })
      return
    }
    try {
      const outcome = await claimSignIn(pending.attempt, code)
      if (outcome.status === 'signed-in') setGate(gateFor(outcome.session))
      else
        setGate({ kind: 'enter-code', error: 'Google hasn’t finished yet. Try again in a moment.' })
    } catch (error) {
      if (error instanceof DoormanError && error.code === 'wrong_code') {
        clearPendingSignIn()
        setGate({ kind: 'signed-out', message: WRONG_CODE })
      } else {
        setGate({
          kind: 'enter-code',
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }, [])

  // Where things stand on arrival: signed in, coming back from Google, or not.
  useEffect(() => {
    if (!DOORMAN_URL) {
      setGate({ kind: 'no-doorman' })
      return
    }
    const hash = window.location.hash
    const code = returnedCode(hash)
    const cameBack = /(?:^|[#&])signin-code=/.test(hash)
    if (cameBack) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search)
    }
    let cancelled = false
    void (async () => {
      const session = await loadSession()
      if (cancelled) return
      if (session) {
        setGate(gateFor(session))
        // What the doorman says now: a bucket connected elsewhere, or a
        // session it no longer knows.
        try {
          const fresh = await refreshSession(session)
          if (!cancelled) setGate(gateFor(fresh))
        } catch (error) {
          if (!cancelled && error instanceof DoormanError && error.status === 401) {
            await endSession(session)
            setGate({ kind: 'signed-out', message: 'Your sign-in expired. Sign in again.' })
          }
        }
        return
      }
      const pending = pendingSignIn()
      if (pending && code) await claimWith(code)
      else if (pending) setGate({ kind: 'waiting' })
      else if (cameBack) setGate({ kind: 'returned-elsewhere', code })
      else setGate({ kind: 'signed-out', message: null })
    })()
    return () => {
      cancelled = true
    }
  }, [claimWith])

  // Waiting for Google: ask now, every couple of seconds, and on coming back.
  useEffect(() => {
    if (gate.kind !== 'waiting') return
    let cancelled = false
    const check = async (): Promise<void> => {
      const pending = pendingSignIn()
      if (!pending) {
        if (!cancelled) {
          setGate({ kind: 'signed-out', message: 'The sign-in took too long. Try again.' })
        }
        return
      }
      try {
        const outcome = await claimSignIn(pending.attempt)
        if (cancelled) return
        if (outcome.status === 'code') setGate({ kind: 'enter-code', error: null })
        else if (outcome.status === 'signed-in') setGate(gateFor(outcome.session))
      } catch {
        // Offline or the doorman is busy: the next check will tell.
      }
    }
    void check()
    const timer = setInterval(() => void check(), POLL_MS)
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void check()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [gate.kind])

  const signOut = useCallback(async (): Promise<void> => {
    if (gate.kind !== 'ready' && gate.kind !== 'needs-storage') return
    // One last try at sending what this device has not uploaded yet.
    await flushCloudChanges().catch(() => undefined)
    await endSession(gate.session)
    // Songs are cached under this device's ids for this account's library;
    // another account's library would give the same ids to other songs. The
    // list of which of those copies were kept for having been played goes
    // with them, or it would name ids the next account hands to other songs.
    clearRecent()
    await Promise.allSettled([clearAudioCache(), clearSnapshot(), forgetCloudLibrary()])
    window.location.reload()
  }, [gate])

  const account = useMemo<CloudAccount | null>(
    () => (gate.kind === 'ready' ? { session: gate.session, signOut } : null),
    [gate, signOut],
  )

  if (gate.kind === 'ready' && account) {
    return <CloudAccountContext.Provider value={account}>{children}</CloudAccountContext.Provider>
  }

  return (
    <div className="cloud-gate">
      <section className="panel cloud-gate-card">
        <header className="cloud-gate-head">
          <BrandMark size={34} />
          <h1>self.mp3</h1>
        </header>
        <GateBody
          gate={gate}
          onConnected={session => setGate(gateFor(session))}
          onSignOut={() => void signOut()}
          onCode={code => void claimWith(code)}
          onCancel={() => {
            clearPendingSignIn()
            setGate({ kind: 'signed-out', message: null })
          }}
        />
      </section>
    </div>
  )
}

function GateBody({
  gate,
  onConnected,
  onSignOut,
  onCode,
  onCancel,
}: {
  gate: Gate
  onConnected: (session: CloudSession) => void
  onSignOut: () => void
  onCode: (code: string) => void
  onCancel: () => void
}) {
  switch (gate.kind) {
    case 'loading':
    case 'ready':
      return <p className="panel-lead">Loading…</p>

    case 'no-doorman':
      return (
        <p className="panel-lead">
          This copy of the web app is not connected to a doorman yet, so there is no way to sign in.
          See docs/SYNC.md to set one up.
        </p>
      )

    case 'returned-elsewhere':
      return gate.code ? (
        <>
          <p className="panel-lead">
            You&rsquo;re signed in with Google. Go back to self.mp3 and enter this code:
          </p>
          <p className="cloud-gate-code">{formatSignInCode(gate.code)}</p>
        </>
      ) : (
        <p className="panel-lead">
          You&rsquo;re signed in with Google. Go back to self.mp3 and enter the code it asks for.
        </p>
      )

    case 'waiting':
      return (
        <>
          <p className="panel-lead">
            Finish signing in with Google. If it opened somewhere else, come back here afterwards.
          </p>
          <div className="cloud-gate-actions">
            <span className="spinner" />
            <button type="button" className="button" onClick={onCancel}>
              <X size={15} /> Cancel
            </button>
          </div>
        </>
      )

    case 'enter-code':
      return <EnterCode error={gate.error} onCode={onCode} onCancel={onCancel} />

    case 'signed-out':
      return (
        <>
          <p className="panel-lead">
            Your music, from the bucket that belongs to your Google account — on this device,
            offline, with or without your Mac.
          </p>
          {gate.message && (
            <p className="notice notice-warn">
              <span>{gate.message}</span>
            </p>
          )}
          <div className="cloud-gate-actions">
            <button type="button" className="button button-primary" onClick={beginSignIn}>
              Sign in with Google
            </button>
          </div>
        </>
      )

    case 'needs-storage':
      return (
        <ConnectStorage session={gate.session} onConnected={onConnected} onSignOut={onSignOut} />
      )
  }
}

/** Google finished somewhere else: the code it ended with, typed in here. */
function EnterCode({
  error,
  onCode,
  onCancel,
}: {
  error: string | null
  onCode: (code: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState('')
  const [sending, setSending] = useState(false)
  const parsed = SignInCodeSchema.safeParse(value)

  useEffect(() => setSending(false), [error])

  return (
    <form
      className="cloud-gate-form"
      onSubmit={event => {
        event.preventDefault()
        if (!parsed.success) return
        setSending(true)
        onCode(parsed.data)
      }}
    >
      <p className="panel-lead">
        Signed in with Google. Enter the code it showed when it finished — it proves this is the
        device you signed in for.
      </p>
      <input
        className="input cloud-gate-code-input"
        aria-label="Sign-in code"
        placeholder="XXXX-XXXX"
        autoComplete="one-time-code"
        autoCapitalize="characters"
        spellCheck={false}
        maxLength={12}
        value={value}
        onChange={event => setValue(event.target.value)}
        autoFocus
      />
      {error && (
        <p className="notice notice-error" role="alert">
          <span>{error}</span>
        </p>
      )}
      <div className="cloud-gate-actions">
        <button
          type="submit"
          className="button button-primary"
          disabled={!parsed.success || sending}
        >
          Sign in
        </button>
        <button type="button" className="button" onClick={onCancel}>
          <X size={15} /> Cancel
        </button>
      </div>
    </form>
  )
}

function ConnectStorage({
  session,
  onConnected,
  onSignOut,
}: {
  session: CloudSession
  onConnected: (session: CloudSession) => void
  onSignOut: () => void
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const queryClient = useQueryClient()

  const submit = (input: CloudConnect): void => {
    setPending(true)
    setError(null)
    connectStorage(session, input)
      .then(next => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.library })
        onConnected(next)
      })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : String(reason))
      })
      .finally(() => setPending(false))
  }

  return (
    <BucketFields
      lead={
        <>
          Signed in as <strong>{session.me.email}</strong>. Connect the bucket that belongs to this
          account — once, from any device. If your Mac is signed in to the same account, it is the
          bucket it publishes to.
        </>
      }
      keyNote="B2 shows it once, when the key is made. It goes to the doorman, sealed; no device sees it again."
      pending={pending}
      error={error}
      onSubmit={submit}
      actions={
        <button type="button" className="button" onClick={onSignOut}>
          Sign out
        </button>
      }
    />
  )
}

/** Settings → Cloud, in the web build: who is signed in, and where the music comes from. */
export function CloudAccountSettings() {
  const account = useCloudAccount()
  const queryClient = useQueryClient()
  if (!account) return null
  const storage = account.session.me.storage
  const folder = storage
    ? storage.prefix
      ? `${storage.bucket}/${storage.prefix}`
      : storage.bucket
    : ''

  return (
    <section className="panel" id="cloud">
      <header className="panel-head">
        <h2>Cloud</h2>
        <span className="hint">signed in</span>
      </header>
      <p className="panel-lead">
        Your library comes from <code>{folder}</code>, the bucket that belongs to your Google
        account. Your Mac publishes to it; this device reads it and keeps what you download.
      </p>
      <div className="setting-row">
        <span className="setting-label">
          Google account
          <span className="setting-hint">Signed in as {account.session.me.email}</span>
        </span>
        <span className="setting-control">
          <button
            type="button"
            className="button"
            onClick={() => {
              markCloudLibraryStale()
              void queryClient.invalidateQueries({ queryKey: queryKeys.library })
            }}
          >
            Check for new songs
          </button>
          <button
            type="button"
            className="button button-danger"
            onClick={() => {
              const waiting = pendingCloudChanges()
              if (
                window.confirm(
                  'Sign out? Songs downloaded to this device are removed; your music stays in the bucket.' +
                    (waiting > 0
                      ? ` ${waiting} change${waiting === 1 ? '' : 's'} made here ${waiting === 1 ? 'has' : 'have'} not reached it yet and will be lost if ${waiting === 1 ? 'it' : 'they'} cannot be sent now.`
                      : ''),
                )
              ) {
                void account.signOut()
              }
            }}
          >
            Sign out
          </button>
        </span>
      </div>
    </section>
  )
}
