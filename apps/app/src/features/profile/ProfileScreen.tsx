import { ChromeSpacer } from '../../shell/ChromeSpacer'
import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { useRouter } from 'expo-router'
import type { Stats } from '@selfmp3/shared'
import { radius, space, type, useLibrary, type ServerConnection } from '@selfmp3/client'
import { useLayout } from '../../shell/useLayout'
import { BackButton } from '../../ui/components/BackButton'
import { Download, Settings, Sparkles } from '../../ui/components/Icons'
import { SafeAreaView } from '../../ui/components/SafeAreaView'
import { useArt } from '../../offline/useArt'
import { Avatar } from '../../ui/components/Avatar'
import { NavRow } from '../../ui/components/NavRow'
import { useAccount } from './useAccount'
import { deviceKind } from '../../ports/device'
import { card, label, pageFrame, serif, lineSub } from '../../ui/surfaces'
import { devicePlace } from '../settings/settings.model'
import { useStatsFor, useStatsSongs } from '../stats/statsSource'
import {
  MONTH_CARD_TITLE,
  monthCard,
  monthCardSpoken,
  profileLine,
  profileName,
  profileRows,
  type MonthCard,
  type ProfileRow,
  type ProfileRowId,
} from './profile.model'
import { useVia } from '../../connection/via'
import { SongLine } from '../../ui/components/SongLine'
import { StatFigure } from '../../ui/components/StatFigure'
import { ScrollView } from '../../ui/components/Scroll'
import { Press } from '../../ui/components/Press'

const ICONS: Record<ProfileRowId, typeof Settings> = {
  import: Download,
  report: Sparkles,
  settings: Settings,
}

/**
 * Profile (`P31`): the person and how big the library is, this month as one
 * card that opens Stats, then Import, Report and Settings (profile.model.ts).
 *
 * Behind the avatar on a phone's Home; a computer reaches it from the name row
 * at the foot of its sidebar, and draws the same page at its own width.
 */
export function ProfileScreen(): ReactNode {
  /*
   * The card's numbers are the server's plays. A cloud library therefore has
   * them only while its server is within reach; without one the card says
   * so, and Stats, which it opens, explains the rest. From the window Stats
   * opens on — the same cached answer, so the two agree.
   */
  const via = useVia()
  const { data: stats, isLoading } = useStatsFor(via, '30d')
  return <ProfilePage stats={stats} loading={isLoading} via={via} />
}

function ProfilePage({
  stats,
  loading,
  via,
}: {
  stats: Stats | undefined
  loading: boolean
  via: ServerConnection | undefined
}): ReactNode {
  const { wide } = useLayout()
  const rows = profileRows({ place: devicePlace(deviceKind()) })

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView
        contentContainerStyle={[styles.content, wide ? styles.contentWide : styles.contentNarrow]}
        testID="profile-screen"
      >
        <BackButton to="/" testID="profile-back" />
        <Person />
        <Month card={monthCard(stats)} loading={loading} via={via} />
        <View>
          {rows.map(row => (
            <Row key={row.id} row={row} />
          ))}
        </View>
        <ChromeSpacer />
      </ScrollView>
    </SafeAreaView>
  )
}

/** How big the round mark is on the page's head. */
const AVATAR = 64

/** The avatar, the name, and one line of how big the library is. */
function Person(): ReactNode {
  // Whoever is signed in, from the session on a cloud device or from the
  // server's own sign-in: the same source the avatar beside the name draws.
  const account = useAccount()
  const library = useLibrary()
  const name = profileName(account?.name)
  const line = profileLine({
    songs: library.data?.songs.length,
    tags: library.data?.tags.length,
    error: library.isError ? library.error : null,
  })

  return (
    <View style={styles.person}>
      <Avatar account={account} size={AVATAR} />
      <View style={styles.personWords}>
        <Text style={styles.name} accessibilityRole="header" numberOfLines={1}>
          {name}
        </Text>
        <Text style={styles.line} testID="profile-line">
          {line}
        </Text>
      </View>
    </View>
  )
}

/**
 * This month as one card, and the card is the way to Stats. Before the
 * numbers arrive, or when the server that has them is away, it is still that
 * way, and says why it is empty.
 */
function Month({
  card: month,
  loading,
  via,
}: {
  card: MonthCard | null
  loading: boolean
  via: ServerConnection | undefined
}): ReactNode {
  const router = useRouter()
  return (
    <Press
      depth="row"
      onPress={() => router.push('/stats')}
      accessibilityRole="link"
      accessibilityLabel={monthCardSpoken(month)}
      testID="profile-stats"
      style={styles.month}
    >
      <View style={styles.monthHead}>
        <Text style={styles.monthTitle}>{MONTH_CARD_TITLE}</Text>
        <Text style={styles.monthLink}>Stats</Text>
      </View>
      {month ? (
        <>
          <View style={styles.figures}>
            <StatFigure value={month.listened} unit={month.listenedUnit} caption="listened" />
            <StatFigure value={month.plays} caption="plays" />
            <StatFigure value={month.streak} unit={month.streakUnit} caption="streak" />
          </View>
          {month.onRepeat ? <OnRepeat month={month} via={via} /> : null}
        </>
      ) : (
        <Text style={styles.line}>
          {loading
            ? 'Working it out…'
            : 'Your listening numbers come from your library’s computer.'}
        </Text>
      )}
    </Press>
  )
}

/** The most played song with its cover, and when you listen most under it. */
function OnRepeat({
  month,
  via,
}: {
  month: MonthCard
  via: ServerConnection | undefined
}): ReactNode {
  const songFor = useStatsSongs(via)
  const artFor = useArt()
  const top = month.onRepeat
  if (!top) return null
  const song = songFor(top.songId)
  return (
    <SongLine
      style={styles.repeat}
      artUri={song ? artFor(song) : null}
      coverTitle={top.title}
      title={top.title}
      sub={month.when ? `On repeat · ${month.when}` : 'On repeat'}
    />
  )
}

function Row({ row }: { row: ProfileRow }): ReactNode {
  const router = useRouter()
  const Icon = ICONS[row.id]
  return (
    <NavRow
      icon={<Icon tone="textPrimary" />}
      title={row.label}
      hint={row.hint}
      onPress={() => router.push(row.href)}
      testID={`profile-${row.id}`}
    />
  )
}

const styles = StyleSheet.create(theme => ({
  screen: { flex: 1, backgroundColor: theme.colors.surface0 },
  content: { paddingBottom: 40, gap: space.xl },
  contentWide: { ...pageFrame(true), maxWidth: 640 + space.gutterWide * 2 },
  contentNarrow: pageFrame(false),
  person: { flexDirection: 'row', alignItems: 'center', gap: space.roomy },
  personWords: { flex: 1, minWidth: 0, gap: 3 },
  name: serif(theme.colors, 'page'),
  line: lineSub(theme.colors),
  // A big card (`S2`: 22 round) on the ground, told apart by tone.
  month: { ...card(theme.colors, radius.cardLg), padding: space.card, gap: space.roomy },
  monthHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  monthTitle: label(theme.colors),
  monthLink: { color: theme.colors.accent, fontSize: type.sub, fontWeight: '600' },
  figures: { flexDirection: 'row', gap: space.md },
  repeat: { flexDirection: 'row', alignItems: 'center', gap: space.snug },
}))
