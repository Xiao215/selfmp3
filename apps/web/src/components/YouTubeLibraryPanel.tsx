import { useState } from 'react'
import { Link } from 'react-router-dom'
import { extractUrls, isYouTubeUrl, YT_LIKED_MUSIC_URL, type YtCookieTest } from '@selfmp3/shared'
import { useMutation } from '@tanstack/react-query'
import { api } from '../lib/api.js'
import { useSettings } from '../lib/queries.js'
import { CheckCircle, Heart, ListMusic, X } from '../components/Icons.js'

const BROWSER_NAMES: Record<string, string> = {
  chrome: 'Chrome',
  safari: 'Safari',
  firefox: 'Firefox',
  brave: 'Brave',
  edge: 'Edge',
  chromium: 'Chromium',
}

/**
 * "Bring my YouTube Music library".
 *
 * Liked Music and private playlists only resolve when yt-dlp is signed in,
 * so this panel does three things: says whether cookies are configured,
 * proves it with a Test button, and offers the quick sources — Liked Music
 * and pasted playlist links — which are pushed through the normal
 * probe → review → enqueue flow via `onImport`. Nothing downloads from here.
 */
export function YouTubeLibraryPanel({
  onImport,
  busy,
}: {
  onImport: (url: string) => void
  busy: boolean
}) {
  const { data: settings } = useSettings()
  const [playlistText, setPlaylistText] = useState('')
  const [result, setResult] = useState<YtCookieTest | null>(null)

  const test = useMutation({
    mutationFn: () => api.ytCookieTest(),
    onSuccess: setResult,
    onError: (err: Error) =>
      setResult({
        ok: false,
        source: 'none',
        count: null,
        playlistTitle: null,
        error: err.message,
      }),
  })

  const source = settings?.ytCookieSource ?? 'none'
  const configured = source !== 'none'
  const sourceLabel =
    source === 'browser'
      ? `cookies from ${BROWSER_NAMES[settings?.ytCookieBrowser ?? 'chrome'] ?? 'your browser'}`
      : source === 'file'
        ? `cookies from ${settings?.ytCookieFile.split('/').pop() || 'a file'}`
        : 'not signed in'

  const pastedLinks = extractUrls(playlistText).filter(isYouTubeUrl)

  return (
    <section className="panel yt-panel">
      <header className="panel-head">
        <h2>Import my YouTube Music library</h2>
      </header>

      <p className="panel-lead">
        Liked Music and private playlists need YouTube to see you as signed in. yt-dlp can borrow
        the login cookies from your browser, or read a cookies.txt file.
      </p>

      {/*
        * A coloured dot is not a status: the state is spelled out, and the dot
        * only reinforces it.
        */}
      <div className={`yt-status ${configured ? 'is-on' : ''}`}>
        <span className="yt-status-dot" aria-hidden="true" />
        <span>
          <strong>{configured ? 'Signed in' : 'Not signed in'}</strong>
          {configured ? (
            <> — using {sourceLabel}.</>
          ) : (
            <> — public playlists still work; Liked Music won’t.</>
          )}{' '}
          <Link to="/settings#youtube" className="link-button">
            {configured ? 'change in Settings' : 'set cookies up in Settings'}
          </Link>
        </span>
        <button
          type="button"
          className="button button-small"
          onClick={() => test.mutate()}
          disabled={test.isPending}
        >
          {test.isPending ? 'Testing…' : 'Test'}
        </button>
      </div>

      {settings?.ytCookieSource === 'browser' && settings.ytCookieBrowser === 'safari' && (
        <p className="hint">
          Safari keeps its cookies in a file macOS protects. The process running self.mp3 (Terminal,
          or node) needs <strong>Full Disk Access</strong> in System Settings → Privacy &amp;
          Security for this to work.
        </p>
      )}

      {result && (
        <div className={`notice ${result.ok ? 'notice-good' : 'notice-error'}`}>
          <span>
            {result.ok ? (
              <>
                <CheckCircle size={15} /> Signed in. {result.playlistTitle ?? 'Liked Music'} has{' '}
                {result.count} {result.count === 1 ? 'track' : 'tracks'}.
              </>
            ) : (
              result.error
            )}
          </span>
          <button
            type="button"
            className="icon-button"
            onClick={() => setResult(null)}
            aria-label="Dismiss"
          >
            <X size={15} />
          </button>
        </div>
      )}

      <div className="yt-sources">
        <button
          type="button"
          className="yt-source"
          onClick={() => onImport(YT_LIKED_MUSIC_URL)}
          disabled={busy}
        >
          <Heart size={16} filled />
          <span className="yt-source-text">
            <span className="yt-source-title">Liked Music</span>
            <span className="hint">
              Every song you’ve thumbed up. Reviewed before anything downloads.
            </span>
          </span>
        </button>

        <form
          className="yt-source yt-source-form"
          onSubmit={event => {
            event.preventDefault()
            if (pastedLinks.length > 0) onImport(pastedLinks.join('\n'))
          }}
        >
          <ListMusic size={16} />
          <span className="yt-source-text">
            <span className="yt-source-title">A playlist of yours</span>
            <textarea
              className="input yt-source-input"
              value={playlistText}
              onChange={event => setPlaylistText(event.target.value)}
              placeholder="https://music.youtube.com/playlist?list=PL…"
              rows={2}
              spellCheck={false}
            />
          </span>
          <button
            type="submit"
            className="button button-small"
            disabled={busy || pastedLinks.length === 0}
          >
            Fetch
          </button>
        </form>
      </div>

      <p className="hint">
        Tick <strong>also create playlist</strong> on the review screen to get a playlist here with
        the same name.
      </p>
    </section>
  )
}
