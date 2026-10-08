import { ChromeSpacer } from '../../shell/ChromeSpacer'
import type { ReactNode } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useRouter } from 'expo-router'
import type { Stats } from '@selfmp3/shared'
import { leading, radius, space, type, useLibrary, type ServerConnection } from '@selfmp3/client'
import { useLayout } from '../../shell/useLayout'
import { BackButton } from '../../ui/components/BackButton'
import { ChevronRight, Download, Settings, Sparkles } from '../../ui/components/Icons'
import { SafeAreaView } from '../../ui/components/SafeAreaView'
import { useArt } from '../../offline/useArt'
import { Avatar } from '../../ui/components/Avatar'
import { useAccount } from './useAccount'
import { deviceKind } from '../../ports/device'
import { card, label, serif } from '../../ui/surfaces'
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
    <Pressable
      onPress={() => router.push('/stats')}
      accessibilityRole="link"
      accessibilityLabel={monthCardSpoken(month)}
      testID="profile-stats"
      style={({ pressed }) => [styles.month, pressed && styles.monthPressed]}
    >
      <View style={styles.monthHead}>
        <Text style={styles.monthTitle}>{MONTH_CARD_TITLE}</Text>
        <Text style={styles.monthLink}>Stats</Text>
      </View>
      {month ? (
        <>
          <View style={styles.figures}>
            <Figure value={month.listened} unit={month.listenedUnit} label="listened" />
            <Figure value={month.plays} label="plays" />
            <Figure value={month.streak} unit={month.streakUnit} label="streak" />
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
    </Pressable>
  )
}

function Figure({
  value,
  unit,
  label,
}: {
  value: string
  unit?: string
  label: string
}): ReactNode {
  return (
    <View style={styles.figure}>
      <Text style={styles.figureValue} numberOfLines={1}>
        {value}
        {unit ? <Text style={styles.figureUnit}> {unit}</Text> : null}
      </Text>
      <Text style={styles.figureLabel}>{label}</Text>
    </View>
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
  const { theme } = useUnistyles()
  const router = useRouter()
  const Icon = ICONS[row.id]

  return (
    <Pressable
      onPress={() => router.push(row.href)}
      accessibilityRole="link"
      accessibilityLabel={`${row.label}, ${row.hint}`}
      testID={`profile-${row.id}`}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <View style={styles.rowIcon}>
        <Icon size={19} tone="textPrimary" />
      </View>
      <View style={styles.rowWords}>
        <Text style={styles.rowLabel} numberOfLines={1}>
          {row.label}
        </Text>
        <Text style={styles.rowHint} numberOfLines={1}>
          {row.hint}
        </Text>
      </View>
      <ChevronRight size={16} color={theme.colors.textMuted} />
    </Pressable>
  )
}

const styles = StyleSheet.create(theme => ({
  screen: { flex: 1, backgroundColor: theme.colors.surface0 },
  content: { paddingBottom: 40, gap: 24 },
  contentWide: { paddingTop: 40, paddingHorizontal: 44, maxWidth: 640 + 88 },
  contentNarrow: { paddingTop: 16, paddingHorizontal: space.gutter },
  person: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  personWords: { flex: 1, minWidth: 0, gap: 3 },
  name: { ...serif(theme.colors, type.page), lineHeight: 34 },
  line: { color: theme.colors.textSecondary, fontSize: type.sub, lineHeight: leading.sub },
  // A big card (`S2`: 22 round) on the ground, told apart by tone.
  month: { ...card(theme.colors, radius.cardLg), padding: 18, gap: 14 },
  monthPressed: { opacity: 0.85 },
  monthHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  monthTitle: label(theme.colors),
  monthLink: { color: theme.colors.accent, fontSize: type.sub, fontWeight: '600' },
  figures: { flexDirection: 'row', gap: 12 },
  figure: { flex: 1, minWidth: 0, gap: 2 },
  figureValue: { ...serif(theme.colors, type.page), lineHeight: 34 },
  figureUnit: { fontSize: type.section },
  figureLabel: { color: theme.colors.textSecondary, fontSize: type.small },
  repeat: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 60 },
  rowPressed: { opacity: 0.6 },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surface2,
  },
  rowWords: { flex: 1, minWidth: 0, gap: 2 },
  rowLabel: { color: theme.colors.textPrimary, fontSize: type.body, fontWeight: '600' },
  rowHint: { color: theme.colors.textSecondary, fontSize: type.small },
}))
