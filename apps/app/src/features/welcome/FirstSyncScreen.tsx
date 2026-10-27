import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { useRouter } from 'expo-router'
import { radius, space, type, useLibrary } from '@selfmp3/client'
import type { Song } from '@selfmp3/shared'
import {
  coverFor,
  coversVersion,
  ensureCover,
  keepsCovers,
  subscribeCovers,
} from '../../offline/covers'
import { useDownloads } from '../../offline/DownloadsProvider'
import { useCloudSession } from '../profile/useCloudSession'
import { useArt } from '../../offline/useArt'
import { useConnection } from '../../connection/ConnectionProvider'
import { useLayoutFlags } from '../../shell/useLayout'
import { thisPlace } from '../../ports/place'
import { Cover } from '../../ui/components/Cover'
import { ToggleRow } from '../../ui/components/Toggle'
import {
  arrival,
  helloLine,
  keepEverySongByDefault,
  keepEverySongCopy,
  STACK_COVERS,
  stackRest,
} from './firstSync.model'
import { rememberFirstSyncSeen } from './firstSyncMemory'
import { WhitePill } from './WhitePill'
import { ProgressBar } from '../../ui/components/ProgressBar'
import { OnboardingCard, OnboardingPage } from './OnboardingPage'
import { rowTitle, textColumn } from '../../ui/surfaces'

/**
 * First sync (docs/ui-mock `P03`, `C02`): the page between the first Google
 * sign-in on a device and Home, while the library arrives.
 *
 * It says hello, shows the library coming down — its counts at once, then the
 * covers one by one — and asks one thing: whether to keep every song on this
 * device. That switch is Settings' "Download automatically on Wi-Fi", the same
 * preference through the same call, starting where this kind of device should
 * and written when the page is left. Shown once per device; the root layout
 * only sends a first sign-in here.
 */

/** How many covers are fetched at once while the page is open. */
const COVER_FETCHES = 4

export function FirstSyncScreen(): ReactNode {
  const router = useRouter()
  const { wide } = useLayoutFlags()
  const { fromCloud, status } = useConnection()
  const library = useLibrary()
  const { setPrefs } = useDownloads()
  const name = useCloudSession().data?.name ?? null

  /*
   * On arrival: remember this device has seen the page, and keep nothing
   * while the switch is unanswered. The switch starts where this kind of
   * device should, and what it says when the page is left — Start listening,
   * or any other way out — is what is written. Written as on at once, a
   * computer had downloaded the whole library before anyone could turn it off
   * (R2-m3).
   *
   * Only with a library: the route is drawn for a moment before the root
   * layout turns a signed-out device away to Welcome, and that moment must not
   * count as having seen it.
   */
  const [keepAll, setKeepAll] = useState(() => keepEverySongByDefault(wide))
  const answer = useRef(keepAll)
  useEffect(() => {
    answer.current = keepAll
  }, [keepAll])
  const signedIn = status === 'ready'
  useEffect(() => {
    if (!signedIn) return undefined
    rememberFirstSyncSeen()
    setPrefs({ autoOnWifi: false })
    return () => setPrefs({ autoOnWifi: answer.current })
  }, [signedIn, setPrefs])

  const songs = useMemo(() => library.data?.songs ?? [], [library.data])
  const withArt = useMemo(() => songs.filter(song => song.hasArt), [songs])

  // The covers, fetched while the page is open, a few at a time, so the bar
  // below has something to follow. Rows would ask for the same ones later;
  // asking now only means they are already here.
  useEffect(() => {
    if (!fromCloud || !keepsCovers || withArt.length === 0) return
    let cancelled = false
    const waiting = withArt.map(song => song.id)
    const worker = async (): Promise<void> => {
      while (!cancelled) {
        const next = waiting.shift()
        if (next === undefined) return
        await ensureCover(next)
      }
    }
    for (let lane = 0; lane < COVER_FETCHES; lane++) void worker()
    return () => {
      cancelled = true
    }
  }, [fromCloud, withArt])

  // Drawn again as covers arrive; the count is read fresh each time.
  useSyncExternalStore(subscribeCovers, coversVersion, coversVersion)
  const coversHere = withArt.filter(song => coverFor(song.id) !== undefined).length

  const now = arrival(
    library.data
      ? {
          songs: songs.length,
          tags: library.data.tags.length,
          playlists: library.data.playlists.length,
          withArt: withArt.length,
          coversHere,
          keepsCovers,
        }
      : null,
  )
  const bytes = library.data ? songs.reduce((sum, song) => sum + song.sizeBytes, 0) : null
  const keep = keepEverySongCopy(wide, bytes, thisPlace() === 'iPad')

  return (
    <OnboardingPage
      title={helloLine(name)}
      lead="Your library is on its way. You can start playing while the covers arrive."
    >
      <OnboardingCard testID="first-sync-progress">
        <View style={styles.cardRow}>
          <Stack songs={withArt} total={songs.length} size={wide ? 48 : 44} />
          <View style={styles.cardWords}>
            <Text style={styles.summary} numberOfLines={1}>
              {now.summary ?? 'Finding your library…'}
            </Text>
            {now.detail ? <Text style={styles.detail}>{now.detail}</Text> : null}
          </View>
        </View>
        <ProgressBar fraction={now.fraction} label="Your library arriving" />
      </OnboardingCard>

      <ToggleRow
        label={keep.label}
        hint={keep.hint}
        value={keepAll}
        onChange={setKeepAll}
        testID="first-sync-keep"
        style={styles.keep}
      />

      <View style={[styles.continue, wide && styles.continueWide]}>
        <WhitePill
          testID="first-sync-continue"
          label="Start listening"
          width={wide ? 240 : undefined}
          onPress={() => {
            setPrefs({ autoOnWifi: keepAll })
            router.replace('/')
          }}
        />
      </View>
    </OnboardingPage>
  )
}

