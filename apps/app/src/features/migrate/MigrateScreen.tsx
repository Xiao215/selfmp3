import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  ActivityIndicator,
  Image,
  Linking,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useRouter } from 'expo-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { formatDuration, type MigrateParseResult } from '@selfmp3/shared'
import {
  clientApi,
  oklchToHexAlpha,
  queryKeys,
  radius,
  useImportTools,
  useLibrary,
  useMigrateJob,
} from '@selfmp3/client'
import { useConnection } from '../../server/ConnectionProvider'
import { useLayout } from '../../shell/useLayout'
import { useAccent } from '../../ui/accent'
import { BackRow, useBackTo } from '../../ui/components/BackRow'
import { Button } from '../../ui/components/Button'
import { Checkbox } from '../../ui/components/Checkbox'
import { IconButton } from '../../ui/components/IconButton'
import { Download, X } from '../../ui/components/Icons'
import { SafeAreaView } from '../../ui/components/SafeAreaView'
import { Select } from '../../ui/components/Select'
import { TagChooser } from '../../ui/components/TagChooser'
import {
  chosenRows,
  confidenceLevel,
  enqueueRequest,
  importSongsLabel,
  initialChosen,
  matchedHeading,
  matchedIndexes,
  matchingHeading,
  migrateRows,
  pendingNote,
  percent,
  PLACEHOLDER,
  queuedMessage,
  skippedNote,
  stageOf,
  type ConfidenceTone,
  type MigrateRow,
} from './migrate.model'

/** The web's confidence pills, in its own OKLCH values: ground, edge. */
const TONE_FILL: Record<ConfidenceTone, [string, string]> = {
  good: [oklchToHexAlpha(0.36, 0.08, 155, 0.45), oklchToHexAlpha(0.5, 0.1, 155, 0.55)],
  fair: [oklchToHexAlpha(0.36, 0.09, 78, 0.5), oklchToHexAlpha(0.5, 0.11, 78, 0.55)],
  poor: [oklchToHexAlpha(0.34, 0.09, 22, 0.45), oklchToHexAlpha(0.5, 0.12, 22, 0.55)],
}

/**
 * Migrating a playlist from Spotify, Apple Music or a text file: the web's
 * `MigrateView`.
 *
 * Paste, match, review. Each song is matched to a YouTube upload by a server
 * job this polls; the matches are checked here, with a different upload a pick
 * away, and the ticked ones go through the normal import queue.
 */
