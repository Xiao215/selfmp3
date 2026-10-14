import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Image, Linking, Text, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useLocalSearchParams, useRouter } from 'expo-router'
import {
  DoormanError,
  plural,
  RoomMemberNameSchema,
  ShareIdSchema,
  ShareKeySchema,
  type ShareLink,
} from '@selfmp3/shared'
import {
  libraryIndex,
  neutralWash,
  radius,
  roomTrackId,
  roomTrackSong,
  space,
  type,
  useLibrary,
  withAlpha,
  yoursOf,
} from '@selfmp3/client'
import { useConnection } from '../../connection/ConnectionProvider'
import { usePlayerCommands, usePlayingSongId } from '../../player/PlayerProvider'
import { setTrackSource } from '../../player/roomTracks'
import { prefs } from '../../ports/prefs'
import { useLayout } from '../../shell/useLayout'
import { artShadow, heroTitle, lineSub } from '../../ui/surfaces'
import { showToast } from '../../ui/toast'
import { useSongColor } from '../../ui/useSongColor'
import { BackButton } from '../../ui/components/BackButton'
import { BrandMark } from '../../ui/components/BrandMark'
import { Button } from '../../ui/components/Button'
import { MissingPage } from '../../ui/components/MissingPage'
import { PageLoading } from '../../ui/components/PageLoading'
import { PlayPauseButton } from '../../ui/components/PlayPauseButton'
import { PlayShuffle } from '../../ui/components/PlayShuffle'
import { Press } from '../../ui/components/Press'
import { SafeAreaView } from '../../ui/components/SafeAreaView'
import { ScrollView } from '../../ui/components/Scroll'
import { SeekBar } from '../../ui/components/SeekBar'
import { TextField } from '../../ui/components/TextField'
import { RoomEntryLine } from '../room/RoomEntryLine'
import { FacesCover, RoomFace } from '../room/RoomFace'
import { sayRoomFailure } from '../room/roomFailure'
import { useGetSongs } from '../room/useGetSongs'
import { gettable, shareHeadLine, shareStage, shareTracks, sourceName } from './share.model'
import { ShareSongHead } from './ShareSongHead'
import { shareApi, useShareAct, useShareAsk, useShareLink } from './shareLinks'
import { useLentWords } from './useLentWords'
import { useMinute } from './useMinute'

/** The name a guest last gave, offered again: the one a room's guest gave. */
const GUEST_NAME_KEY = 'room.name'

/** The links this device asked for again while signed out: a guest's ask is remembered here. */
const ASKED_KEY = 'share.asked'

/** The page's column at its widest, on a computer. */
const PAGE_WIDTH = 520

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
  const params = useLocalSearchParams<{ id: string; key: string }>()
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
    return (
      <MissingPage
        title={id && !wrongKey ? 'This link is gone' : 'That link isn’t all there'}
        line={
          id && !wrongKey
            ? 'A link is forgotten ninety days after it ends.'
            : 'Check it was copied whole, or ask for it again.'
        }
        back={status === 'ready' ? '/' : undefined}
        testID="share-missing"
      />
    )
  }
  return <LinkPage link={link} />
}

/**
 * The link itself (F1 and F2 of the page's proposal, Apple Music's way): on
 * its cover's colour, its sender and how long it has on one line at the top,
 * then the song — its big cover, its name, Play with the bar beside it — or
 * the list's covers, name and Play. While a song with words plays, its words
 * take the cover's place (`ShareSongHead`).
 */
