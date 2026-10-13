import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Linking, Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
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
  radius,
  roomTrackId,
  space,
  type,
  useLibrary,
  yoursOf,
} from '@selfmp3/client'
import { useConnection } from '../../connection/ConnectionProvider'
import { usePlayerCommands, usePlayingSongId } from '../../player/PlayerProvider'
import { setTrackSource } from '../../player/roomTracks'
import { prefs } from '../../ports/prefs'
import { useLayoutValue } from '../../shell/useLayout'
import { label, lineSub, pageTitle } from '../../ui/surfaces'
import { showToast } from '../../ui/toast'
import { BackButton } from '../../ui/components/BackButton'
import { Button } from '../../ui/components/Button'
import { Cover } from '../../ui/components/Cover'
import { MissingPage } from '../../ui/components/MissingPage'
import { PageLoading } from '../../ui/components/PageLoading'
import { PlayPauseButton } from '../../ui/components/PlayPauseButton'
import { SafeAreaView } from '../../ui/components/SafeAreaView'
import { ScrollView } from '../../ui/components/Scroll'
import { SeekBar } from '../../ui/components/SeekBar'
import { TextField } from '../../ui/components/TextField'
import { RoomEntryLine } from '../room/RoomEntryLine'
import { RoomFace } from '../room/RoomFace'
import { sayRoomFailure } from '../room/roomFailure'
import { useGetSongs } from '../room/useGetSongs'
import {
  gettable,
  sentLine,
  shareFromLine,
  shareStage,
  shareTimeLine,
  shareTracks,
  sourceName,
} from './share.model'
import { shareApi, useShareAct, useShareAsk, useShareLink } from './shareLinks'
import { useMinute } from './useMinute'

/** The name a guest last gave, offered again: the one a room's guest gave. */
const GUEST_NAME_KEY = 'room.name'

/** The links this device asked for again while signed out: a guest's ask is remembered here. */
const ASKED_KEY = 'share.asked'

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

function LinkPage({ link }: { link: ShareLink }): ReactNode {
  const router = useRouter()
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
  const wide = useLayoutValue(layout => layout.wide)

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
  const coverSize = wide ? 280 : 240

  const play = (at = 0): void => {
    if (ids.length === 0) return
    const id = ids[at]
    if (id !== undefined && playing === id) player.toggle()
    else player.playFrom(ids, at)
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.page} testID="share-link">
        {signedIn ? <BackButton to="/" /> : null}
        <View style={styles.from}>
          <RoomFace name={link.from.name} colour={0} picture={link.from.picture} size={24} />
          <Text style={styles.text} numberOfLines={1}>
            {link.yours ? 'Your link' : shareFromLine(link)}
          </Text>
        </View>

        {link.kind === 'song' && first ? (
          <View style={styles.song}>
            <View style={ended ? styles.faded : undefined}>
              <Cover uri={cover} title={first.song.title} size={coverSize} />
            </View>
            <View style={styles.names}>
              <Text style={styles.big} accessibilityRole="header" numberOfLines={3}>
                {first.song.title}
              </Text>
              <Text style={styles.text} numberOfLines={2}>
                {[first.song.artist, first.song.album].filter(Boolean).join(' · ')}
              </Text>
            </View>
          </View>
        ) : (
          <View style={styles.names}>
            <Text style={styles.big} accessibilityRole="header" numberOfLines={3}>
              {link.name}
            </Text>
            <Text style={styles.text}>{plural(link.entries.length, 'song', 'songs')}</Text>
          </View>
        )}

        <View
          style={[styles.chip, stage === 'lastDay' && styles.chipWarn]}
          testID={`share-stage-${stage}`}
        >
          <Text style={[styles.chipText, stage === 'lastDay' && styles.chipTextWarn]}>
            {link.yours && !ended
              ? sentLine({ ...link, songs: 0, cover: null }, now)
              : shareTimeLine(link, now)}
          </Text>
        </View>

        {!ended && link.kind === 'song' && first ? (
          <View style={styles.transport}>
            <PlayPauseButton
              size={64}
              songId={firstId}
              playLabel={`Play ${first.song.title}`}
              onPress={() => play(0)}
              testID="share-play"
            />
            {playing === firstId ? (
              <View style={styles.seek}>
                <SeekBar />
              </View>
            ) : null}
          </View>
        ) : null}

        {!ended && link.kind === 'list' ? (
          <View style={styles.actions}>
            <Button label="Play" variant="primary" onPress={() => play(0)} testID="share-play" />
            <Button label="Shuffle" onPress={() => player.playShuffled(ids)} />
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

        {link.kind === 'list'
          ? link.entries.map((entry, at) => {
              const from = entry.song.sourceUrl
              return (
                <RoomEntryLine
                  key={entry.id}
                  song={entry.song}
                  uri={coverOf(entry)}
                  face={null}
                  who={entry.song.artist}
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
            })
          : null}

        {link.yours ? (
          <Button label="Links you shared" variant="text" onPress={() => router.push('/links')} />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}

/**
 * What to do next: Get it while it plays, Get it first on its last day
 * (D1), and once it has ended the three ways on (E1).
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
      variant="text"
      busy={busy}
      onPress={() => (signedIn ? void send() : setTyping(true))}
      testID="share-ask"
    />
  )
}

const styles = StyleSheet.create(theme => ({
  screen: { flex: 1, backgroundColor: theme.colors.surface0 },
  page: {
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
    gap: space.lg,
    padding: space.gutter,
    paddingBottom: 120,
  },
  from: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  song: { gap: space.lg },
  faded: { opacity: 0.45 },
  names: { gap: space.xs },
  big: pageTitle(theme.colors),
  text: lineSub(theme.colors),
  label: label(theme.colors),
  fine: { color: theme.colors.textMuted, fontSize: type.small },
  chip: {
    alignSelf: 'flex-start',
    paddingHorizontal: space.snug,
    paddingVertical: space.xs,
    borderRadius: radius.pill,
    backgroundColor: theme.colors.surface2,
  },
  chipWarn: { backgroundColor: theme.colors.warningWash },
  chipText: { color: theme.colors.textSecondary, fontSize: type.small },
  chipTextWarn: { color: theme.colors.warning },
  transport: { gap: space.md, alignItems: 'flex-start' },
  seek: { alignSelf: 'stretch' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  ways: { gap: space.sm, alignItems: 'stretch' },
}))
