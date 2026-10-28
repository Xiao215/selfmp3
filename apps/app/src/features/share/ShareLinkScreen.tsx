import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Image,
  Linking,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useLocalSearchParams, useRouter } from 'expo-router'
import {
  DoormanError,
  formatLongDuration,
  hasColour,
  plural,
  type CoverTone,
  RoomMemberNameSchema,
  ShareIdSchema,
  ShareKeySchema,
  type ShareLink,
} from '@selfmp3/shared'
import {
  neutralWash,
  radius,
  roomTrackId,
  roomTrackSong,
  space,
  type,
  withAlpha,
  yoursOf,
} from '@selfmp3/client'
import { useConnection } from '../../connection/ConnectionProvider'
import { usePlayerCommands, usePlayerPlaying, usePlayingSongId } from '../../player/PlayerProvider'
import { setTrackSource } from '../../player/roomTracks'
import { prefs } from '../../ports/prefs'
import { ChromeSpacer } from '../../shell/ChromeSpacer'
import { useLayout } from '../../shell/useLayout'
import { artShadow, heroTitle, lineSub } from '../../ui/surfaces'
import { useAccent } from '../../ui/accent'
import { showToast } from '../../ui/toast'
import { useSongColor } from '../../ui/useSongColor'
import { useShownScheme } from '../../ui/theme/unistyles'
import { backdropVeil } from '../nowPlaying/nowPlaying.model'
import { BackButton } from '../../ui/components/BackButton'
import { BrandMark } from '../../ui/components/BrandMark'
import { Button } from '../../ui/components/Button'
import { PageLoading } from '../../ui/components/PageLoading'
import { Press } from '../../ui/components/Press'
import { SafeAreaView } from '../../ui/components/SafeAreaView'
import { ScrollView } from '../../ui/components/Scroll'
import { TextField } from '../../ui/components/TextField'
import { useLibraryIndex } from '../../ui/songsById'
import { RoomEntryLine } from '../room/RoomEntryLine'
import { FacesCover, RoomFace } from '../room/RoomFace'
import { GUEST_NAME_KEY } from '../room/room.model'
import { sayRoomFailure } from '../room/roomFailure'
import { useGetSongs } from '../room/useGetSongs'
import { GoneLink } from './GoneLink'
import {
  gettable,
  shareHeadLine,
  shareStage,
  shareStartOf,
  shareTracks,
  sourceName,
} from './share.model'
import { ShareSong, SongStill, useShareStage } from './ShareSong'
import { CoverRail, listSummary, RAIL_WIDTH, UpNext } from './ShareRail'
import { shareApi, useShareAct, useShareAsk, useShareLink } from './shareLinks'
import { useLentWords } from './useLentWords'
import { useMinute } from './useMinute'
import { useOwnCover } from './useOwnCover'

/** The links this device asked for again while signed out: a guest's ask is remembered here. */
const ASKED_KEY = 'share.asked'

/** The page's column at its widest, on a computer. */
const PAGE_WIDTH = 520

/**
 * How many of a list's songs the page draws at first, and how many more each
 * time its foot comes near: a link holds every song of a tag, a thousand or
 * more, and only the rows drawn read their covers from its sender's bucket.
 */
const ROWS_AT_ONCE = 60

function askedHere(id: string): boolean {
  return (prefs.get(ASKED_KEY) ?? '').split(',').includes(id)
}

function rememberAsked(id: string): void {
  const kept = (prefs.get(ASKED_KEY) ?? '').split(',').filter(Boolean)
  prefs.set(ASKED_KEY, [...kept.filter(other => other !== id), id].slice(-50).join(','))
}

/**
 * `/l/<id>/<key>`: a share link (docs/features/share-links.md, mocks C1, D1,
 * E1). Opens in any browser without signing in, and in the app signed in,
 * where it is remembered on Home's From friends. While it lasts, it plays
 * from its sender's bucket; on its last day it says so and Get it leads; once
 * it has ended the card stays, faded, with the ways on: Get it, the place it
 * came from, and asking its sender again.
 */
