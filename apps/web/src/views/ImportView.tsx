import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  formatDuration,
  IMPORT_STEP_LABELS,
  type ImportEnqueueItem,
  type ImportJob,
  type ImportPreviewItem,
} from '@selfmp3/shared'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api.js'
import { queryKeys, useImportQueue, useImportTools, useLibrary } from '../lib/queries.js'
import { SHARE_PARAMS, sharedLinksFromQuery } from '../lib/shareTarget.js'
import { TagChooser } from '../components/TagChooser.js'
import { canListen, ListenBar, ListenButton, useListen } from '../components/ImportListen.js'
import { YouTubeLibraryPanel } from '../components/YouTubeLibraryPanel.js'
import {
  Check,
  CheckCircle,
  ChevronRight,
  Clock,
  Download,
  ListMusic,
  Refresh,
  X,
} from '../components/Icons.js'
import { Select } from '../components/Select.js'

/** What each queue state is called, for the icon's tooltip and screen readers. */
const JOB_STATUS_LABELS: Record<ImportJob['status'], string> = {
  queued: 'Waiting',
  running: 'Downloading',
  done: 'Done',
  error: 'Failed',
  cancelled: 'Cancelled',
}

/**
 * In the library on the Mac but not yet in the cloud bucket: not a failure,
 * and the cloud sync finishes the job by itself (docs/SYNC.md).
 */
function waitingToUpload(job: ImportJob): boolean {
  return job.status === 'error' && job.step === 'uploading'
}

function jobLabel(job: ImportJob): string {
  return waitingToUpload(job) ? 'Waiting to upload' : JOB_STATUS_LABELS[job.status]
}

/**
 * Importing.
 *
 * Two steps on purpose: fetch metadata first, review and correct it, then
 * commit. A 40-track playlist is exactly the case where you want to see what
 * you are about to download — and to untick the six tracks you already have.
 */