/**
 * The first few covers overlapping, and how many songs are behind them. A
 * cover that has not arrived is its letter tile, which is what a row shows too.
 */
function Stack({
  songs,
  total,
  size,
}: {
  songs: readonly Song[]
  total: number
  size: number
}): ReactNode {
  const art = useArt()
  const shown = songs.slice(0, STACK_COVERS)
  const rest = stackRest(total, shown.length)
  return (
    <View style={styles.stack} aria-hidden>
      {shown.map((song, index) => (
        <View key={song.id} style={[index > 0 && styles.stacked, { zIndex: STACK_COVERS - index }]}>
          <Cover
            uri={art(song)}
            title={song.album || song.title}
            size={size}
            radius={radius.cover}
          />
        </View>
      ))}
      {rest > 0 ? (
        <View
          style={[
            styles.more,
            shown.length > 0 && [styles.stacked, styles.moreStacked],
            { minWidth: size, height: size },
          ]}
        >
          <Text style={styles.moreText}>+{rest}</Text>
        </View>
      ) : null}
    </View>
  )
}

/** How far each cover in the stack, and the count after them, slides under the one before. */
const STACK_OVERLAP = 18

const styles = StyleSheet.create(theme => ({
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  cardWords: textColumn,
  summary: rowTitle(theme.colors),
  detail: { color: theme.colors.textSecondary, fontSize: type.sub },
  stack: { flexDirection: 'row' },
  stacked: { marginLeft: -STACK_OVERLAP },
  more: {
    paddingHorizontal: space.xs,
    borderRadius: radius.cover,
    backgroundColor: theme.colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The last cover lies over the count's first STACK_OVERLAP points, so the
  // count is centred in what shows: "+37" read "·37" with the "+" under it.
  moreStacked: { paddingLeft: STACK_OVERLAP + space.xs },
  moreText: { color: theme.colors.textSecondary, fontSize: type.small, fontWeight: '600' },
  keep: { paddingHorizontal: space.tight, paddingVertical: space.xs },
  // At the foot of a phone, where a thumb is; under the switch on a computer.
  continue: { marginTop: 'auto', marginBottom: 60 },
  continueWide: { marginTop: 0, marginBottom: 0 },
}))