export function ShareLinkScreen(): ReactNode {
  const params = useLocalSearchParams<{ id: string; key: string; s?: string; t?: string }>()
  const id = ShareIdSchema.safeParse(params.id ?? '').success ? (params.id ?? null) : null
  const key = ShareKeySchema.safeParse(params.key ?? '').success ? (params.key ?? null) : null
  const { status } = useConnection()
  const { data: link, isLoading, error } = useShareLink(id, key)

  if (!link) {
    if (isLoading || (status === 'loading' && id && key)) {
      return (
        <SafeAreaView style={styles.screen} edges={['top']}>
          <PageLoading />
        </SafeAreaView>
      )
    }
    const wrongKey = !key || (error instanceof DoormanError && error.status === 403)
    return <GoneLink torn={!id || wrongKey} signedIn={status === 'ready'} />
  }
  return <LinkPage link={link} s={params.s} t={params.t} />
}

/**
 * The link itself (F1 and F2 of the page's proposal): on its cover's colour,
 * its sender and how long it has at the top. A song that still plays is Now
 * Playing's own page (`ShareSong`): the stage on a computer, the phone's page
 * on a phone. A list, or a song that has ended, is one column: its covers,
 * its name, Play, and the ways on. Shared from a line (`?t=0:42`), its song
 * starts there, and the page shows the line. A list opens on the song its
 * address names (`?s=<entry>`), and the address follows the page's song, so
 * a copied address opens where it was.
 */
