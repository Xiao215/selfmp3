import { useCallback, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { lyricTextLines, type ShareLine, type Song } from '@selfmp3/shared'
import { iconSize, isRoomTrackId } from '@selfmp3/client'
import { useConnection } from '../../connection/ConnectionProvider'
import { usePlayerCommands, usePlayerPlaying } from '../../player/PlayerProvider'
import { copyText } from '../../ports/clipboard'
import type { PopoverAnchor } from '../../ui/rightClick'
import { showToast } from '../../ui/toast'
import { Copy, Play, ShareOut } from '../../ui/components/Icons'
import { Menu, type MenuItem } from '../../ui/components/MoreMenu'
import { openShareSheet } from '../share/shareSheet.store'
import type { SongWords } from './nowPlaying.model'

/**
 * A line of Now Playing's words, held on a phone or right-clicked on a
 * computer (docs/features/share-links.md, "Sharing from a line"): Share from
 * here, Play from here, Copy line. Share from here is the song's own Share
 * link, starting at the line: the same link as sharing the song, and its
 * address says where (`?t=0:42`). The line goes with it, and its romaji or
 * pinyin when that is on here, so the friend's page shows the line as it was
 * read.
 *
 * Only timed lines open it (`StageLyrics`); a music break offers Play from
 * here alone. A room's song, lent and not in the library, cannot be shared.
 */
export function useLineMenu(
  song: Song | null,
  words: SongWords,
): {
  onLineMenu: ((index: number, at: PopoverAnchor | null) => void) | undefined
  menu: ReactNode
} {
  const player = usePlayerCommands()
  const playing = usePlayerPlaying()
  const { fromCloud, needsStorage } = useConnection()
  const [open, setOpen] = useState<{ index: number; at: PopoverAnchor | null } | null>(null)
  const anchor = useRef<PopoverAnchor | null>(null)

  const parsed = words.status === 'lyrics' ? words.parsed : null
  const synced = parsed?.synced ? parsed.lines : null
  const onLineMenu = useCallback((index: number, at: PopoverAnchor | null) => {
    anchor.current = at
    setOpen({ index, at })
  }, [])

  const index = open?.index ?? -1
  const time = synced?.[index]?.time
  const text = parsed ? (lyricTextLines(parsed)[index] ?? '').trim() : ''
  const reading = (words.status === 'lyrics' ? words.roman?.[index] : undefined)?.trim() || null
  const shareable = song !== null && fromCloud && !needsStorage && !isRoomTrackId(song.id)

  const items: MenuItem[] =
    song && time !== undefined
      ? [
          ...(text && shareable
            ? [
                {
                  key: 'share',
                  label: 'Share from here',
                  icon: <ShareOut size={iconSize.item} tone="textSecondary" />,
                  testID: 'lyric-line-share',
                  onPress: () => {
                    const line: ShareLine = { at: Math.floor(time), text, reading }
                    openShareSheet({ songIds: [song.id], name: song.title, kind: 'song', line })
                  },
                },
              ]
            : []),
          {
            key: 'play',
            label: 'Play from here',
            icon: <Play size={iconSize.item} tone="textSecondary" />,
            testID: 'lyric-line-play',
            onPress: () => {
              player.seekTo(time)
              if (!playing) player.toggle()
            },
          },
          ...(text
            ? [
                {
                  key: 'copy',
                  label: 'Copy line',
                  icon: <Copy size={iconSize.item} tone="textSecondary" />,
                  testID: 'lyric-line-copy',
                  onPress: () =>
                    void copyText(text).then(done =>
                      showToast(
                        done ? 'Line copied' : 'Couldn’t copy the line',
                        done ? 'good' : 'error',
                      ),
                    ),
                },
              ]
            : []),
        ]
      : []

  const menu = (
    <Menu
      open={open !== null && items.length > 0}
      onClose={() => setOpen(null)}
      // Held, there is no point to hang it off: a sheet, titled with the line.
      anchorRef={open?.at ? anchor : undefined}
      items={items}
      title={text || song?.title}
      align="start"
      testID="lyric-line-menu"
    />
  )
  return { onLineMenu: synced && song ? onLineMenu : undefined, menu }
}