function LinkPage({ link }: { link: ShareLink }): ReactNode {
  const router = useRouter()
  const { theme } = useUnistyles()
  const { status } = useConnection()
  const signedIn = status === 'ready'
  const player = usePlayerCommands()
  const playing = usePlayingSongId()
  const { data: library } = useLibrary()
  const index = useMemo(() => libraryIndex(library?.songs ?? []), [library?.songs])
  // The clock moves on while the page is open: the last day, and the end, arrive by themselves.
  const now = useMinute()
  const stage = shareStage(link, now)
  const getSongs = useGetSongs({ enabled: signedIn && !link.yours })
  const { wide, width } = useLayout()

  // Its songs as tracks, for their covers now and for playing them; kept
  // while anything plays them, so they are not taken from under the player.
  useEffect(() => {
    setTrackSource(
      `share:${link.id}`,
      shareTracks(link, (entryId, part) => shareApi.fileUrl(link, entryId, part), index, now),
    )
  }, [link, index, now])

  const entries = link.entries.filter(entry => !entry.gone)
  const ids = entries.map(entry => roomTrackId(entry.id))
  const first = link.entries[0]
  const firstId = first ? roomTrackId(first.id) : 0
  // From the link itself, not the player's tracks: those are filled after this first draw.
  const coverOf = (entry: ShareLink['entries'][number]): string | null =>
    entry.song.cover ? shareApi.fileUrl(link, entry.id, 'cover') : null
  const cover = first ? coverOf(first) : null
  const toGet = gettable(link, index)
  const ended = stage === 'ended'
  const source = first?.song.sourceUrl ?? null
  const head = shareHeadLine(link, now)
  const loaded = link.kind === 'song' && playing === firstId

  // Washed in its first cover's colour, as Now Playing is; grey once it has ended.
  const lead = useMemo(
    () =>
      first ? roomTrackSong({ id: first.id, song: first.song, addedAt: link.createdAt }) : null,
    [first, link.createdAt],
  )
  const light = useSongColor(lead, cover, !ended)
  const tone = first?.song.coverTone ?? null
  const wash = ended ? (tone ? neutralWash(tone) : theme.colors.surface2) : light.color

  // Its words in the cover's place while it plays (F2), until the cover is asked back.
  const lyrics = useLentWords(link, link.kind === 'song' ? first : undefined, loaded)
  const [coverAsked, setCoverAsked] = useState(false)
  const hasWords = loaded && lyrics.words.status === 'lyrics'
  // As big as the column allows, short of pushing Play out of sight.
  const coverSide = Math.min(wide ? 360 : 340, Math.min(width, PAGE_WIDTH) - space.gutter * 2)

  const play = (at = 0): void => {
    if (ids.length === 0) return
    const id = ids[at]
    if (id !== undefined && playing === id) player.toggle()
    else player.playFrom(ids, at)
  }

  return (
    <View style={styles.screen}>
      <Backdrop color={wash} art={ended ? null : cover} />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <ScrollView
          contentContainerStyle={[
            styles.page,
            wide && styles.pageWide,
            signedIn && styles.pageInApp,
          ]}
          testID="share-link"
        >
          {signedIn ? <BackButton to="/" /> : null}
          <View style={styles.from} testID={`share-stage-${stage}`}>
            <RoomFace name={link.from.name} colour={0} picture={link.from.picture} size={28} />
            <Text style={styles.fromText} numberOfLines={2}>
              {head.from}
              {' · '}
              <Text style={stage === 'lastDay' ? styles.warn : undefined}>{head.time}</Text>
            </Text>
          </View>

          {link.kind === 'song' && first ? (
            <ShareSongHead
              song={first.song}
              cover={cover}
              size={coverSide}
              wide={wide}
              ended={ended}
              lyrics={lyrics}
              showWords={hasWords && !coverAsked}
              onShowWords={hasWords ? on => setCoverAsked(!on) : null}
            />
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

          {!ended && link.kind === 'song' && first ? (
            // The bar beside Play from the start, so nothing moves when it plays.
            <View style={styles.transport}>
              <PlayPauseButton
                songId={firstId}
                playLabel={`Play ${first.song.title}`}
                onPress={() => play(0)}
                testID="share-play"
              />
              <View style={styles.seek} pointerEvents={loaded ? 'auto' : 'none'}>
                <SeekBar
                  color={theme.colors.textPrimary}
                  waiting={loaded ? undefined : first.song.duration}
                />
              </View>
            </View>
          ) : null}

          {!ended && link.kind === 'list' ? (
            <View style={styles.actions}>
              <PlayShuffle
                name={link.name}
                songIds={ids}
                onPlay={() => play(0)}
                onShuffle={() => player.playShuffled(ids)}
                testPrefix="share"
              />
            </View>
          ) : null}

          <Ways
            link={link}
            stage={stage}
            signedIn={signedIn}
            toGet={toGet.length}
            getting={toGet.some(entry => getSongs.getting.has(entry.song.sourceUrl ?? ''))}
            onGet={() => void getSongs.get(toGet.map(entry => entry.song))}
            source={link.kind === 'song' ? source : null}
          />

          {link.kind === 'list' ? (
            <View>
              {link.entries.map((entry, at) => {
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
                        ? () => play(entries.indexOf(entry))
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

          {link.yours ? (
            <Button label="Links you shared" variant="text" onPress={() => router.push('/links')} />
          ) : null}

          {/* For whoever has never seen self.mp3: what it is, and the way in. */}
          {signedIn ? null : (
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
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  )
}

/**
 * The page's ground, as the phone's Now Playing draws its own: the cover's
 * colour, the cover itself blurred over it, and the ground laid over both so
 * the words read. Without a cover, or once the link has ended, the colour alone.
 */
function Backdrop({ color, art }: { color: string; art: string | null }): ReactNode {
  return (
    <View pointerEvents="none" style={[styles.fill, { backgroundColor: color }]}>
      {art ? (
        <Image source={{ uri: art }} blurRadius={60} resizeMode="cover" style={styles.fill} />
      ) : null}
      <View style={[styles.fill, styles.veil]} />
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
  // Now Playing's veil on a phone, so the page reads the same under its words.
  veil: { backgroundColor: withAlpha(theme.colors.surface0, 0.56) },
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
  // Signed in, the app's mini player sits over the page's foot.
  pageInApp: { paddingBottom: 120 },
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
  transport: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  seek: { flex: 1, minWidth: 0 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: space.snug },
  ways: { gap: space.sm, alignItems: 'stretch' },
  fine: { color: theme.colors.textMuted, fontSize: type.small },
  // At the foot of a short page too: the page grows to the screen and this sits at its end.
  footer: {
    marginTop: 'auto',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.tight,
    paddingTop: space.xl,
  },
  footerText: { color: theme.colors.textMuted, fontSize: type.small },
}))
