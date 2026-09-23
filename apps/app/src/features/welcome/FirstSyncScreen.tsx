import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { ScrollView, Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { useRouter } from 'expo-router'
import { fonts, radius, space, useLibrary } from '@selfmp3/client'
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
import { titleBarInset } from '../../ports/titleBarInset'
import { useConnection } from '../../connection/ConnectionProvider'
import { useLayout } from '../../shell/useLayout'
import { Cover } from '../../ui/components/Cover'
import { SafeAreaView } from '../../ui/components/SafeAreaView'
import { Toggle } from '../../ui/components/Toggle'
import { card, serif } from '../../ui/surfaces'
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

/**
 * First sync (docs/ui-mock `P03`, `C02`): the page between the first Google
 * sign-in on a device and Home, while the library arrives.
 *
 * It says hello, shows the library coming down — its counts at once, then the
 * covers one by one — and asks one thing: whether to keep every song on this
 * device. That switch is Settings' "Download automatically on Wi-Fi", the same
 * preference through the same call, set here to where this kind of device
 * should start. Shown once per device; the root layout only sends a first
 * sign-in here.
 */

/** How many covers are fetched at once while the page is open. */
const COVER_FETCHES = 4

export function FirstSyncScreen(): ReactNode {
  const router = useRouter()
  const { wide } = useLayout()
  const { fromCloud, status } = useConnection()
  const library = useLibrary()
  const { prefs, setPrefs } = useDownloads()
  const name = useCloudSession().data?.name ?? null

  /*
   * Once, on arrival: remember this device has seen the page, and start the
   * switch where this kind of device should. Written at once rather than on
   * Continue, so a phone does not begin downloading every song in the moment
   * before the person reads the switch that says it will not.
   *
   * Only with a library: the route is drawn for a moment before the root
   * layout turns a signed-out device away to Welcome, and that moment must not
   * count as having seen it.
   */
  const [startsOn] = useState(() => keepEverySongByDefault(wide))
  const signedIn = status === 'ready'
  useEffect(() => {
    if (!signedIn) return
    rememberFirstSyncSeen()
    setPrefs({ autoOnWifi: startsOn })
  }, [signedIn, setPrefs, startsOn])

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
  const keep = keepEverySongCopy(wide, bytes)

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={[styles.page, wide && styles.pageWide]}>
        <View style={[styles.column, wide && styles.columnWide]}>
          <View style={styles.hello}>
            <Text style={[styles.title, wide && styles.titleWide]} accessibilityRole="header">
              {helloLine(name)}
              <Text style={styles.titleMark}>.</Text>
            </Text>
            <Text style={[styles.lead, wide && styles.leadWide]}>
              Your library is on its way. You can start playing while the covers arrive.
            </Text>
          </View>

          <View style={[styles.card, wide && styles.cardWide]} testID="first-sync-progress">
            <View style={styles.cardRow}>
              <Stack songs={withArt} total={songs.length} size={wide ? 48 : 44} />
              <View style={styles.cardWords}>
                <Text style={styles.summary} numberOfLines={1}>
                  {now.summary ?? 'Finding your library…'}
                </Text>
                {now.detail ? <Text style={styles.detail}>{now.detail}</Text> : null}
              </View>
            </View>
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${Math.round(now.fraction * 100)}%` }]} />
            </View>
          </View>

          <View style={styles.keep}>
            <Toggle
              testID="first-sync-keep"
              value={prefs.autoOnWifi}
              onChange={autoOnWifi => setPrefs({ autoOnWifi })}
              label={keep.label}
            />
            <View style={styles.keepWords}>
              <Text style={styles.keepLabel}>{keep.label}</Text>
              <Text style={styles.keepHint}>{keep.hint}</Text>
            </View>
          </View>

          <View style={[styles.continue, wide && styles.continueWide]}>
            <WhitePill
              testID="first-sync-continue"
              label="Start listening"
              width={wide ? 240 : undefined}
              onPress={() => router.replace('/')}
            />
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
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
          style={[styles.more, shown.length > 0 && styles.stacked, { width: size, height: size }]}
        >
          <Text style={styles.moreText}>+{rest}</Text>
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  screen: { flex: 1, backgroundColor: theme.colors.surface0 },
  page: { flexGrow: 1, paddingHorizontal: 28, paddingTop: 60 + titleBarInset },
  // On a computer the page is one column in the middle of the window (`C02`).
  pageWide: { alignItems: 'center', justifyContent: 'center', paddingVertical: 60 },
  column: { flexGrow: 1, gap: 28 },
  columnWide: { flexGrow: 0, width: 560, maxWidth: '100%' },
  hello: { gap: space.sm },
  // A greeting, so the serif: one weight, never bolded.
  title: { ...serif(theme.colors, 40), lineHeight: 42, letterSpacing: -0.5 },
  titleWide: { fontSize: 52, lineHeight: 54, letterSpacing: -0.8 },
  titleMark: { fontFamily: fonts.serifItalic, color: theme.colors.accent },
  lead: { color: theme.colors.textSecondary, fontSize: 15, lineHeight: 22 },
  leadWide: { fontSize: 16, lineHeight: 24 },
  card: { ...card(theme.colors, radius.cardLg), padding: 18, gap: 14 },
  cardWide: { padding: 20 },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  cardWords: { flex: 1, minWidth: 0, gap: 2 },
  summary: { color: theme.colors.textPrimary, fontSize: 15, fontWeight: '600' },
  detail: { color: theme.colors.textSecondary, fontSize: 13 },
  track: {
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: theme.colors.surface2,
    overflow: 'hidden',
  },
  fill: { height: 6, borderRadius: radius.pill, backgroundColor: theme.colors.accent },
  stack: { flexDirection: 'row' },
  stacked: { marginLeft: -18 },
  more: {
    borderRadius: radius.cover,
    backgroundColor: theme.colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moreText: { color: theme.colors.textSecondary, fontSize: 12, fontWeight: '600' },
  keep: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  keepWords: { flex: 1, gap: 2 },
  keepLabel: { color: theme.colors.textPrimary, fontSize: 15, fontWeight: '600' },
  keepHint: { color: theme.colors.textSecondary, fontSize: 13, lineHeight: 18 },
  // At the foot of a phone, where a thumb is; under the switch on a computer.
  continue: { marginTop: 'auto', marginBottom: 60 },
  continueWide: { marginTop: 0, marginBottom: 0 },
}))
