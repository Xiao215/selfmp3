import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { ask, type Status } from '../bridge.js'

/**
 * Where the extension imports to. A typed address and token for now; signing
 * in with Google, for the bucket when the server is away, comes with Phase 5.
 */
export function Options(): ReactNode {
  const queryClient = useQueryClient()
  const [address, setAddress] = useState('')
  const [token, setToken] = useState('')

  const status = useQuery({
    queryKey: ['status'],
    queryFn: () => ask({ type: 'status' }),
    retry: false,
  })
  const remember = (next: Status): void => {
    queryClient.setQueryData(['status'], next)
  }

  const connect = useMutation({
    mutationFn: () => ask({ type: 'connect', baseUrl: address, token: token || null }),
    onSuccess: next => {
      remember(next)
      setToken('')
    },
  })
  const disconnect = useMutation({
    mutationFn: () => ask({ type: 'disconnect' }),
    onSuccess: remember,
  })

  const server = status.data?.server ?? null
  const songCount = status.data?.songCount ?? null

  return (
    <main className="options">
      <h1>
        <span className="logo">
          self<i>.</i>mp3
        </span>{' '}
        extension
      </h1>
      <p className="lede">
        The extension imports through your self.mp3 server, the one that runs yt-dlp. Tell it where
        that is.
      </p>

      {server && (
        <section className="card" aria-live="polite">
          <p>
            Connected to <b>{server.baseUrl}</b>
            {songCount !== null ? ` · ${songCount} songs` : ''}
          </p>
          {status.data?.reachable === false && (
            <p className="hint">It isn’t answering right now.</p>
          )}
          <button
            type="button"
            className="secondary"
            disabled={disconnect.isPending}
            onClick={() => disconnect.mutate()}
          >
            Disconnect
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
        <h2>{server ? 'Connect to another server' : 'Connect to your server'}</h2>
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
        <label className="field">
          <span>Token</span>
          <input
            id="token"
            type="password"
            value={token}
            autoComplete="off"
            onChange={event => setToken(event.target.value)}
          />
        </label>
        <p className="hint">
          Only if the server has <code>SELFMP3_AUTH_TOKEN</code> set.
        </p>
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
