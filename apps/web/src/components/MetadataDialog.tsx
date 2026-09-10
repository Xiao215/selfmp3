import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  formatDuration,
  type ApplyMetadata,
  type MetadataCandidate,
  type Song,
} from '@selfmp3/shared'
import { useApplyMetadata, useMetadataLookup } from '../lib/queries.js'
import { Cover } from './Cover.js'
import { Check, X } from './Icons.js'

/**
 * "Fix metadata…" — current values on the left, candidates from iTunes and
 * MusicBrainz on the right, and a per-field diff in between so the user
 * applies exactly the corrections they agree with and nothing else.
 *
 * Rendered through a portal: the song menu that opens this lives inside a
 * song row whose double-click starts playback, and a dialog should never be
 * one stray click away from changing what is playing.
 */

type Field = 'title' | 'artist' | 'album' | 'albumArtist' | 'year' | 'trackNo' | 'artwork'

const FIELD_LABELS: Record<Field, string> = {
  title: 'Title',
  artist: 'Artist',
  album: 'Album',
  albumArtist: 'Album artist',
  year: 'Year',
  trackNo: 'Track №',
  artwork: 'Artwork',
}

const SOURCE_LABELS: Record<MetadataCandidate['source'], string> = {
  itunes: 'iTunes',
  musicbrainz: 'MusicBrainz',
}

interface Diff {
  readonly field: Field
  readonly current: string
  readonly proposed: string
  readonly value: ApplyMetadata[keyof ApplyMetadata]
}

function text(value: string | number | null | undefined): string {
  return value === null || value === undefined || value === '' ? '—' : String(value)
}

/** Every field where the candidate offers something different from the song. */
function diffFields(song: Song, candidate: MetadataCandidate): Diff[] {
  const diffs: Diff[] = []
  const push = (
    field: Field,
    current: string | number | null,
    proposed: string | number | undefined,
  ): void => {
    if (proposed === undefined || proposed === '' || proposed === current) return
    diffs.push({ field, current: text(current), proposed: text(proposed), value: proposed })
  }
  push('title', song.title, candidate.title)
  push('artist', song.artist, candidate.artist)
  push('album', song.album, candidate.album)
  push('albumArtist', song.albumArtist, candidate.albumArtist)
  push('year', song.year, candidate.year)
  push('trackNo', song.trackNo, candidate.trackNo)
  if (candidate.artworkUrl) {
    diffs.push({
      field: 'artwork',
      current: song.hasArt ? 'has art' : 'none',
      proposed: SOURCE_LABELS[candidate.source],
      value: candidate.artworkUrl,
    })
  }
  return diffs
}