export function ImportView() {
  const { data: library } = useLibrary()
  const { data: tools, refetch: refetchTools } = useImportTools()
  const queryClient = useQueryClient()

  const [url, setUrl] = useState('')
  const [items, setItems] = useState<ImportPreviewItem[] | null>(null)
  const [chosen, setChosen] = useState<ReadonlySet<number>>(() => new Set())
  const [tagIds, setTagIds] = useState<ReadonlySet<number>>(() => new Set())
  const [playlistId, setPlaylistId] = useState<number | null>(null)
  /** The source playlist's name, when the link was one — for "also create playlist". */
  const [playlistTitle, setPlaylistTitle] = useState<string | null>(null)
  const [createPlaylist, setCreatePlaylist] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()

  const tags = library?.tags ?? []
  const manualPlaylists = (library?.playlists ?? []).filter(list => list.kind === 'manual')

  const listen = useListen()
  // A preview whose track has left the review — cancelled, imported, or a new
  // link fetched — stops with it. Editing a row keeps its url, so it plays on.
  const listeningUrl = listen.listening?.track.url
  useEffect(() => {
    if (listeningUrl && !items?.some(item => item.url === listeningUrl)) listen.close()
  }, [items, listeningUrl])

  const { data: queue } = useImportQueue(true)
  const hasActivity = (queue?.active ?? 0) + (queue?.queued ?? 0) > 0
  const queueRef = useRef<HTMLDivElement>(null)

  const preview = useMutation({
    mutationFn: (input: string) => api.importPreview(input),
    onSuccess: result => {
      setItems(result.items)
      setPlaylistTitle(result.kind === 'playlist' ? result.playlistTitle : null)
      setCreatePlaylist(false)
      // Pre-tick everything except tracks that look like duplicates.
      setChosen(
        new Set(
          result.items.map((item, index) => (item.alreadyHave ? -1 : index)).filter(i => i >= 0),
        ),
      )
      setError(null)
    },
    onError: (err: Error) => setError(err.message),
  })

  const enqueue = useMutation({
    mutationFn: (input: ImportEnqueueItem[]) =>
      api.importEnqueue({
        items: input,
        tagIds: [...tagIds],
        playlistId,
        createPlaylistName: playlistId === null && createPlaylist ? playlistTitle : null,
      }),
    onSuccess: result => {
      setItems(null)
      setUrl('')
      setChosen(new Set())
      // Once the new jobs are rendered, bring them into view: the review card
      // just collapsed, so whatever was under the pointer is gone.
      void queryClient.invalidateQueries({ queryKey: queryKeys.importQueue }).then(() => {
        requestAnimationFrame(() =>
          queueRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }),
        )
      })
      // A playlist may have been created for this import.
      if (result.playlistId !== null) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.library })
      }
    },
    onError: (err: Error) => setError(err.message),
  })

  /** Prefill the box and fetch, for share sheets and the quick sources below. */
  const fetchLinks = (links: string): void => {
    setUrl(links)
    setItems(null)
    preview.mutate(links)
  }

  // Web Share Target: Android/Chrome opens `/import?url=…&text=…` when a link
  // is shared to the installed app. Read it once, run the probe straight away,
  // and strip the query so a reload does not fetch it again.
  const sharedOnce = useRef(false)
  const shared = sharedLinksFromQuery(searchParams.toString())
  useEffect(() => {
    if (!shared || sharedOnce.current) return
    sharedOnce.current = true
    fetchLinks(shared)
    setSearchParams(
      current => {
        const next = new URLSearchParams(current)
        for (const key of SHARE_PARAMS) next.delete(key)
        return next
      },
      { replace: true },
    )
    // Only `shared` matters here; the ref guards against a second run anyway.
  }, [shared])

  const selectedItems = useMemo(
    () => (items ?? []).filter((_, index) => chosen.has(index)),
    [items, chosen],
  )

  const duplicateCount = (items ?? []).filter(item => item.alreadyHave).length

  const start = (): void => {
    if (selectedItems.length === 0) return
    enqueue.mutate(
      selectedItems.map(item => ({
        url: item.url,
        title: item.title,
        artist: item.artist,
        album: item.album,
        thumbnail: item.thumbnail,
        duration: item.duration,
      })),
    )
  }

  const patchItem = (index: number, patch: Partial<ImportPreviewItem>): void => {
    setItems(current =>
      current ? current.map((item, i) => (i === index ? { ...item, ...patch } : item)) : current,
    )
  }

  return (
    <section className="view">
      <header className="view-head">
        <div className="view-titles">
          <h1>Import</h1>
          <p className="view-sub">
            Paste one or more links, one per line. A playlist expands into its tracks, and an
            artist’s page into their top songs.
          </p>
        </div>
      </header>

      {tools && !tools.ytdlp && (
        <div className="notice notice-warn">
          <div>
            <strong>yt-dlp isn’t installed.</strong> Importing needs it. Install both tools with:
            <pre className="code-block">brew install yt-dlp ffmpeg</pre>
          </div>
          <button type="button" className="button button-small" onClick={() => void refetchTools()}>
            <Refresh size={13} /> Check again
          </button>
        </div>
      )}

      {tools?.ytdlp && !tools.ffmpeg && (
        <div className="notice">
          <span>
            <strong>ffmpeg isn’t installed.</strong> Downloads still work, but cover art and tags
            won’t be embedded. <code>brew install ffmpeg</code>
          </span>
        </div>
      )}

      <form
        className="import-form"
        onSubmit={event => {
          event.preventDefault()
          if (url.trim()) preview.mutate(url.trim())
        }}
      >
        <textarea
          className="import-input"
          value={url}
          onChange={event => setUrl(event.target.value)}
          placeholder={
            'https://music.youtube.com/watch?v=…\nhttps://music.youtube.com/playlist?list=…\nhttps://music.youtube.com/@artist'
          }
          rows={3}
          spellCheck={false}
        />
        <button
          type="submit"
          className="button button-primary"
          disabled={preview.isPending || !url.trim() || tools?.ytdlp === false}
        >
          {preview.isPending ? 'Reading…' : 'Fetch details'}
        </button>
      </form>

      <p className="hint">
        Links from <strong>music.youtube.com</strong> carry proper track, artist and album metadata.
        Regular youtube.com links usually just have a video title.
      </p>

      <Link to="/import/migrate" className="migrate-card">
        <span className="migrate-card-icon">
          <ListMusic size={18} />
        </span>
        <span className="migrate-card-text">
          <span className="migrate-card-title">Migrate a playlist from another app</span>
          <span className="migrate-card-sub">
            Paste a Spotify link, a CSV export or a list of songs; each one is matched to a YouTube
            upload for you to check before importing.
          </span>
        </span>
        <ChevronRight size={16} />
      </Link>

      {error && (
        <div className="notice notice-error">
          {error}
          <button
            type="button"
            className="icon-button"
            onClick={() => setError(null)}
            aria-label="Dismiss"
          >
            <X size={15} />
          </button>
        </div>
      )}

      {items && items.length > 0 && (
        <div className="import-review">
          <div className="import-review-head">
            <h2>
              {items.length} {items.length === 1 ? 'track' : 'tracks'} found
              {duplicateCount > 0 && (
                <span className="hint">
                  {' '}
                  · {duplicateCount} already in your library
                </span>
              )}
            </h2>
            <div className="import-review-actions">
              <span className="hint">
                {selectedItems.length} of {items.length} selected
              </span>
              <button
                type="button"
                className="link-button"
                onClick={() => setChosen(new Set(items.map((_, index) => index)))}
              >
                select all
              </button>
              <button type="button" className="link-button" onClick={() => setChosen(new Set())}>
                select none
              </button>
            </div>
          </div>

          {/*
            * A real table rather than a stack of cards: one line per track,
            * with title, artist and album as three columns you can tab across.
            * A forty-track playlist is the case this screen exists for, and
            * three stacked full-width inputs per track made six of them fill
            * the screen.
            */}
          <div className="import-list" role="group" aria-label="Tracks to import">
            <div className="import-item import-item-head" aria-hidden="true">
              <span />
              <span />
              <span>Title</span>
              <span>Artist</span>
              <span>Album</span>
              <span className="import-col-side">Length</span>
            </div>

            {items.map((item, index) => (
              <div
                key={`${item.url}-${index}`}
                className={`import-item ${chosen.has(index) ? 'is-chosen' : ''} ${
                  item.alreadyHave ? 'is-duplicate' : ''
                }`}
              >
                <button
                  type="button"
                  className={`checkbox ${chosen.has(index) ? 'is-on' : ''}`}
                  onClick={() =>
                    setChosen(current => {
                      const next = new Set(current)
                      if (next.has(index)) next.delete(index)
                      else next.add(index)
                      return next
                    })
                  }
                  role="checkbox"
                  aria-checked={chosen.has(index)}
                  aria-label={`Import ${item.title}`}
                >
                  {chosen.has(index) && <Check size={12} />}
                </button>

                {canListen(item) ? (
                  <ListenButton
                    item={item}
                    listening={listen.listening}
                    onToggle={() => listen.toggle(item)}
                  />
                ) : item.thumbnail ? (
                  <img className="import-thumb" src={item.thumbnail} alt="" loading="lazy" />
                ) : (
                  <div className="import-thumb import-thumb-placeholder" />
                )}

                <input
                  className="input input-small"
                  value={item.title}
                  onChange={event => patchItem(index, { title: event.target.value })}
                  placeholder="Title"
                  aria-label={`Title of track ${index + 1}`}
                />
                <input
                  className="input input-small"
                  value={item.artist}
                  onChange={event => patchItem(index, { artist: event.target.value })}
                  placeholder="Artist"
                  aria-label={`Artist of track ${index + 1}`}
                />
                <input
                  className="input input-small"
                  value={item.album}
                  onChange={event => patchItem(index, { album: event.target.value })}
                  placeholder="Album"
                  aria-label={`Album of track ${index + 1}`}
                />

                <span className="import-col-side">
                  {item.alreadyHave ? (
                    <span className="import-dup" data-tip="A song with this title and artist is already in your library">
                      <CheckCircle size={12} /> Have it
                    </span>
                  ) : item.duration > 0 ? (
                    <span className="hint">{formatDuration(item.duration)}</span>
                  ) : null}
                </span>
              </div>
            ))}
          </div>

          {listen.listening && (
            <ListenBar
              listening={listen.listening}
              onToggle={() => listen.listening && listen.toggle(listen.listening.track)}
              onSeek={listen.seek}
              onClose={listen.close}
            />
          )}

          <div className="import-options">
            <div className="import-option">
              <span className="field-label">Tag these as</span>
              <TagChooser tags={tags} selected={tagIds} onChange={setTagIds} />
            </div>

            {playlistTitle && playlistId === null && (
              <label className="import-option import-option-check">
                <input
                  type="checkbox"
                  className="toggle"
                  checked={createPlaylist}
                  onChange={event => setCreatePlaylist(event.target.checked)}
                />
                <span className="field-label">
                  Also create playlist <strong>“{playlistTitle}”</strong>
                </span>
              </label>
            )}

            {manualPlaylists.length > 0 && (
              <div className="import-option">
                <span className="field-label">Add to playlist</span>
                <Select<number | null>
                  value={playlistId}
                  onChange={setPlaylistId}
                  options={[
                    { value: null, label: 'Don\u2019t add to a playlist' },
                    ...manualPlaylists.map(list => ({ value: list.id, label: list.name })),
                  ]}
                  label="Add to playlist"
                />
              </div>
            )}
          </div>

          <div className="import-submit">
            <button
              type="button"
              className="button button-primary button-large"
              onClick={start}
              disabled={selectedItems.length === 0 || enqueue.isPending}
            >
              <Download size={16} />
              Import {selectedItems.length} {selectedItems.length === 1 ? 'track' : 'tracks'}
            </button>
            <button type="button" className="button" onClick={() => setItems(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/*
        * The queue takes the review card's place, above the library panel:
        * below it, a just-started import landed off-screen and looked like
        * the button had done nothing.
        */}
      {queue && queue.jobs.length > 0 && (
        <div className="import-queue" ref={queueRef}>
          <div className="import-queue-head">
            <h2>
              Queue
              {hasActivity && (
                <span className="hint">
                  {' '}
                  · {queue.active} downloading, {queue.queued} waiting
                </span>
              )}
            </h2>
            <button
              type="button"
              className="link-button"
              onClick={() => {
                void api.clearImports().then(() => {
                  void queryClient.invalidateQueries({ queryKey: queryKeys.importQueue })
                })
              }}
            >
              clear finished
            </button>
          </div>

          <div className="job-list" aria-live="polite">
            {queue.jobs.map(job => (
              <div
                key={job.id}
                className={`job-row is-${waitingToUpload(job) ? 'waiting' : job.status}`}
              >
                <span className="job-status" data-tip={jobLabel(job)}>
                  {job.status === 'running' && <span className="spinner" />}
                  {job.status === 'done' && <CheckCircle size={16} />}
                  {job.status === 'error' &&
                    (waitingToUpload(job) ? <Clock size={16} /> : <X size={16} />)}
                  {job.status === 'cancelled' && <X size={16} />}
                  {job.status === 'queued' && <span className="job-dot" />}
                  <span className="visually-hidden">{jobLabel(job)}</span>
                </span>

                <span className="job-meta">
                  <span className="job-title">{job.title || job.url}</span>
                  <span className="job-sub">
                    {job.status === 'error'
                      ? (job.error ?? 'Failed')
                      : job.status === 'cancelled'
                        ? 'Cancelled'
                        : job.status === 'done'
                          ? 'Added to your library'
                          : IMPORT_STEP_LABELS[job.step]}
                    {job.status === 'error' && job.attempts > 1 && ` \u00b7 ${job.attempts} attempts`}
                  </span>
                </span>

                {/*
                  * A download reports a percentage; the steps around it do not.
                  * The bar is there either way so the row does not change width
                  * halfway through - it just goes indeterminate.
                  */}
                {job.status === 'running' && (
                  <span
                    className={`job-progress ${job.progress === null ? 'is-indeterminate' : ''}`}
                    role="progressbar"
                    aria-valuenow={job.progress ?? undefined}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`${job.title || 'Track'} progress`}
                  >
                    <span
                      className="job-progress-bar"
                      style={job.progress === null ? undefined : { width: `${job.progress}%` }}
                    />
                  </span>
                )}

                {job.status === 'running' && job.progress !== null && (
                  <span className="job-percent">{Math.round(job.progress)}%</span>
                )}

                {(job.status === 'queued' || job.status === 'running') && (
                  <button
                    type="button"
                    className="icon-button icon-button-tiny job-action"
                    onClick={() => {
                      void api.cancelImport(job.id).then(() => {
                        void queryClient.invalidateQueries({ queryKey: queryKeys.importQueue })
                      })
                    }}
                    aria-label={`Cancel ${job.title || 'this import'}`}
                    data-tip="Cancel"
                  >
                    <X size={15} />
                  </button>
                )}

                {(job.status === 'error' || job.status === 'cancelled') && (
                  <button
                    type="button"
                    className="button button-small job-action"
                    onClick={() => {
                      void api.retryImport(job.id).then(() => {
                        void queryClient.invalidateQueries({ queryKey: queryKeys.importQueue })
                      })
                    }}
                    aria-label={`Retry ${job.title || 'this import'}`}
                  >
                    <Refresh size={13} /> {waitingToUpload(job) ? 'Try now' : 'Retry'}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <YouTubeLibraryPanel onImport={fetchLinks} busy={preview.isPending} />
    </section>
  )
}
