import { useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import type { Href } from 'expo-router'
import { artistOr, formatDuration, type Song } from '@selfmp3/shared'
import { isRoomTrackId, space, type, useLibrary, iconSize } from '@selfmp3/client'
import { useOpenTag } from '../../features/tag/useOpenTag'
import { useArt } from '../../offline/useArt'
import { Chip } from './Chip'
import { RemoveSongs } from './ConfirmRemoveSongs'
import { Cover } from './Cover'
import { LikeButton } from './LikeButton'
import { Devices, Moon } from './Icons'
import { Popover } from './Popover'
import { SheetItem } from './Sheet'
import { SongActionItems } from './SongActionItems'
import { useSleepTimerStatus } from './SleepMenu'
import { TagPicker } from './TagPicker'
import type { PopoverAnchor } from '../rightClick'

/**
 * The phone's Now Playing ends its menu with a short "This player" group — the
 * sleep timer and the devices — because the page has no other door to them. A
 * computer has both on the player bar, so its stage passes none.
 */
interface PlayerDoors {
  readonly onSleep: () => void
  readonly onDevices: () => void
}

/**
 * The ⋯ menu for a song (docs/ui-mock `P14`): the one song menu, the same
 * items in the same order wherever a song is — a row's ⋯, a held row, a
 * right-click, Now Playing's ⋯ on a phone or a computer. People learn one
 * menu and find it everywhere.
 *
 * Opened on Now Playing (`context="nowPlaying"`), on a phone or a computer
 * alike, it leaves out what that page already shows — the heart, the tags,
 * Tags and Song details — and Add to Up next, since the song is playing.
 *
 * A friend's song in a room (`isRoomTrackId`) is not in your library: it
 * cannot be liked, tagged, listed, kept, looked up or deleted, so the menu
 * offers none of that, only the page's own doors when it has them.
 *
 * At phone width this is a row's only set of actions, so everything a row can
 * do has to be reachable from here, tagging included. The song heads it —
 * cover, title, its tags and its heart — so a menu opened by holding a row
 * still says which row it came from. Then what is done to the song, what it
 * is, what it is to the list it was opened from (a playlist you made), and
 * last, removing it.
 *
 * Kept short on purpose. Play next lives on the song's own page, which "Song
 * details" opens; selecting starts from a held row on a phone and from the
 * row's checkbox on a computer, so the menu does not offer it either. Fixing
 * the metadata is a button on the song's page, beside the facts it changes.
 *
 * Destructive actions sit last and apart, and removing always asks first.
 * Removing has one meaning on every device — the song leaves the library
 * everywhere, and the download here goes with it — so it asks once and does
 * that. The question is the selection bar's dialog, not a second state of the
 * menu: the menu closes, and one press in a dialog answers it. Asked inside
 * the menu, the same popup would take two presses, and the second would land
 * where the first had been.
 *
 * Dropping the download on its own is "Remove from this phone", in Download's
 * place once the song is kept here: keeping the song and freeing the room is a
 * different wish.
 */
export function SongMenu({
  song,
  onClose,
  anchorRef,
  playlist,
  context,
  extras,
  onRemove,
  onOpen,
}: {
  song: Song | null
  onClose: () => void
  /**
   * Opened from a playlist you made: the menu offers taking the song out of
   * it, which on a phone is the only way to — its rows have no ✕.
   */
  playlist?: { readonly id: number; readonly name: string }
  /**
   * The ⋯ that opened it, or the point a right-click landed on. At desktop
   * width the menu hangs off it; without one it is a sheet.
   */
  anchorRef?: RefObject<PopoverAnchor | null>
  /** Opened on Now Playing, which shows the song's heart, tags and details itself. */
  context?: 'nowPlaying'
  /** The phone's Now Playing: its sleep timer and devices, last. */
  extras?: PlayerDoors
  /**
   * Who asks about removing, when the question has to outlive the page the
   * menu is on: removing the song playing takes the phone's Now Playing away
   * with it. Left out, the menu asks itself.
   */
  onRemove?: (song: Song) => void
  /**
   * Going to a page from the menu — a tag's, the song's own. Left out, the
   * router goes there; the phone's Now Playing is a modal over the app, and
   * puts itself away first (`leaveTo`).
   */
  onOpen?: (href: Href) => void
}): ReactNode {
  const { data: library } = useLibrary()
  const [tagging, setTagging] = useState<number | null>(null)
  const [removing, setRemoving] = useState<Song | null>(null)
  // The song as the library has it now, so the picker shows the tags after a change.
  const taggingSong =
    tagging === null ? null : (library?.songs.find(item => item.id === tagging) ?? null)

  const items = song ? (
    <Items
      song={song}
      onClose={onClose}
      playlist={playlist}
      anchorRef={anchorRef}
      onNowPlaying={context === 'nowPlaying'}
      extras={extras}
      onOpen={onOpen}
      onTags={() => setTagging(song.id)}
      onRemove={() => {
        if (onRemove) onRemove(song)
        else setRemoving(song)
      }}
    />
  ) : null

  return (
    <>
      <Popover
        open={song !== null}
        onClose={onClose}
        anchorRef={anchorRef}
        width={300}
        testID="song-menu"
      >
        {items}
      </Popover>

      {/* Where the menu was: over the same ⋯, not in the middle of the window. */}
      <TagPicker song={taggingSong} onClose={() => setTagging(null)} anchorRef={anchorRef} />
      {removing ? (
        <RemoveSongs
          songs={[removing]}
          onCancel={() => setRemoving(null)}
          onDone={() => setRemoving(null)}
        />
      ) : null}
    </>
  )
}

function Items({
  song: given,
  onClose,
  onTags,
  onRemove,
  playlist,
  anchorRef,
  onNowPlaying,
  extras,
  onOpen,
}: {
  song: Song
  onClose: () => void
  onTags: () => void
  /** Removing asks in a dialog of its own, which outlives the menu. */
  onRemove: () => void
  playlist?: { readonly id: number; readonly name: string }
  /** The ⋯ that opened the menu, where a song sent to Up next flies from. */
  anchorRef?: RefObject<PopoverAnchor | null>
  onNowPlaying: boolean
  extras?: PlayerDoors
  onOpen?: (href: Href) => void
}): ReactNode {
  const openTag = useOpenTag()
  const artFor = useArt()
  const { data: library } = useLibrary()

  // The heart and the tags as they are now, not as they were when the menu opened.
  const song = library?.songs.find(item => item.id === given.id) ?? given
  const tags = (library?.tags ?? []).filter(tag => song.tagIds.includes(tag.id))
  const byline = [artistOr(song.artist), song.duration > 0 ? formatDuration(song.duration) : '']
    .filter(Boolean)
    .join(' · ')

  // What the page it was opened on already shows, or what a room's song cannot have.
  const showsOwn = onNowPlaying || isRoomTrackId(song.id)

  const then = (run: () => void) => (): void => {
    run()
    onClose()
  }

  return (
    <>
      <View style={styles.head}>
        <Cover uri={artFor(song)} title={song.album || song.title} size={56} />
        <View style={styles.titles}>
          <Text style={styles.title} numberOfLines={1}>
            {song.title}
          </Text>
          <Text style={styles.byline} numberOfLines={1}>
            {byline}
          </Text>
          {tags.length > 0 && !showsOwn ? (
            <View style={styles.tags}>
              {tags.map(tag => (
                <Chip
                  key={tag.id}
                  label={tag.name}
                  hue={tag.hue}
                  selected={false}
                  compact
                  onPress={then(() => openTag(tag, { go: onOpen }))}
                />
              ))}
            </View>
          ) : null}
        </View>
        {showsOwn ? null : <LikeButton song={song} filled size={44} />}
      </View>

      {/* What is done to the song, what it is to the list it was opened
          from, and last, removing it: the same items the selection bar's
          More offers for many songs. */}
      <SongActionItems
        songs={[song]}
        playlist={playlist}
        nowPlaying={onNowPlaying}
        flyFrom={anchorRef}
        onClose={onClose}
        onTags={onTags}
        onDelete={onRemove}
        onOpen={onOpen}
        beforeRemove={
          extras ? (
            <>
              <Text style={styles.group}>This player</Text>
              <SleepItem
                icon={<Moon size={iconSize.item} tone="textSecondary" />}
                onPress={then(extras.onSleep)}
              />
              <SheetItem
                icon={<Devices tone="textSecondary" />}
                label="Devices"
                onPress={then(extras.onDevices)}
              />
            </>
          ) : undefined
        }
      />
    </>
  )
}

/**
 * The sleep timer's row, saying how long is left; its own component so only
 * a menu that shows it ticks with the timer.
 */
function SleepItem({ icon, onPress }: { icon: ReactNode; onPress: () => void }): ReactNode {
  const { left } = useSleepTimerStatus()
  return (
    <SheetItem
      icon={icon}
      label="Sleep timer"
      detail={left ?? 'Off'}
      active={left !== null}
      onPress={onPress}
    />
  )
}

const styles = StyleSheet.create(theme => ({
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.roomy,
    paddingHorizontal: space.xs,
    paddingTop: space.xs,
    paddingBottom: space.md,
  },
  titles: { flex: 1, minWidth: 0, gap: 3 },
  title: { color: theme.colors.textPrimary, fontSize: type.title, fontWeight: '600' },
  byline: { color: theme.colors.textSecondary, fontSize: type.sub },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginTop: space.xs },
  /* A group's name, quiet, as a sheet's label title is. */
  group: {
    color: theme.colors.textMuted,
    fontSize: type.small,
    paddingHorizontal: space.md,
    paddingTop: space.md,
    paddingBottom: space.xs,
  },
}))