function LinkPage({
  link,
  s,
  t,
}: {
  link: ShareLink
  s: string | undefined
  t: string | undefined
}): ReactNode {
  const router = useRouter()
  const { theme } = useUnistyles()
  const { status } = useConnection()
  const signedIn = status === 'ready'
  const player = usePlayerCommands()
  const playing = usePlayingSongId()
  const sounding = usePlayerPlaying()
  const index = useLibraryIndex()
  // The clock moves on while the page is open: the last day, and the end, arrive by themselves.
  const now = useMinute()
  const stage = shareStage(link, now)
  const ended = stage === 'ended'
  const getSongs = useGetSongs({ enabled: signedIn && !link.yours })
  const { wide, width } = useLayout()
  const ownCover = useOwnCover()
  const accent = useAccent()

  // Its songs as tracks, for their covers now and for playing them; kept
  // while anything plays them, so they are not taken from under the player,
  // as a shared playlist's are. Built again when the link ends, not with
  // every minute the clock moves on.
  useEffect(() => {
    setTrackSource(
      `share:${link.id}`,
      shareTracks(link, (entryId, part) => shareApi.fileUrl(link, entryId, part), index, !ended),
    )
  }, [link, index, ended])

  const entries = link.entries.filter(entry => !entry.gone)
  const ids = entries.map(entry => roomTrackId(entry.id))
  // Where each song plays from in `ids`, found once rather than searched for per row.
  const playsAt = new Map(entries.map((entry, at) => [entry.id, at]))
  const [rows, setRows] = useState(ROWS_AT_ONCE)
  const moreRows = link.kind === 'list' && rows < link.entries.length
  const drawMore = (event: NativeSyntheticEvent<NativeScrollEvent>): void => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent
    if (contentOffset.y + layoutMeasurement.height * 2 >= contentSize.height) {
      setRows(shown => shown + ROWS_AT_ONCE)
    }
  }
  const first = link.entries[0]
  const firstId = first ? roomTrackId(first.id) : 0
  // A list's song the page is about (R1, C): the one playing, or before
  // that the one cued, the address's until another is picked, else the
  // first. A song's, its one.
  const trackAt = new Map(ids.map((id, at) => [id, at]))
  const playingAt = link.kind === 'list' && playing !== null ? trackAt.get(playing) : undefined
  const [cued, setCued] = useState(() =>
    Math.max(
      0,
      entries.findIndex(entry => entry.id === s),
    ),
  )
  // Kept on the song playing, so the page stays on it once the list stops.
  // Adjusted during render, as React has a value follow another.
  if (playingAt !== undefined && playingAt !== cued) setCued(playingAt)
  const shownAt = playingAt ?? Math.min(cued, Math.max(0, entries.length - 1))
  const shown = link.kind === 'list' && !ended ? (entries[shownAt] ?? first) : first
  const shownId = shown ? roomTrackId(shown.id) : 0
  // The address names a list's song past the first, as Now Playing's names its song.
  const named = link.kind === 'list' && !ended && shown && shownAt > 0 ? shown.id : undefined
  useEffect(() => {
    if (named !== s) router.setParams({ s: named })
  }, [named, s, router])
  // From the link itself, not the player's tracks: those are filled after this
  // first draw. Your own copy's where you have the song, as the player plays it.
  const coverOf = (entry: ShareLink['entries'][number]): string | null => {
    const lent = entry.song.cover ? shareApi.fileUrl(link, entry.id, 'cover') : null
    return ownCover(entry.song, lent) ?? lent
  }
  const cover = shown ? coverOf(shown) : null
  const toGet = gettable(link, index)
  const source = first?.song.sourceUrl ?? null
  const head = shareHeadLine(link, now)
  const loaded = playing === shownId
  const start = useMemo(() => shareStartOf(link, t), [link, t])

  // Washed in its song's cover colour, as Now Playing is; grey once it has ended.
  const lead = shown
    ? roomTrackSong({ id: shown.id, song: shown.song, addedAt: link.createdAt })
    : null
  const light = useSongColor(lead, cover, !ended)
  const tone = shown?.song.coverTone ?? null
  const wash = ended ? (tone ? neutralWash(tone) : theme.colors.surface2) : light.color
  // A cover that would not come — its sender's bucket out of reads for the
  // day — is a letter in the wash's hue: the cover's colour, which the link
  // carries, or the accent where it has none.
  const tileHue = tone && hasColour(tone) ? tone.hue : accent.hue

  // Its words: as the page opens on a computer, where they are half the page;
  // on a phone once it is loaded or its words view is opened.
  const onStage = useShareStage()
  const [wordsOpen, setWordsOpen] = useState(false)
  const lyrics = useLentWords(link, ended ? undefined : shown, onStage || loaded || wordsOpen)
  // As big as the column allows, short of pushing Play out of sight.
  const coverSide = Math.min(wide ? 360 : 340, Math.min(width, PAGE_WIDTH) - space.gutter * 2)

  const play = (at = 0): void => {
    if (ids.length === 0) return
    const id = ids[at]
    if (id !== undefined && playing === id) player.toggle()
    // Its song, from the line it was shared from: `position`, as a seek
    // straight after would land before the song has loaded.
    else if (start && at === 0) player.playFrom(ids, at, { position: start.at })
    else player.playFrom(ids, at)
  }

  // A list's song, picked from its covers. Picking never changes whether the
  // music plays, as Next does not: while it plays, the song plays; paused, the
  // list lands on it paused; before the list has played, the page moves to it.
  // The song already loaded is Play's own press: played, or paused.
  const pick = (at: number): void => {
    setCued(at)
    const id = ids[at]
    if (id === undefined) return
    if (sounding || playing === id) play(at)
    else if (playingAt !== undefined) player.playFrom(ids, at, { autoplay: false })
  }
  // Next and Previous: the player's own once it has the list, the cue's before.
  const step = (by: 1 | -1): void => {
    if (playingAt !== undefined) {
      if (by > 0) player.next()
      else player.previous()
    } else setCued(Math.min(entries.length - 1, Math.max(0, shownAt + by)))
  }
  const covers = {
    entries,
    coverOf,
    tileHue,
    shown: shownAt,
    onPick: pick,
    name: link.name,
    summary: listSummary(entries, formatLongDuration),
  }
  const list = {
    context: `${link.name} · ${shownAt + 1} of ${entries.length}`,
    onPrevious: () => step(-1),
    onNext: () => step(1),
    onShuffle: () => player.playShuffled(ids),
  }

  // The page has no sidebar, even on a computer: Back is the way into your own
  // library. Not on a list's, which is only its music (Xiao, 2026-10-26).
  const back = signedIn && (link.kind === 'song' || ended) ? <BackButton to="/" always /> : null
  const from = (
    <View style={styles.from} testID={`share-stage-${stage}`}>
      <RoomFace name={link.from.name} colour={0} picture={link.from.picture} size={28} />
      <Text style={styles.fromText} numberOfLines={2}>
        {head.from}
        {' · '}
        <Text style={stage === 'lastDay' ? styles.warn : undefined}>{head.time}</Text>
      </Text>
    </View>
  )
  const ways = (
    <Ways
      link={link}
      stage={stage}
      signedIn={signedIn}
      toGet={toGet.length}
      getting={toGet.some(entry => getSongs.getting.has(entry.song.sourceUrl ?? ''))}
      onGet={() =>
        void getSongs.get(
          toGet.map(entry => ({
            song: entry.song,
            cameWith: { kind: 'link', from: link.from.name },
          })),
        )
      }
      source={link.kind === 'song' ? source : null}
    />
  )
  // For whoever has never seen self.mp3: what it is, and the way in.
  const foot = signedIn ? null : (
    <Press
      feedback="dim"
      onPress={() => router.push('/')}
      accessibilityRole="link"
      style={styles.footer}
      testID="share-home"
    >
      <BrandMark size={16} tone="textMuted" />
      <Text style={styles.footerText}>self.mp3 · your own music library</Text>
    </Press>
  )

  return (
    <View style={styles.screen}>
      <Backdrop color={wash} art={ended ? null : cover} tone={tone} />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        {link.kind === 'song' && first && lead && !ended ? (
          <ShareSong
            song={first.song}
            track={lead}
            songId={firstId}
            cover={cover}
            tileHue={tileHue}
            lyrics={lyrics}
            lent={first.song.lyrics !== null}
            loaded={loaded}
            start={start}
            onPlay={() => play(0)}
            back={back}
            from={from}
            ways={ways}
            foot={foot}
            wordsOpen={wordsOpen}
            onWords={setWordsOpen}
          />
        ) : link.kind === 'list' && shown && lead && !ended ? (
          // A list that plays (R1, C): its song's own page, the song it is
          // on, with the list's covers down the left on a computer and what
          // plays next under Play on a phone. Only the music: no Back, no Get them.
          <View style={styles.list} testID="share-list">
            <View style={[styles.listSong, onStage && styles.listSongBeside]}>
              <ShareSong
                song={shown.song}
                track={lead}
                songId={shownId}
                cover={cover}
                tileHue={tileHue}
                lyrics={lyrics}
                lent={shown.song.lyrics !== null}
                loaded={loaded}
                start={null}
                onPlay={() => play(shownAt)}
                back={null}
                from={from}
                ways={null}
                foot={foot}
                wordsOpen={wordsOpen}
                onWords={setWordsOpen}
                list={{ ...list, upNext: onStage ? null : <UpNext {...covers} ids={ids} /> }}
              />
            </View>
            {onStage ? <CoverRail {...covers} onShuffle={list.onShuffle} /> : null}
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={[styles.page, wide && styles.pageWide]}
            onScroll={moreRows ? drawMore : undefined}
            scrollEventThrottle={moreRows ? 100 : undefined}
            testID="share-link"
          >
            {back}
            {from}

            {link.kind === 'song' && first ? (
              <SongStill song={first.song} cover={cover} tileHue={tileHue} size={coverSide} />
            ) : (
              <View style={styles.listHead}>
                <View style={[styles.mosaic, ended && styles.faded]}>
                  <FacesCover
                    people={[]}
                    size={wide ? 240 : 200}
                    covers={link.entries.map(entry => ({
                      uri: coverOf(entry),
                      title: entry.song.title,
                    }))}
                  />
                </View>
                <View style={styles.names}>
                  <Text
                    style={wide ? styles.titleWide : styles.title}
                    accessibilityRole="header"
                    numberOfLines={3}
                  >
                    {link.name}
                  </Text>
                  <Text style={styles.byline}>{plural(link.entries.length, 'song', 'songs')}</Text>
                </View>
              </View>
            )}

            {ways}

            {link.kind === 'list' ? (
              <View>
                {link.entries.slice(0, rows).map((entry, at) => {
                  const from = entry.song.sourceUrl
                  return (
                    <RoomEntryLine
                      key={entry.id}
                      song={entry.song}
                      uri={coverOf(entry)}
                      face={null}
                      note={yoursOf(entry.song, index) !== null ? 'yours' : undefined}
                      dim={ended || entry.gone}
                      onPress={
                        !ended && !entry.gone
                          ? () => play(playsAt.get(entry.id))
                          : from
                            ? () => void Linking.openURL(from)
                            : undefined
                      }
                      testID={`share-row-${at}`}
                    />
                  )
                })}
              </View>
            ) : null}

            {foot}
            <ChromeSpacer />
          </ScrollView>
        )}
      </SafeAreaView>
    </View>
  )
}

