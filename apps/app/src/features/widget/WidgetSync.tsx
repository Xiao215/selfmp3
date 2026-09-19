import { useEffect, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import { useLibrary } from '@selfmp3/client'
import { coverFor } from '../../offline/covers'
import { usePlayer, usePlayerProgress } from '../../player/PlayerProvider'
import { hasWidget, sendWidgetSnapshot, widgetCover } from '../../ports/widget'
import { HOME_TILES, homeTiles } from '../home/home.model'
import { snapshotChanged, widgetSnapshot, type WidgetSnapshot } from './widget.model'

/**
 * Keeps the home-screen widget in step with the app (docs/ui-mock `P28`):
 * Home's first four tags, and what is playing. Draws nothing.
 *
 * A component of its own, mounted once in the shell, because it reads the
 * playhead, which moves every second: only this redraws for it, and it sends
 * the widget something only when the snapshot has news (`snapshotChanged`).
 * Where there is no widget it does no work at all.
 */
export function WidgetSync(): ReactNode {
  return hasWidget ? <Sync /> : null
}

function Sync(): ReactNode {
  const { data: library } = useLibrary()
  const { current, isPlaying } = usePlayer()
  const { position, duration } = usePlayerProgress()
  const sent = useRef<WidgetSnapshot | null>(null)
  // Each cover read once per file, not once a second as the playhead moves.
  const covers = useRef(new Map<string, string>())

  const tiles = useMemo(
    () => (library ? homeTiles(library.tags, library.songs, HOME_TILES) : []),
    [library],
  )

  useEffect(() => {
    const snapshot = widgetSnapshot({
      tiles,
      current,
      playing: isPlaying,
      position,
      duration,
      now: Date.now(),
      coverOf: song => {
        const uri = coverFor(song.id)
        if (!uri) return ''
        const known = covers.current.get(uri)
        if (known !== undefined) return known
        const read = widgetCover(uri)
        covers.current.set(uri, read)
        return read
      },
    })
    if (!snapshotChanged(sent.current, snapshot)) return
    sent.current = snapshot
    sendWidgetSnapshot(snapshot)
  }, [tiles, current, isPlaying, position, duration])

  return null
}
