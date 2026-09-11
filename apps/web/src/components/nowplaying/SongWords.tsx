import type { Song } from '@selfmp3/shared'
import { usePatchSong } from '../../lib/queries.js'
import { LyricsSyncEditor } from '../LyricsSyncEditor.js'
import { LyricsView } from './LyricsView.js'
import { SongVisual, useVisualKind, VisualPicker } from './SongVisual.js'
import type { useSongLyrics } from './useSongLyrics.js'

/**
 * Whatever a song has to show where its words go.
 *
 * Lyrics when there are some. Otherwise the song's visual, with one quiet
 * line under it saying why: an instrumental just says so; a song whose
 * lyrics were not found offers to look again, to write them, or to mark it
 * instrumental so it stops asking. A song never opens onto an empty page.
 *
 * Double-clicking the lyrics or the visual toggles Focus, wherever this is
 * shown with a Focus to go to.
 */
export function SongWords({
  song,
  lyrics,
  mode,
  syncing,
  onSyncingChange,
  onToggleFocus,
}: {
  song: Song
  lyrics: ReturnType<typeof useSongLyrics>
  mode: 'stage' | 'focus' | 'phone'
  syncing: boolean
  onSyncingChange: (syncing: boolean) => void
  onToggleFocus?: () => void
}) {
  const visual = useVisualKind(song)
  const patchSong = usePatchSong()
  const { words } = lyrics

  if (syncing) {
    return (
      <div className={`song-words is-${mode} is-syncing`}>
        <LyricsSyncEditor
          key={song.id}
          song={song}
          initialText={words.status === 'lyrics' ? words.data.text : ''}
          onDone={() => onSyncingChange(false)}
        />
      </div>
    )
  }

  if (words.status === 'loading') {
    return (
      <div className={`song-words is-${mode}`}>
        <p className="song-words-loading">
          <span className="spinner" /> Looking for lyrics…
        </p>
      </div>
    )
  }

  if (words.status === 'lyrics') {
    return (
      <div className={`song-words is-${mode}`}>
        <LyricsView
          parsed={words.parsed}
          roman={words.roman}
          mode={mode}
          onDoubleClick={onToggleFocus}
          onSync={() => onSyncingChange(true)}
        />
      </div>
    )
  }

  return (
    <div className={`song-words is-${mode} has-visual`}>
      <SongVisual
        song={song}
        kind={visual.kind}
        className="song-words-visual"
        onDoubleClick={onToggleFocus}
      />
      <div className="song-words-status">
        {words.status === 'instrumental' ? (
          <span className="song-words-reason">
            <strong>Instrumental</strong>
          </span>
        ) : words.offline ? (
          <span className="song-words-reason">
            Lyrics need your library — reconnect to look them up
          </span>
        ) : (
          <span className="song-words-reason">
            No lyrics found
            <span className="song-words-actions">
              <button
                type="button"
                className="link-button"
                onClick={() => void lyrics.refresh()}
                disabled={lyrics.refreshing}
              >
                {lyrics.refreshing ? 'Looking…' : 'Look again'}
              </button>
              <button type="button" className="link-button" onClick={() => onSyncingChange(true)}>
                Write them
              </button>
              <button
                type="button"
                className="link-button"
                onClick={() => patchSong.mutate({ id: song.id, patch: { instrumental: true } })}
              >
                It’s instrumental
              </button>
            </span>
          </span>
        )}
        <span className="song-words-sep" aria-hidden="true">
          ·
        </span>
        <VisualPicker song={song} visual={visual} />
      </div>
    </div>
  )
}