/**
 * The page's ground, as the phone's Now Playing draws its own: the cover's
 * colour, the cover itself blurred over it, and the ground laid over both so
 * the words read. Without a cover, or once the link has ended, the colour alone.
 * The veil is Now Playing's (`backdropVeil`): thicker over a cover close to
 * the theme's own text, so a pale cover under the dark theme still reads.
 */
function Backdrop({
  color,
  art,
  tone,
}: {
  color: string
  art: string | null
  tone: CoverTone | null
}): ReactNode {
  const { theme } = useUnistyles()
  const scheme = useShownScheme()
  // Over the colour alone there is no cover to read past: the veil a far cover gets.
  const veil = backdropVeil(art ? tone : null, scheme, 0.56)
  return (
    <View pointerEvents="none" style={[styles.fill, { backgroundColor: color }]}>
      {art ? (
        <Image source={{ uri: art }} blurRadius={60} resizeMode="cover" style={styles.fill} />
      ) : null}
      <View style={[styles.fill, { backgroundColor: withAlpha(theme.colors.surface0, veil) }]} />
    </View>
  )
}

/**
 * What to do next: Get it while it plays, Get it first on its last day
 * (D1), and once it has ended the three ways on (E1). The pills are veils of
 * the ink, as any pill over a song's colour is.
 */
