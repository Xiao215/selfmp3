/**
 * What can be done to songs, with nothing drawn: the song's ⋯ menu and the
 * selection bar's More both ask this, so one song and a hundred are offered
 * the same things, in the same order, by the same names.
 *
 * The two had been written apart and fixed apart — 986c1605 found the bar's
 * Download skipping the menu's path, so songs removed by hand came straight
 * back — and their words had drifted ("Tags" and "Tags…").
 */

/**
 * The names of what is done to songs, wherever a door to it is drawn: a menu,
 * a bar, a page's button. A name with an ellipsis opens something that asks
 * for more (a window, a question) before anything happens.
 */
export const SONG_ACTION_LABELS = {
  tags: 'Tags…',
  addToPlaylist: 'Add to playlist',
  addToUpNext: 'Add to Up next',
  playNext: 'Play next',
  playSimilar: 'Play similar songs',
  share: 'Share link',
  details: 'Song details',
  removeFromPlaylist: 'Remove from this playlist',
  fixInfo: 'Fix song info…',
  selectSongs: 'Select songs',
} as const

export type SongActionId =
  | 'like'
  | 'unlike'
  | 'tags'
  | 'addToPlaylist'
  | 'addToUpNext'
  | 'playSimilar'
  | 'share'
  | 'download'
  | 'removeDownload'
  | 'details'
  | 'removeFromPlaylist'
  | 'delete'

/** The songs being acted on, and where. */
interface SongActionFacts {
  /** How many songs. */
  readonly count: number
  /** How many of them are liked. */
  readonly loved: number
  /** How many of them are kept on this device. */
  readonly held: number
  /** An installed app, which keeps songs; a browser streams and keeps none. */
  readonly installed: boolean
  /** A friend's song in a room is among them: not in your library, so nothing the library does applies. */
  readonly roomSong: boolean
  /** Opened from a playlist you made, which the songs can be taken out of. */
  readonly inPlaylist: boolean
  /** Opened on Now Playing, which shows the song's heart, tags and details itself, and is already playing it. */
  readonly nowPlaying: boolean
  /** What this device is called in "Remove from this phone". */
  readonly place: string
  /** Signed in with a bucket, which a share link lends from (docs/features/share-links.md). */
  readonly shareable: boolean
}

/** One thing to offer, by name, and the group it sits in: groups are set apart by room. */
export interface SongAction {
  readonly id: SongActionId
  readonly label: string
  readonly group: 'love' | 'song' | 'list' | 'remove'
}

/**
 * What to offer for these songs, in order. One song's heart is the menu's
 * head, so Like is offered only to several; one song's own page and similar
 * songs only to one.
 */
export function songActions(facts: SongActionFacts): readonly SongAction[] {
  const { count, loved, held } = facts
  if (count === 0) return []
  // A room's song gets only the page's own doors, which are not these.
  if (facts.roomSong) return []
  const many = count > 1
  const actions: SongAction[] = []
  const add = (id: SongActionId, label: string, group: SongAction['group']): void => {
    actions.push({ id, label, group })
  }

  if (many && loved < count) add('like', `Like ${loved === 0 ? 'all' : 'the rest'}`, 'love')
  if (many && loved > 0) add('unlike', `Unlike ${loved === count ? 'all' : loved}`, 'love')

  if (!facts.nowPlaying) add('tags', SONG_ACTION_LABELS.tags, 'song')
  add('addToPlaylist', SONG_ACTION_LABELS.addToPlaylist, 'song')
  // The song playing is already in Up next.
  if (!facts.nowPlaying) add('addToUpNext', SONG_ACTION_LABELS.addToUpNext, 'song')
  if (!many) add('playSimilar', SONG_ACTION_LABELS.playSimilar, 'song')
  if (facts.shareable) add('share', SONG_ACTION_LABELS.share, 'song')
  // A browser streams; only an installed app keeps songs.
  if (facts.installed && held < count) {
    add('download', many ? `Download ${held > 0 ? 'the rest' : 'all'}` : 'Download', 'song')
  }
  if (facts.installed && held > 0) {
    add(
      'removeDownload',
      `Remove ${held < count ? `${held} ` : ''}from this ${facts.place}`,
      'song',
    )
  }
  if (!many && !facts.nowPlaying) add('details', SONG_ACTION_LABELS.details, 'song')

  if (facts.inPlaylist) add('removeFromPlaylist', SONG_ACTION_LABELS.removeFromPlaylist, 'list')

  add('delete', many ? `Delete ${count} songs from library…` : 'Delete from library…', 'remove')
  return actions
}