export function MigrateScreen(): ReactNode {
  const { theme } = useUnistyles()
  const accent = useAccent()
  const router = useRouter()
  const backTo = useBackTo()
  const { wide } = useLayout()
  const { fromCloud } = useConnection()
  const queryClient = useQueryClient()
  const { data: library } = useLibrary()
  const { data: tools } = useImportTools()

  const [text, setText] = useState('')
  const [parsed, setParsed] = useState<MigrateParseResult | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ count: number; playlistId: number | null } | null>(null)
  const [chosen, setChosen] = useState<ReadonlySet<number>>(() => new Set())
  const [picked, setPicked] = useState<ReadonlyMap<number, number>>(() => new Map())
  const [tagIds, setTagIds] = useState<ReadonlySet<number>>(() => new Set())
  const [playlistName, setPlaylistName] = useState('')

  const { data: job } = useMigrateJob(jobId)
  const stage = stageOf(job)
  const rows = useMemo(() => migrateRows(job, picked), [job, picked])
  const tags = library?.tags ?? []

  // Tick the rows worth importing once per finished job, so a poll arriving
  // after something was unticked does not tick it again. Adjusted while
  // rendering rather than in an effect, which would draw the unticked table first.
  const [tickedFor, setTickedFor] = useState<string | null>(null)
  if (job && job.status !== 'running' && tickedFor !== job.id) {
    setTickedFor(job.id)
    setChosen(initialChosen(job))
  }

  const parse = useMutation({
    mutationFn: async (input: string) => {
      const result = await clientApi().migrateParse(input)
      setParsed(result)
      setPlaylistName(result.playlistName ?? '')
      const started = await clientApi().migrateMatch(result.tracks)
      return started.id
    },
    onSuccess: id => {
      setError(null)
      setJobId(id)
    },
    onError: (err: Error) => setError(err.message),
  })

  const enqueue = useMutation({
    mutationFn: () =>
      clientApi().migrateEnqueue(enqueueRequest(rows, chosen, { tagIds, playlistName })),
    onSuccess: result => {
      setDone({ count: result.jobs.length, playlistId: result.playlistId })
      void queryClient.invalidateQueries({ queryKey: queryKeys.importQueue })
      void queryClient.invalidateQueries({ queryKey: queryKeys.library })
    },
    onError: (err: Error) => setError(err.message),
  })

  const reset = (): void => {
    setJobId(null)
    setParsed(null)
    setDone(null)
    setChosen(new Set())
    setPicked(new Map())
    setTickedFor(null)
    setError(null)
  }

  const toggle = (index: number): void =>
    setChosen(current => {
      const next = new Set(current)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })

  const selected = chosenRows(rows, chosen).length
  const skipped = skippedNote(parsed)
  const pending = job ? pendingNote(job, rows) : null

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView
        contentContainerStyle={[styles.content, wide ? styles.contentWide : styles.contentNarrow]}
        keyboardShouldPersistTaps="handled"
        testID="migrate-screen"
      >
        <BackRow label="Import" href="/import" testID="back-to-import" />
        <Text style={[styles.heading, !wide && styles.headingNarrow]} accessibilityRole="header">
          Migrate a playlist
        </Text>
        <Text style={styles.sub}>
          Bring a playlist over from Spotify, Apple Music or anywhere else. Each song is matched to
          a YouTube upload, you check the matches, then they import as usual.
        </Text>

        {fromCloud ? (
          <View style={styles.notice}>
            <Text style={styles.noticeText}>
              Migrating into a cloud library needs a connection to your server for now.
            </Text>
          </View>
        ) : null}

        {error ? (
          <View style={[styles.notice, styles.noticeError]} accessibilityRole="alert">
            <Text style={styles.noticeText}>{error}</Text>
            <IconButton onPress={() => setError(null)} label="Dismiss">
              <X size={15} color={theme.colors.textMuted} />
            </IconButton>
          </View>
        ) : null}

        {done ? (
          <View style={[styles.notice, styles.noticeGood]} testID="migrate-done">
            <Text style={styles.noticeText}>
              <Text style={styles.strong}>{queuedMessage(done.count)}</Text> Watch progress on the{' '}
              <Text
                style={[styles.linkText, { color: accent.accent }]}
                onPress={() => backTo('/import')}
                accessibilityRole="link"
              >
                Import page
              </Text>
              {done.playlistId !== null ? (
                <>
                  {' — they will land in '}
                  <Text
                    style={[styles.linkText, { color: accent.accent }]}
                    onPress={() => router.push(`/playlists/${done.playlistId}`)}
                    accessibilityRole="link"
                  >
                    {playlistName.trim()}
                  </Text>
                </>
              ) : null}
              .
            </Text>
            <Button label="Migrate another" onPress={reset} />
          </View>
        ) : stage === 'input' ? (
          <>
            <View style={[styles.form, !wide && styles.formNarrow]}>
              <TextInput
                style={[styles.textInput, wide && styles.textInputWide]}
                value={text}
                onChangeText={setText}
                placeholder={PLACEHOLDER}
                placeholderTextColor={theme.colors.textMuted}
                multiline
                autoCorrect={false}
                spellCheck={false}
                accessibilityLabel="Songs to migrate"
              />
              <Button
                label={parse.isPending ? 'Reading…' : 'Find matches'}
                variant="primary"
                grow={!wide}
                disabled={parse.isPending || !text.trim() || tools?.ytdlp === false || fromCloud}
                onPress={() => {
                  if (text.trim()) parse.mutate(text)
                }}
              />
            </View>
            <Text style={styles.hint}>
              One song per line — <Text style={styles.code}>Artist - Title</Text>,{' '}
              <Text style={styles.code}>Title by Artist</Text> or just a title. Or paste a whole
              CSV: from Spotify use{' '}
              <Text
                style={[styles.linkText, { color: accent.accent }]}
                onPress={() => void Linking.openURL('https://exportify.net')}
                accessibilityRole="link"
              >
                exportify.net
              </Text>{' '}
              (log in, pick the playlist, Export); from Apple Music use File → Library → Export
              Playlist; TuneMyMusic exports work too. A public Spotify playlist link is read
              directly when Spotify allows it.
            </Text>
          </>
        ) : (
          <View style={styles.review} testID="migrate-review">
            <View style={styles.reviewHead}>
              <View style={styles.reviewTitleRow}>
                {stage === 'matching' ? (
                  <ActivityIndicator size="small" color={accent.accent} />
                ) : null}
                <Text style={styles.reviewTitle} accessibilityRole="header">
                  {stage === 'matching' && job ? matchingHeading(job) : matchedHeading(rows)}
                  {stage === 'review' && job?.status === 'cancelled' ? (
                    <Text style={styles.hint}> · stopped early</Text>
                  ) : null}
                </Text>
              </View>
              <View style={styles.reviewActions}>
                {stage === 'matching' ? (
                  <Text
                    style={[styles.linkText, { color: accent.accent }]}
                    onPress={() => {
                      if (jobId)
                        void clientApi()
                          .cancelMigrateJob(jobId)
                          .catch(() => undefined)
                    }}
                    accessibilityRole="button"
                  >
                    stop
                  </Text>
                ) : (
                  <>
                    <Text style={styles.hint}>{selected} selected</Text>
                    <Text
                      style={[styles.linkText, { color: accent.accent }]}
                      onPress={() => setChosen(matchedIndexes(rows))}
                      accessibilityRole="button"
                    >
                      select all
                    </Text>
                    <Text
                      style={[styles.linkText, { color: accent.accent }]}
                      onPress={() => setChosen(new Set())}
                      accessibilityRole="button"
                    >
                      select none
                    </Text>
                  </>
                )}
              </View>
            </View>

            {stage === 'matching' && job ? (
              <View style={styles.progress}>
                <View
                  style={[
                    styles.progressBar,
                    {
                      backgroundColor: accent.accent,
                      width: `${job.total ? (job.completed / job.total) * 100 : 0}%`,
                    },
                  ]}
                />
              </View>
            ) : null}

            {skipped ? <Text style={[styles.hint, styles.skipped]}>{skipped}</Text> : null}

            {stage === 'review' ? (
              <View style={styles.legend}>
                {(['good', 'fair', 'poor'] as const).map(tone => {
                  const level = confidenceLevel(tone === 'good' ? 1 : tone === 'fair' ? 0.6 : 0)
                  return (
                    <ConfidencePill key={tone} tone={tone} text={`${level.mark} ${level.word}`} />
                  )
                })}
                <Text style={[styles.hint, styles.legendHint]}>
                  Strong matches are ticked for you. Check the likely ones, and pick a different
                  upload from the dropdown where the match is wrong.
                </Text>
              </View>
            ) : null}

            <View
              style={styles.table}
              accessibilityRole="list"
              accessibilityLabel="Songs and their matches"
            >
              {wide ? (
                <View style={[styles.tableRow, styles.tableHead]}>
                  <View style={styles.colCheck} />
                  <Text style={[styles.headLabel, styles.colSource]}>Source</Text>
                  <Text style={[styles.headLabel, styles.colMatch]}>Match on YouTube</Text>
                  <Text style={[styles.headLabel, styles.colConf, styles.right]}>Confidence</Text>
                </View>
              ) : null}
              {rows.map((row, position) => (
                <MatchRow
                  key={row.index}
                  row={row}
                  wide={wide}
                  last={position === rows.length - 1 && !pending}
                  checked={chosen.has(row.index)}
                  onToggle={() => toggle(row.index)}
                  onPick={index => setPicked(current => new Map(current).set(row.index, index))}
                />
              ))}
              {pending ? (
                <View style={styles.pendingRow}>
                  <Text style={styles.hint}>{pending}</Text>
                </View>
              ) : null}
            </View>

            {stage === 'review' ? (
              <>
                <View style={styles.options}>
                  <View style={styles.option}>
                    <Text style={styles.fieldLabel}>Tag these as</Text>
                    <TagChooser tags={tags} selected={tagIds} onChange={setTagIds} />
                  </View>
                  <View style={styles.option}>
                    <Text style={styles.fieldLabel}>Create playlist named</Text>
                    <TextInput
                      style={styles.nameInput}
                      value={playlistName}
                      onChangeText={setPlaylistName}
                      placeholder="Leave empty to skip"
                      placeholderTextColor={theme.colors.textMuted}
                      accessibilityLabel="Create playlist named"
                    />
                  </View>
                </View>
                <View style={styles.submit}>
                  <Button
                    label={importSongsLabel(selected)}
                    icon={<Download size={16} color={accent.onAccent} />}
                    variant="primary"
                    disabled={selected === 0 || enqueue.isPending}
                    onPress={() => enqueue.mutate()}
                  />
                  <Button label="Start over" onPress={reset} />
                </View>
              </>
            ) : null}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

function ConfidencePill({
  tone,
  text,
  label,
}: {
  tone: ConfidenceTone
  text: string
  label?: string
}): ReactNode {
  const { theme } = useUnistyles()
  const [ground, edge] = TONE_FILL[tone]
  const ink =
    tone === 'good'
      ? theme.colors.good
      : tone === 'fair'
        ? theme.colors.warning
        : theme.colors.danger
  return (
    <View
      style={[styles.pill, { backgroundColor: ground, borderColor: edge }]}
      accessible={label !== undefined}
      accessibilityLabel={label}
    >
      <Text style={[styles.pillText, { color: ink }]}>{text}</Text>
    </View>
  )
}

/** One song: the web's `.migrate-row`. A table row at desktop width; stacked on a phone. */
function MatchRow({
  row,
  wide,
  last,
  checked,
  onToggle,
  onPick,
}: {
  row: MigrateRow
  wide: boolean
  last: boolean
  checked: boolean
  onToggle: () => void
  onPick: (index: number) => void
}): ReactNode {
  const accent = useAccent()
  const { item, match } = row
  const [thumbFailed, setThumbFailed] = useState(false)
  const level = confidenceLevel(match?.confidence ?? 0)

  const check = (
    <Pressable
      onPress={onToggle}
      disabled={!match}
      hitSlop={12}
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled: !match }}
      accessibilityLabel={`Import ${item.source.title}`}
      style={styles.colCheck}
    >
      <Checkbox checked={checked} />
    </Pressable>
  )

  const source = (
    <View style={[styles.source, item.alreadyHave && styles.faded]}>
      <Text style={styles.title} numberOfLines={2}>
        {item.source.title}
      </Text>
      <Text style={styles.subText} numberOfLines={1}>
        {item.source.artist || 'Unknown artist'}
        {item.source.duration > 0 ? ` · ${formatDuration(item.source.duration)}` : ''}
      </Text>
      {item.alreadyHave ? (
        <View style={styles.dup}>
          <Text style={styles.dupText}>IN YOUR LIBRARY</Text>
        </View>
      ) : null}
    </View>
  )

  const matchCell = match ? (
    <View style={[styles.matchInner, item.alreadyHave && styles.faded]}>
      {wide ? (
        match.thumbnail && !thumbFailed ? (
          <Image
            source={{ uri: match.thumbnail }}
            style={styles.thumb}
            onError={() => setThumbFailed(true)}
          />
        ) : (
          <View style={styles.thumb} />
        )
      ) : null}
      <View style={styles.matchText}>
        <View style={styles.pick}>
          <Select<number>
            value={item.candidates.indexOf(match)}
            onChange={onPick}
            options={item.candidates.map((candidate, index) => ({
              value: index,
              label: candidate.title,
              hint: percent(candidate.confidence),
            }))}
            label="Choose a different match"
            size="small"
          />
        </View>
        <Text style={styles.subText} numberOfLines={1}>
          {match.channel || 'Unknown channel'}
          {match.duration > 0 ? ` · ${formatDuration(match.duration)}` : ''}
        </Text>
      </View>
    </View>
  ) : (
    <Text style={styles.subText}>{item.error ?? 'No results'}</Text>
  )

  const pill = match ? (
    <ConfidencePill
      tone={level.tone}
      text={`${level.mark} ${percent(match.confidence)}`}
      label={`${percent(match.confidence)} confident, ${level.word.toLowerCase()} match`}
    />
  ) : null

  const rowStyle = [
    styles.tableRow,
    !last && styles.rowDivided,
    checked && styles.rowChosen,
    checked && wide && { borderLeftColor: accent.accent },
  ]

  if (wide) {
    return (
      <View style={rowStyle}>
        {check}
        <View style={styles.colSource}>{source}</View>
        <View style={styles.colMatch}>{matchCell}</View>
        <View style={[styles.colConf, styles.confCell]}>{pill}</View>
      </View>
    )
  }

  return (
    <View style={[rowStyle, styles.rowNarrow]}>
      {check}
      <View style={styles.narrowBody}>
        <View style={styles.narrowTop}>
          <View style={styles.narrowSource}>{source}</View>
          {pill}
        </View>
        {matchCell}
      </View>
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  screen: { flex: 1, backgroundColor: theme.colors.surface0 },
  content: { paddingBottom: 40 },
  contentWide: { paddingTop: 28, paddingHorizontal: 32 },
  contentNarrow: { paddingTop: 18, paddingHorizontal: 16 },
  heading: { color: theme.colors.textPrimary, fontSize: 26, fontWeight: '700' },
  headingNarrow: { fontSize: 22 },
  sub: {
    color: theme.colors.textMuted,
    fontSize: 13,
    marginTop: 6,
    marginBottom: 20,
    lineHeight: 19,
  },
  strong: { color: theme.colors.textPrimary, fontWeight: '600' },
  hint: { color: theme.colors.textMuted, fontSize: 12, lineHeight: 17 },
  code: { color: theme.colors.textSecondary, backgroundColor: theme.colors.surface2, fontSize: 11 },
  linkText: { fontSize: 12, textDecorationLine: 'underline' },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: radius.sm,
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  noticeError: { borderColor: theme.colors.danger, paddingRight: 4 },
  noticeGood: { borderColor: theme.colors.good, flexWrap: 'wrap' },
  noticeText: {
    flex: 1,
    minWidth: 200,
    color: theme.colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
  },
  form: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 8 },
  formNarrow: { flexDirection: 'column', alignItems: 'stretch' },
  textInput: {
    minHeight: 150,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: theme.colors.textPrimary,
    fontSize: 13,
    lineHeight: 19,
    textAlignVertical: 'top',
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: radius.sm,
  },
  textInputWide: { flex: 1 },
  review: {
    padding: 18,
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: radius.md,
  },
  reviewHead: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 12,
  },
  reviewTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  reviewTitle: { color: theme.colors.textPrimary, fontSize: 15, fontWeight: '600' },
  reviewActions: { flexDirection: 'row', alignItems: 'baseline', gap: 12 },
  progress: {
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: 14,
    backgroundColor: theme.colors.surface3,
  },
  progressBar: { height: 4, borderRadius: 2 },
  skipped: { marginBottom: 10 },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  legendHint: { flex: 1, minWidth: 220 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 3,
    paddingHorizontal: 9,
    borderRadius: 999,
    borderWidth: 1,
  },
  pillText: { fontSize: 12, fontWeight: '600', fontVariant: ['tabular-nums'] },
  table: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: theme.colors.surface0,
    borderLeftWidth: 2,
    borderLeftColor: 'transparent',
  },
  tableHead: {
    backgroundColor: theme.colors.surface2,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  rowDivided: { borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  rowChosen: { backgroundColor: theme.colors.surface1 },
  rowNarrow: { alignItems: 'flex-start' },
  headLabel: {
    color: theme.colors.textMuted,
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  right: { textAlign: 'right' },
  colCheck: { width: 30, alignItems: 'center', paddingTop: 2 },
  colSource: { flex: 1, minWidth: 170 },
  colMatch: { flex: 1.7, minWidth: 240 },
  colConf: { width: 104 },
  confCell: { alignItems: 'flex-end' },
  source: { gap: 2, alignItems: 'flex-start' },
  title: { color: theme.colors.textPrimary, fontSize: 13, fontWeight: '500' },
  subText: { color: theme.colors.textMuted, fontSize: 12 },
  faded: { opacity: 0.65 },
  dup: {
    marginTop: 3,
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 4,
    backgroundColor: theme.colors.surface3,
  },
  dupText: { color: theme.colors.textMuted, fontSize: 10, fontWeight: '600', letterSpacing: 0.4 },
  matchInner: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  thumb: { width: 54, height: 40, borderRadius: radius.sm, backgroundColor: theme.colors.surface2 },
  matchText: { flex: 1, minWidth: 0, gap: 3 },
  pick: { maxWidth: 420 },
  pendingRow: { padding: 14, alignItems: 'center', backgroundColor: theme.colors.surface0 },
  narrowBody: { flex: 1, minWidth: 0, gap: 8 },
  narrowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  narrowSource: { flex: 1, minWidth: 0 },
  options: {
    gap: 14,
    marginTop: 18,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  option: { gap: 7 },
  fieldLabel: { color: theme.colors.textSecondary, fontSize: 12, fontWeight: '500' },
  nameInput: {
    maxWidth: 360,
    minHeight: 36,
    paddingHorizontal: 10,
    color: theme.colors.textPrimary,
    fontSize: 13,
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: radius.sm,
  },
  submit: { flexDirection: 'row', gap: 10, marginTop: 18 },
}))
