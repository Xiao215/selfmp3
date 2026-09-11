import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Song } from '@selfmp3/shared'
import { Check, Trash, X } from './Icons.js'

/**
 * The confirmation for removing a selection from the library.
 *
 * The per-song menu already treats "remove from my list" and "destroy the
 * file" as two different intentions that must never be one mis-tap apart.
 * At forty songs that distinction stops being a nicety: deleting the files is
 * not undoable and the confirmation has to say so in as many words, with the
 * count in the sentence, and it has to look different depending on which of
 * the two is actually about to happen.
 *
 * So this is one dialog with two faces. Untouched it removes rows and leaves
 * every file where it is; ticking the box turns it red, rewrites the heading,
 * the body and the button, and only then can it delete anything from disk.
 */
export function ConfirmRemoveSongs({
  songs,
  onCancel,
  onConfirm,
  pending = false,
}: {
  songs: readonly Song[]
  onCancel: () => void
  onConfirm: (deleteFile: boolean) => void
  pending?: boolean
}) {
  const [deleteFile, setDeleteFile] = useState(false)
  const cancelRef = useRef<HTMLButtonElement>(null)

  // Focus lands on Cancel, never on the destructive button: a stray Enter
  // arriving from whatever opened this must not delete anything.
  useEffect(() => {
    cancelRef.current?.focus()
  }, [])

  const count = songs.length
  const songWord = count === 1 ? 'song' : 'songs'
  const fileWord = count === 1 ? 'file' : 'files'

  const named = songs.slice(0, 3).map(song => song.title)
  const rest = count - named.length

  return createPortal(
    <div className="confirm-backdrop" onClick={pending ? undefined : onCancel}>
      <div
        className={`confirm-dialog ${deleteFile ? 'is-destructive' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-remove-title"
        onClick={event => event.stopPropagation()}
        onKeyDown={event => {
          if (event.key === 'Escape' && !pending) {
            event.stopPropagation()
            onCancel()
          }
        }}
      >
        <header className="confirm-head">
          <h2 id="confirm-remove-title">
            {deleteFile
              ? `Delete ${count} ${fileWord} from disk?`
              : `Remove ${count} ${songWord} from your library?`}
          </h2>
          <button
            type="button"
            className="icon-button"
            onClick={onCancel}
            aria-label="Cancel"
            disabled={pending}
          >
            <X size={16} />
          </button>
        </header>

        <div className="confirm-body">
          <p className="confirm-lede">
            {deleteFile ? (
              <>
                The {count === 1 ? 'audio file is' : `${count} audio files are`} deleted from disk
                and removed from your library. <strong>This cannot be undone.</strong>
              </>
            ) : (
              <>
                The {count === 1 ? 'song' : `${count} songs`} and everything about{' '}
                {count === 1 ? 'it' : 'them'} — tags, play counts, playlist places — leave your
                library. <strong>The audio files stay where they are</strong>, so a rescan finds{' '}
                {count === 1 ? 'it' : 'them'} again.
              </>
            )}
          </p>

          <ul className="confirm-list">
            {named.map((title, index) => (
              <li key={`${title}-${index}`}>{title}</li>
            ))}
            {rest > 0 && (
              <li className="confirm-list-rest">
                and {rest} more {rest === 1 ? 'song' : 'songs'}
              </li>
            )}
          </ul>

          {/*
            A deliberately separate act, in its own bordered block rather than
            as one more line of the paragraph above — the two outcomes are not
            degrees of the same thing.
          */}
          <button
            type="button"
            className={`confirm-file-choice ${deleteFile ? 'is-on' : ''}`}
            role="checkbox"
            aria-checked={deleteFile}
            onClick={() => setDeleteFile(value => !value)}
            disabled={pending}
          >
            <span className={`checkbox ${deleteFile ? 'is-on' : ''}`} aria-hidden="true">
              {deleteFile && <Check size={12} />}
            </span>
            <span className="confirm-file-copy">
              <span className="confirm-file-title">
                Also delete the {count === 1 ? 'audio file' : `${count} audio files`} from disk
              </span>
              <span className="confirm-file-hint">
                {deleteFile
                  ? 'Permanent. There is no undo and nothing goes to a trash folder.'
                  : 'Off: your files are left untouched.'}
              </span>
            </span>
          </button>
        </div>

        <footer className="confirm-actions">
          <button
            ref={cancelRef}
            type="button"
            className="button"
            onClick={onCancel}
            disabled={pending}
          >
            Cancel
          </button>
          <button
            type="button"
            className={`button ${deleteFile ? 'button-danger' : 'button-primary'}`}
            onClick={() => onConfirm(deleteFile)}
            disabled={pending}
          >
            <Trash size={15} />
            {pending
              ? 'Working…'
              : deleteFile
                ? `Delete ${count} ${fileWord}`
                : `Remove ${count} ${songWord}`}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  )
}
