import { useEffect, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import { useLibrary } from '@selfmp3/client'
import { coverFor } from '../../offline/covers'
import { usePlayer, usePlayerProgress } from '../../player/PlayerProvider'
import { hasWidget, sendWidgetSnapshot, widgetCover } from '../../ports/widget'
import { homeTiles } from '../home/home.model'
import { snapshotChanged, WIDGET_TILES, widgetSnapshot, type WidgetSnapshot } from './widget.model'

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

  // Home's tags, in Home's order (`homeTiles`): the widget follows what Home
  // recommends rather than a choice of its own. Null while the library is on
  // its way, so no tag-less snapshot is sent first.
  const tiles = useMemo(
    () => (library ? homeTiles(library.tags, library.songs, WIDGET_TILES) : null),
    [library],
  )

  useEffect(() => {
    // Before the library arrives there is nothing true to say about the tags,
    // and a snapshot without them reads "Tag a few songs" on the home screen.
    if (!tiles) return
    // The covers this snapshot draws. Only they stay read: each is the whole
    // picture as text, and keeping every one since launch kept a long
    // session's every song's.
    const used = new Set<string>()
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
        used.add(uri)
        const known = covers.current.get(uri)
        if (known !== undefined) return known
        const read = widgetCover(uri)
        covers.current.set(uri, read)
        return read
      },
    })
    for (const uri of covers.current.keys()) if (!used.has(uri)) covers.current.delete(uri)
    if (!snapshotChanged(sent.current, snapshot)) return
    sent.current = snapshot
    sendWidgetSnapshot(snapshot)
  }, [tiles, current, isPlaying, position, duration])

  return null
}
