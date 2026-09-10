import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  formatDuration,
  IMPORT_STEP_LABELS,
  type ImportEnqueueItem,
  type ImportPreviewItem,
} from '@selfmp3/shared'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api.js'
import { queryKeys, useImportQueue, useImportTools, useLibrary } from '../lib/queries.js'
import { SHARE_PARAMS, sharedLinksFromQuery } from '../lib/shareTarget.js'
import { TagChip } from '../components/TagChip.js'
import { YouTubeLibraryPanel } from '../components/YouTubeLibraryPanel.js'
import { Check, CheckCircle, Download, Refresh, X } from '../components/Icons.js'

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

  const { data: queue } = useImportQueue(true)
  const hasActivity = (queue?.active ?? 0) + (queue?.queued ?? 0) > 0

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
      void queryClient.invalidateQueries({ queryKey: queryKeys.importQueue })
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
            Paste one or more links, one per line. A playlist link expands into its tracks.
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
          placeholder={'https://music.youtube.com/watch?v=…\nhttps://music.youtube.com/playlist?list=…'}
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
        Links from <strong>music.youtube.com</strong> carry proper track, artist and album
        metadata. Regular youtube.com links usually just have a video title.
      </p>

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
            </h2>
            <div className="import-review-actions">
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

          <div className="import-list">
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
                  aria-label={chosen.has(index) ? 'Deselect' : 'Select'}
                >
                  {chosen.has(index) && <Check size={12} />}
                </button>

                {item.thumbnail ? (
                  <img className="import-thumb" src={item.thumbnail} alt="" loading="lazy" />
                ) : (
                  <div className="import-thumb import-thumb-placeholder" />
                )}

                <div className="import-fields">
                  <input
                    className="input"
                    value={item.title}
                    onChange={event => patchItem(index, { title: event.target.value })}
                    placeholder="Title"
                    aria-label="Title"
                  />
                  <input
                    className="input"
                    value={item.artist}
                    onChange={event => patchItem(index, { artist: event.target.value })}
                    placeholder="Artist"
                    aria-label="Artist"
                  />
                  <input
                    className="input"
                    value={item.album}
                    onChange={event => patchItem(index, { album: event.target.value })}
                    placeholder="Album (optional)"
                    aria-label="Album"
                  />
                </div>

                <div className="import-item-side">
                  <span className="hint">{formatDuration(item.duration)}</span>
                  {item.alreadyHave && <span className="badge">already have</span>}
                </div>
              </div>
            ))}
          </div>

          <div className="import-options">
            <div className="import-option">
              <span className="field-label">Tag these as</span>
              <div className="tag-row-inline">
                {tags.map(tag => (
                  <TagChip
                    key={tag.id}
                    tag={tag}
                    active={tagIds.has(tag.id)}
                    onClick={() =>
                      setTagIds(current => {
                        const next = new Set(current)
                        if (next.has(tag.id)) next.delete(tag.id)
                        else next.add(tag.id)
                        return next
                      })
                    }
                  />
                ))}
                {tags.length === 0 && <span className="hint">Create tags in the sidebar first</span>}
              </div>
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
              <label className="import-option">
                <span className="field-label">Add to playlist</span>
                <select
                  className="select"
                  value={playlistId ?? ''}
                  onChange={event =>
                    setPlaylistId(event.target.value ? Number(event.target.value) : null)
                  }
                >
                  <option value="">Don’t add to a playlist</option>
                  {manualPlaylists.map(list => (
                    <option key={list.id} value={list.id}>
                      {list.name}
                    </option>
                  ))}
                </select>
              </label>
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

      <YouTubeLibraryPanel onImport={fetchLinks} busy={preview.isPending} />

      {queue && queue.jobs.length > 0 && (
        <div className="import-queue">
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

          <div className="job-list">
            {queue.jobs.map(job => (
              <div key={job.id} className={`job-row is-${job.status}`}>
                <span className="job-status">
                  {job.status === 'running' && <span className="spinner" />}
                  {job.status === 'done' && <CheckCircle size={16} />}
                  {job.status === 'error' && <X size={16} />}
                  {job.status === 'queued' && <span className="job-dot" />}
                </span>

                <span className="job-meta">
                  <span className="job-title">{job.title || job.url}</span>
                  <span className="job-sub">
                    {job.status === 'error'
                      ? job.error
                      : job.status === 'done'
                        ? 'Added to your library'
                        : IMPORT_STEP_LABELS[job.step]}
                  </span>
                </span>

                {job.status === 'running' && job.progress !== null && (
                  <span className="job-progress">
                    <span className="job-progress-bar" style={{ width: `${job.progress}%` }} />
                  </span>
                )}

                {(job.status === 'queued' || job.status === 'running') && (
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => {
                      void api.cancelImport(job.id).then(() => {
                        void queryClient.invalidateQueries({ queryKey: queryKeys.importQueue })
                      })
                    }}
                    aria-label="Cancel"
                  >
                    <X size={15} />
                  </button>
                )}

                {(job.status === 'error' || job.status === 'cancelled') && (
                  <button
                    type="button"
                    className="button button-small"
                    onClick={() => {
                      void api.retryImport(job.id).then(() => {
                        void queryClient.invalidateQueries({ queryKey: queryKeys.importQueue })
                      })
                    }}
                  >
                    Retry
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