function Ways({
  link,
  stage,
  signedIn,
  toGet,
  getting,
  onGet,
  source,
}: {
  link: ShareLink
  stage: ReturnType<typeof shareStage>
  signedIn: boolean
  toGet: number
  getting: boolean
  onGet: () => void
  source: string | null
}): ReactNode {
  const router = useRouter()
  const act = useShareAct()
  if (link.yours) return null
  const ended = stage === 'ended'
  const getLabel = getting
    ? 'Getting…'
    : link.kind === 'song'
      ? 'Get it'
      : `Get ${toGet === link.entries.length ? 'them' : plural(toGet, 'song', 'songs')}`
  const leads = stage !== 'live'
  return (
    <View style={styles.ways}>
      {signedIn && toGet > 0 ? (
        <Button
          label={getLabel}
          variant={leads ? 'primary' : 'secondary'}
          ground="translucent"
          disabled={getting}
          onPress={onGet}
          testID="share-get"
        />
      ) : null}
      {leads && signedIn && toGet > 0 ? (
        <Text style={styles.fine}>Puts it in your library for good</Text>
      ) : null}
      {ended && source ? (
        <Button
          label={`Open on ${sourceName(source)}`}
          ground="translucent"
          onPress={() => void Linking.openURL(source)}
          testID="share-source"
        />
      ) : null}
      {ended && link.ended?.why !== 'removed' ? <AskAgain link={link} signedIn={signedIn} /> : null}
      {signedIn && ended ? (
        <Button
          label="Take it off Home"
          variant="text"
          onPress={() =>
            void act(link.id, { type: 'forget' }).then(() => router.replace('/'), sayRoomFailure)
          }
          testID="share-forget"
        />
      ) : null}
    </View>
  )
}

