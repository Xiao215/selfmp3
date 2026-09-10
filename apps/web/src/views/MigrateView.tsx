import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  formatDuration,
  type MigrateCandidate,
  type MigrateMatchItem,
  type MigrateParseResult,
} from '@selfmp3/shared'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api.js'
import { queryKeys, useImportTools, useLibrary, useMigrateJob } from '../lib/queries.js'
import { TagChip } from '../components/TagChip.js'
import { Check, Download, X } from '../components/Icons.js'

/**
 * Migrating a playlist from Spotify, Apple Music or a text file.
 *
 * Three stages on one page: paste, match, review. The match step is a server
 * job that is polled, because fifty YouTube searches take a minute and the
 * phone should be able to lock and come back to a finished table.
 */

type Stage = 'input' | 'matching' | 'review'

const PLACEHOLDER = [
  'Daft Punk - Get Lucky',
  'Hello by Adele',
  'Radiohead — Creep',
  '',
  '…or paste a CSV export, or a public Spotify playlist link',
].join('\n')

export function MigrateView() {
  const { data: library } = useLibrary()
  const { data: tools } = useImportTools()
  const queryClient = useQueryClient()

  const [text, setText] = useState('')
  const [parsed, setParsed] = useState<MigrateParseResult | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ count: number; playlistId: number | null } | null>(null)

  // Per-row review state, keyed by track index.
  const [chosen, setChosen] = useState<ReadonlySet<number>>(() => new Set())
  const [picked, setPicked] = useState<ReadonlyMap<number, number>>(() => new Map())
  const [tagIds, setTagIds] = useState<ReadonlySet<number>>(() => new Set())
  const [playlistName, setPlaylistName] = useState('')

  const { data: job } = useMigrateJob(jobId)
  const tags = library?.tags ?? []

  const stage: Stage = job ? (job.status === 'running' ? 'matching' : 'review') : 'input'

  // Once the job finishes, pre-tick the rows worth importing: a confident
  // match that is not already in the library. Only once per job, so a poll
  // that arrives after the user has unticked something does not re-tick it.
  const [tickedFor, setTickedFor] = useState<string | null>(null)
  useEffect(() => {
    if (!job || job.status === 'running' || tickedFor === job.id) return
    setTickedFor(job.id)
    setChosen(
      new Set(
        job.items.flatMap((item, index) => {
          const best = item?.candidates[0]
          return best && best.confidence >= 0.5 && !item.alreadyHave ? [index] : []
        }),
      ),
    )
  }, [job, tickedFor])

  const rows = useMemo(
    () =>
      (job?.items ?? []).flatMap((item, index) => {
        if (!item) return []
        const match = item.candidates[picked.get(index) ?? 0] ?? null
        return [{ index, item, match }]
      }),
    [job?.items, picked],
  )

  const parse = useMutation({
    mutationFn: (input: string) => api.migrateParse(input),
    onSuccess: async result => {
      setParsed(result)
      setPlaylistName(result.playlistName ?? '')
      setError(null)
      const started = await api.migrateMatch(result.tracks)
      setJobId(started.id)
    },
    onError: (err: Error) => setError(err.message),
  })

  const enqueue = useMutation({
    mutationFn: () => {
      const items = rows
        .filter(row => chosen.has(row.index) && row.match)
        .map(row => {
          const match = row.match as MigrateCandidate
          return {
            url: match.url,
            title: row.item.source.title,
            artist: row.item.source.artist,
            album: row.item.source.album,
            thumbnail: match.thumbnail,
            duration: row.item.source.duration || match.duration,
          }
        })
      return api.migrateEnqueue({
        items,
        tagIds: [...tagIds],
        playlistName: playlistName.trim() || null,
      })
    },
    onSuccess: result => {
      setDone({ count: result.jobs.length, playlistId: result.playlistId })
      void queryClient.invalidateQueries({ queryKey: queryKeys.importQueue })
      void queryClient.invalidateQueries({ queryKey: queryKeys.library })
    },
    onError: (err: Error) => setError(err.message),
  })

  const selectedCount = rows.filter(row => chosen.has(row.index) && row.match).length

  const reset = (): void => {
    setJobId(null)
    setParsed(null)
    setDone(null)
    setChosen(new Set())
    setPicked(new Map())
    setTickedFor(null)
    setError(null)
  }

  const toggle = (index: number): void =>
    setChosen(current => {
      const next = new Set(current)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })

  return (
    <section className="view">
      <header className="view-head">
        <div className="view-titles">
          <h1>Migrate a playlist</h1>
          <p className="view-sub">
            Bring a playlist over from Spotify, Apple Music or anywhere else. Each song is matched
            to a YouTube upload, you check the matches, then they import as usual.
          </p>
        </div>
      </header>

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

      {done ? (
        <div className="notice notice-good migrate-done">
          <span>
            <strong>
              {done.count} {done.count === 1 ? 'song' : 'songs'} queued.
            </strong>{' '}
            Watch progress on the <Link to="/import">Import page</Link>
            {done.playlistId !== null && (
              <>
                {' '}
                — they will land in{' '}
                <Link to={`/playlists/${done.playlistId}`}>{playlistName.trim()}</Link>
              </>
            )}
            .
          </span>
          <button type="button" className="button button-small" onClick={reset}>
            Migrate another
          </button>
        </div>
      ) : stage === 'input' ? (
        <>
          <form
            className="import-form"
            onSubmit={event => {
              event.preventDefault()
              if (text.trim()) parse.mutate(text)
            }}
          >
            <textarea
              className="import-input migrate-input"
              value={text}
              onChange={event => setText(event.target.value)}
              placeholder={PLACEHOLDER}
              rows={8}
              spellCheck={false}
            />
            <button
              type="submit"
              className="button button-primary"
              disabled={parse.isPending || !text.trim() || tools?.ytdlp === false}
            >
              {parse.isPending ? 'Reading…' : 'Find matches'}
            </button>
          </form>

          <p className="hint">
            One song per line — <code>Artist - Title</code>, <code>Title by Artist</code> or just a
            title. Or paste a whole CSV: from Spotify use{' '}
            <a href="https://exportify.net" target="_blank" rel="noreferrer">
              exportify.net
            </a>{' '}
            (log in, pick the playlist, Export); from Apple Music use File → Library → Export
            Playlist; TuneMyMusic exports work too. A public Spotify playlist link is read directly
            when Spotify allows it.
          </p>
        </>
      ) : (
        <div className="import-review migrate-review">
          <div className="import-review-head">
            <h2>
              {stage === 'matching' ? (
                <>
                  <span className="spinner" /> Matching {job?.completed ?? 0} of {job?.total ?? 0}
                </>
              ) : (
                <>
                  {rows.filter(row => row.match).length} of {rows.length}{' '}
                  {rows.length === 1 ? 'song' : 'songs'} matched
                  {job?.status === 'cancelled' && <span className="hint"> · stopped early</span>}
                </>
              )}
            </h2>
            <div className="import-review-actions">
              {stage === 'matching' ? (
                <button
                  type="button"
                  className="link-button"
                  onClick={() => {
                    if (jobId) void api.cancelMigrateJob(jobId).catch(() => undefined)
                  }}
                >
                  stop
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => setChosen(new Set(rows.filter(r => r.match).map(r => r.index)))}
                  >
                    select all
                  </button>
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => setChosen(new Set())}
                  >
                    select none
                  </button>
                </>
              )}
            </div>
          </div>

          {stage === 'matching' && job && (
            <div className="job-progress migrate-progress">
              <span
                className="job-progress-bar"
                style={{ width: `${job.total ? (job.completed / job.total) * 100 : 0}%` }}
              />
            </div>
          )}

          {parsed && parsed.skipped.length > 0 && (
            <p className="hint">
              Could not read {parsed.skipped.length}{' '}
              {parsed.skipped.length === 1 ? 'line' : 'lines'}:{' '}
              {parsed.skipped.slice(0, 3).join(' · ')}
              {parsed.skipped.length > 3 && ' …'}
            </p>
          )}

          <div className="migrate-table-wrap">
            <table className="migrate-table">
              <thead>
                <tr>
                  <th className="migrate-col-check" />
                  <th>Source</th>
                  <th>Match on YouTube</th>
                  <th className="migrate-col-conf">Confidence</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <MigrateRow
                    key={row.index}
                    row={row}
                    checked={chosen.has(row.index)}
                    onToggle={() => toggle(row.index)}
                    onPick={candidate =>
                      setPicked(current => new Map(current).set(row.index, candidate))
                    }
                  />
                ))}
                {stage === 'matching' && rows.length < (job?.total ?? 0) && (
                  <tr className="migrate-row-pending">
                    <td colSpan={4} className="hint">
                      Searching… {(job?.total ?? 0) - rows.length} to go
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {stage === 'review' && (
            <>
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
                    {tags.length === 0 && (
                      <span className="hint">Create tags in the sidebar first</span>
                    )}
                  </div>
                </div>

                <label className="import-option">
                  <span className="field-label">Create playlist named</span>
                  <input
                    className="input migrate-playlist-name"
                    value={playlistName}
                    onChange={event => setPlaylistName(event.target.value)}
                    placeholder="Leave empty to skip"
                  />
                </label>
              </div>

              <div className="import-submit">
                <button
                  type="button"
                  className="button button-primary button-large"
                  onClick={() => enqueue.mutate()}
                  disabled={selectedCount === 0 || enqueue.isPending}
                >
                  <Download size={16} />
                  Import {selectedCount} {selectedCount === 1 ? 'song' : 'songs'}
                </button>
                <button type="button" className="button" onClick={reset}>
                  Start over
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  )
}

function confidenceClass(confidence: number): string {
  return confidence >= 0.8 ? 'is-good' : confidence >= 0.5 ? 'is-fair' : 'is-poor'
}

function MigrateRow({
  row,
  checked,
  onToggle,
  onPick,
}: {
  row: { index: number; item: MigrateMatchItem; match: MigrateCandidate | null }
  checked: boolean
  onToggle: () => void
  onPick: (candidate: number) => void
}) {
  const { item, match } = row
  const pickedIndex = match ? item.candidates.indexOf(match) : 0
  // A thumbnail that fails to load (offline, or a video gone) becomes a plain box.
  const [thumbFailed, setThumbFailed] = useState(false)

  return (
    <tr
      className={`migrate-row ${checked ? 'is-chosen' : ''} ${item.alreadyHave ? 'is-duplicate' : ''}`}
    >
      <td className="migrate-col-check">
        <button
          type="button"
          className={`checkbox ${checked ? 'is-on' : ''}`}
          onClick={onToggle}
          disabled={!match}
          aria-label={checked ? 'Deselect' : 'Select'}
        >
          {checked && <Check size={12} />}
        </button>
      </td>

      <td className="migrate-source">
        <span className="migrate-title">{item.source.title}</span>
        <span className="migrate-sub">
          {item.source.artist || 'Unknown artist'}
          {item.source.duration > 0 && ` · ${formatDuration(item.source.duration)}`}
        </span>
        {item.alreadyHave && <span className="badge">already have</span>}
      </td>

      <td className="migrate-match">
        {match ? (
          <div className="migrate-match-inner">
            {match.thumbnail && !thumbFailed ? (
              <img
                className="migrate-thumb"
                src={match.thumbnail}
                alt=""
                loading="lazy"
                onError={() => setThumbFailed(true)}
              />
            ) : (
              <div className="migrate-thumb migrate-thumb-placeholder" />
            )}
            <div className="migrate-match-text">
              <select
                className="select migrate-pick"
                value={pickedIndex}
                onChange={event => onPick(Number(event.target.value))}
                aria-label="Choose a different match"
              >
                {item.candidates.map((candidate, index) => (
                  <option key={candidate.url} value={index}>
                    {Math.round(candidate.confidence * 100)}% · {candidate.title}
                  </option>
                ))}
              </select>
              <span className="migrate-sub">
                {match.channel || 'Unknown channel'}
                {match.duration > 0 && ` · ${formatDuration(match.duration)}`}
              </span>
            </div>
          </div>
        ) : (
          <span className="migrate-sub">{item.error ?? 'No results'}</span>
        )}
      </td>

      <td className="migrate-col-conf">
        {match && (
          <span className={`migrate-confidence ${confidenceClass(match.confidence)}`}>
            {Math.round(match.confidence * 100)}%
          </span>
        )}
      </td>
    </tr>
  )
}