export function MetadataDialog({ song, onClose }: { song: Song; onClose: () => void }) {
  const lookup = useMetadataLookup(song.id)
  const apply = useApplyMetadata()

  const candidates = lookup.data?.candidates ?? []
  const [selectedIndex, setSelectedIndex] = useState(0)
  const selected = candidates[selectedIndex]

  const diffs = useMemo(() => (selected ? diffFields(song, selected) : []), [song, selected])

  // Everything a candidate offers starts ticked; the user unticks what they
  // do not trust. Re-seeded whenever a different candidate is picked.
  const [ticked, setTicked] = useState<ReadonlySet<Field>>(new Set())
  useEffect(() => {
    setTicked(new Set(diffs.map(diff => diff.field)))
  }, [diffs])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const toggle = (field: Field): void => {
    setTicked(previous => {
      const next = new Set(previous)
      if (next.has(field)) next.delete(field)
      else next.add(field)
      return next
    })
  }

  const submit = (): void => {
    const input: ApplyMetadata = {}
    for (const diff of diffs) {
      if (!ticked.has(diff.field)) continue
      if (diff.field === 'artwork') input.artworkUrl = String(diff.value)
      else if (diff.field === 'year' || diff.field === 'trackNo')
        input[diff.field] = Number(diff.value)
      else input[diff.field] = String(diff.value)
    }
    if (Object.keys(input).length === 0) return
    apply.mutate({ id: song.id, input }, { onSuccess: onClose })
  }

  const applyCount = diffs.filter(diff => ticked.has(diff.field)).length

  return createPortal(
    <div className="meta-backdrop" onClick={onClose}>
      <div
        className="meta-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Fix metadata"
        onClick={event => event.stopPropagation()}
      >
        <header className="meta-head">
          <h2>Fix metadata</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </header>

        <div className="meta-body">
          <section className="meta-current">
            <h3 className="meta-section-title">In your library</h3>
            <Cover song={song} size={120} className="meta-current-art" />
            <dl className="meta-fields">
              <dt>Title</dt>
              <dd>{song.title}</dd>
              <dt>Artist</dt>
              <dd>{text(song.artist)}</dd>
              <dt>Album</dt>
              <dd>{text(song.album)}</dd>
              <dt>Album artist</dt>
              <dd>{text(song.albumArtist)}</dd>
              <dt>Year</dt>
              <dd>{text(song.year)}</dd>
              <dt>Track №</dt>
              <dd>{text(song.trackNo)}</dd>
              <dt>Length</dt>
              <dd>{song.duration ? formatDuration(song.duration) : '—'}</dd>
            </dl>
          </section>

          <section className="meta-candidates">
            <h3 className="meta-section-title">
              Suggestions
              {lookup.isPending && <span className="spinner" />}
            </h3>

            {lookup.isError && (
              <p className="notice notice-error">Couldn’t reach the lookup services.</p>
            )}

            {lookup.isSuccess && candidates.length === 0 && (
              <p className="empty-hint">
                Nothing matched on iTunes or MusicBrainz. Try correcting the title or artist by hand
                first — the lookup uses them as the search.
              </p>
            )}

            {candidates.length > 0 && (
              <div className="meta-list" role="radiogroup" aria-label="Candidates">
                {candidates.map((candidate, index) => (
                  <button
                    type="button"
                    key={`${candidate.source}-${index}`}
                    role="radio"
                    aria-checked={index === selectedIndex}
                    className={`meta-candidate ${index === selectedIndex ? 'is-active' : ''}`}
                    onClick={() => setSelectedIndex(index)}
                  >
                    <CandidateArt url={candidate.artworkUrl} />
                    <span className="meta-candidate-main">
                      <span className="meta-candidate-title">{candidate.title}</span>
                      <span className="meta-candidate-sub">
                        {candidate.artist || 'Unknown artist'}
                        {candidate.album && ` · ${candidate.album}`}
                        {candidate.year && ` · ${candidate.year}`}
                        {candidate.durationSec && ` · ${formatDuration(candidate.durationSec)}`}
                      </span>
                    </span>
                    <span className="meta-candidate-meta">
                      <span className={`badge meta-source meta-source-${candidate.source}`}>
                        {SOURCE_LABELS[candidate.source]}
                      </span>
                      <span className="meta-score" title="Match confidence">
                        {Math.round(candidate.score * 100)}%
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}

            {selected && (
              <div className="meta-diff">
                {diffs.length === 0 ? (
                  <p className="hint">This suggestion matches what you already have.</p>
                ) : (
                  diffs.map(diff => (
                    <button
                      type="button"
                      key={diff.field}
                      role="checkbox"
                      aria-checked={ticked.has(diff.field)}
                      aria-label={`Apply ${FIELD_LABELS[diff.field].toLowerCase()}`}
                      className="meta-diff-row"
                      onClick={() => toggle(diff.field)}
                    >
                      <span className={`checkbox ${ticked.has(diff.field) ? 'is-on' : ''}`}>
                        {ticked.has(diff.field) && <Check size={12} />}
                      </span>
                      <span className="meta-diff-label">{FIELD_LABELS[diff.field]}</span>
                      <span className="meta-diff-values">
                        {diff.current !== '—' && <s className="meta-diff-old">{diff.current}</s>}
                        <span className="meta-diff-new">{diff.proposed}</span>
                      </span>
                    </button>
                  ))
                )}
              </div>
            )}
          </section>
        </div>

        <footer className="meta-foot">
          {apply.isError && <span className="hint meta-error">{apply.error.message}</span>}
          {apply.data && !apply.data.artworkSaved && (
            <span className="hint meta-error">
              Fields saved, but the artwork couldn’t be fetched.
            </span>
          )}
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="button button-primary"
            disabled={applyCount === 0 || apply.isPending}
            onClick={submit}
          >
            <Check size={15} />
            {apply.isPending
              ? 'Applying…'
              : applyCount === 0
                ? 'Apply'
                : `Apply ${applyCount} ${applyCount === 1 ? 'change' : 'changes'}`}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  )
}

/** A thumbnail that quietly disappears when the remote image is missing. */
function CandidateArt({ url }: { url: string | undefined }) {
  const [failed, setFailed] = useState(false)
  if (!url || failed) return <span className="meta-candidate-art meta-candidate-art-empty" />
  return (
    <img
      className="meta-candidate-art"
      src={url}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  )
}