/** Ask its sender for it again (F1): as yourself signed in, with a name as a guest. */
function AskAgain({ link, signedIn }: { link: ShareLink; signedIn: boolean }): ReactNode {
  const ask = useShareAsk(link.id, link.key)
  const [typing, setTyping] = useState(false)
  const [name, setName] = useState(() => prefs.get(GUEST_NAME_KEY) ?? '')
  const [busy, setBusy] = useState(false)
  const [asked, setAsked] = useState(() => link.asked || askedHere(link.id))
  const sender = link.from.name

  if (asked || link.asked) {
    return (
      <Text style={styles.fine} testID="share-asked">
        Asked. {sender} will see it next time they open self.mp3.
      </Text>
    )
  }

  const send = async (): Promise<void> => {
    const given = RoomMemberNameSchema.safeParse(name)
    if (!signedIn && !given.success) return
    setBusy(true)
    try {
      await ask(signedIn ? 'Me' : (given.data ?? ''))
      if (!signedIn) {
        prefs.set(GUEST_NAME_KEY, name.trim())
        rememberAsked(link.id)
      }
      setAsked(true)
      showToast(`Asked ${sender} to share it again`, 'good')
    } catch (failure) {
      sayRoomFailure(failure)
    } finally {
      setBusy(false)
    }
  }

  if (typing && !signedIn) {
    return (
      <TextField
        raised
        value={name}
        onChangeText={setName}
        onSubmitEditing={() => void send()}
        placeholder="Your name"
        accessibilityLabel="Your name, so they know who asked"
        limit={RoomMemberNameSchema}
        action={
          <Button
            label="Ask"
            busy={busy}
            disabled={!name.trim()}
            onPress={() => void send()}
            testID="share-ask-send"
          />
        }
        testID="share-ask-name"
      />
    )
  }
  return (
    <Button
      label={`Ask ${sender} again`}
      ground="translucent"
      busy={busy}
      onPress={() => (signedIn ? void send() : setTyping(true))}
      testID="share-ask"
    />
  )
}

const styles = StyleSheet.create(theme => ({
  screen: { flex: 1, backgroundColor: theme.colors.surface0 },
  safe: { flex: 1 },
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden' },
  page: {
    width: '100%',
    maxWidth: PAGE_WIDTH,
    alignSelf: 'center',
    gap: space.lg,
    padding: space.gutter,
    paddingBottom: space.xl,
    flexGrow: 1,
  },
  pageWide: { paddingTop: space.gutterWide },
  list: { flex: 1 },
  listSong: { flex: 1 },
  // Beside the rail shut, which opens over it rather than pushing it along.
  listSongBeside: { paddingLeft: RAIL_WIDTH },
  from: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  fromText: { ...lineSub(theme.colors), flex: 1, minWidth: 0 },
  warn: { color: theme.colors.warning },
  listHead: { gap: space.lg },
  mosaic: { alignSelf: 'flex-start', borderRadius: radius.card, ...artShadow(theme.colors) },
  faded: { opacity: 0.45 },
  names: { gap: space.xs },
  title: heroTitle(theme.colors, 'page'),
  titleWide: heroTitle(theme.colors),
  byline: { color: theme.colors.textSecondary, fontSize: type.body },
  ways: { gap: space.sm, alignItems: 'stretch' },
  fine: { color: theme.colors.textMuted, fontSize: type.small },
  // At the foot of a short page too: the page grows to the screen and this sits at its end.
  footer: {
    marginTop: 'auto',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.tight,
  },
  footerText: { color: theme.colors.textMuted, fontSize: type.small },
}))
