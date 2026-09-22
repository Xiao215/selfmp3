import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { formatDuration, type MetadataCandidate, type Song } from '@selfmp3/shared'
import { oklchToHexAlpha, radius, type ServerConnection } from '@selfmp3/client'
import { useMetadataSource } from './metadataSource'
import {
  applyInput,
  applyLabel,
  appliedCount,
  candidateLine,
  defaultTicked,
  diffFields,
  diffLabel,
  FIELD_LABELS,
  scorePercent,
  shown,
  SOURCE_LABELS,
  type Field,
} from './metadata.model'
import { useArt } from '../../offline/useArt'
import { useOverlay } from '../../shell/Overlay'
import { useEscape } from '../../shell/useEscape'
import { useLayout } from '../../shell/useLayout'
import { useAccent } from '../../ui/accent'
import { floating, label as groupLabel, sectionTitle } from '../../ui/surfaces'
import { Button } from '../../ui/components/Button'
import { Checkbox } from '../../ui/components/Checkbox'
import { Cover } from '../../ui/components/Cover'
import { IconButton } from '../../ui/components/IconButton'
import { Check, X } from '../../ui/components/Icons'

/** The sources' badges, as an OKLCH pair: ground, ink. */
const SOURCE_TONE: Record<MetadataCandidate['source'], [string, string]> = {
  itunes: [oklchToHexAlpha(0.36, 0.09, 340, 0.5), oklchToHexAlpha(0.85, 0.1, 340, 1)],
  musicbrainz: [oklchToHexAlpha(0.36, 0.09, 40, 0.5), oklchToHexAlpha(0.85, 0.1, 40, 1)],
}

/**
 * "Fix metadata…". The song as the library has it on one side, suggestions
 * from iTunes and MusicBrainz on the other, and the changes a suggestion
 * would make, each ticked or not, so exactly the corrections agreed with are
 * applied.
 *
 * Centred at desktop width; the whole screen on a phone.
 *
 * `via` is a server reached directly from a cloud library (FixMetadata), and
 * `askFor` the song's id in that server's numbering. Without them the library
 * this device already talks to answers, and `askFor` is the song's own id.
 */
export function MetadataDialog({
  song,
  askFor,
  via,
  onClose,
}: {
  song: Song
  askFor: number
  via?: ServerConnection
  onClose: () => void
}): ReactNode {
  const { theme } = useUnistyles()
  const accent = useAccent()
  const artFor = useArt()
  const { wide } = useLayout()
  // Full screen on a phone, so the head clears the status bar and the foot the home bar.
  const insets = useSafeAreaInsets()
  const { lookup, apply } = useMetadataSource(via, askFor)
  useEscape(true, onClose, { layer: true })

  const candidates = lookup.data?.candidates ?? []
  const [selectedIndex, setSelectedIndex] = useState(0)
  const selected = candidates[selectedIndex]
  const diffs = useMemo(() => (selected ? diffFields(song, selected) : []), [song, selected])

  // What a suggestion corrects starts ticked, afresh for each suggestion picked.
  const [picked, setPicked] = useState<{ index: number; fields: ReadonlySet<Field> } | null>(null)
  const ticked = picked?.index === selectedIndex ? picked.fields : defaultTicked(song, diffs)
  const setTicked = (fields: ReadonlySet<Field>): void =>
    setPicked({ index: selectedIndex, fields })
  const toggle = (field: Field): void => {
    const next = new Set(ticked)
    if (next.has(field)) next.delete(field)
    else next.add(field)
    setTicked(next)
  }

  const count = appliedCount(diffs, ticked)
  const submit = (): void => {
    const input = applyInput(diffs, ticked)
    if (input) apply.mutate(input, { onSuccess: onClose })
  }

  const current = (
    <View style={[styles.current, wide ? styles.currentWide : styles.currentNarrow]}>
      <Text style={[styles.groupTitle, !wide && styles.fullRow]}>IN YOUR LIBRARY</Text>
      <Cover uri={artFor(song)} title={song.album || song.title} size={wide ? 120 : 96} />
      <View style={[styles.fields, wide && styles.fieldsWide]}>
        {(
          [
            ['Title', song.title],
            ['Artist', shown(song.artist)],
            ['Album', shown(song.album)],
            ['Album artist', shown(song.albumArtist)],
            ['Year', shown(song.year)],
            ['Track №', shown(song.trackNo)],
            ['Length', song.duration ? formatDuration(song.duration) : '—'],
          ] as const
        ).map(([label, value]) => (
          <View key={label} style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>{label}</Text>
            <Text style={styles.fieldValue}>{value}</Text>
          </View>
        ))}
      </View>
    </View>
  )

  const suggestions = (
    <View style={[styles.candidates, wide && styles.candidatesWide]}>
      <View style={styles.sectionHead}>
        <Text style={styles.groupTitle}>SUGGESTIONS</Text>
        {candidates.length > 0 ? <Pill text={String(candidates.length)} /> : null}
        {lookup.isPending ? <ActivityIndicator size="small" color={accent.accent} /> : null}
      </View>

      {lookup.isError ? (
        <Text style={[styles.hint, { color: theme.colors.danger }]}>
          Couldn’t reach the lookup services.
        </Text>
      ) : null}
      {lookup.isSuccess && candidates.length === 0 ? (
        <Text style={styles.hint}>
          Nothing matched on iTunes or MusicBrainz. Try correcting the title or artist by hand first
          — the lookup uses them as the search.
        </Text>
      ) : null}

      <View role="radiogroup" accessibilityLabel="Candidates" style={styles.list}>
        {candidates.map((candidate, index) => {
          const active = index === selectedIndex
          const [ground, ink] = SOURCE_TONE[candidate.source]
          return (
            <Pressable
              key={`${candidate.source}-${index}`}
              onPress={() => setSelectedIndex(index)}
              accessibilityRole="radio"
              accessibilityState={{ checked: active }}
              accessibilityLabel={`${candidate.title}, ${candidateLine(candidate, formatDuration)}, ${SOURCE_LABELS[candidate.source]}, ${scorePercent(candidate.score)}`}
              style={({ pressed }) => [
                styles.candidate,
                pressed && styles.candidatePressed,
                active && styles.candidateActive,
              ]}
            >
              <Cover
                uri={candidate.artworkUrl ?? null}
                title={candidate.album || candidate.title}
                size={48}
              />
              <View style={styles.candidateMain}>
                <Text style={[styles.candidateTitle, active && styles.strong]} numberOfLines={1}>
                  {candidate.title}
                </Text>
                <Text style={styles.candidateSub} numberOfLines={1}>
                  {candidateLine(candidate, formatDuration)}
                </Text>
              </View>
              <View style={styles.candidateMeta}>
                <View style={[styles.badge, { backgroundColor: ground }]}>
                  <Text style={[styles.badgeText, { color: ink }]}>
                    {SOURCE_LABELS[candidate.source].toUpperCase()}
                  </Text>
                </View>
                <Text style={styles.score}>{scorePercent(candidate.score)}</Text>
              </View>
            </Pressable>
          )
        })}
      </View>

      {selected ? (
        <View style={styles.diff}>
          {diffs.length === 0 ? (
            <Text style={styles.hint}>This suggestion matches what you already have.</Text>
          ) : (
            <>
              <View style={styles.diffHead}>
                <View style={styles.sectionHead}>
                  <Text style={styles.groupTitle}>CHANGES TO APPLY</Text>
                  <Pill text={`${count} of ${diffs.length}`} />
                </View>
                <View style={styles.diffActions}>
                  <Text
                    style={[styles.link, { color: accent.accent }]}
                    onPress={() => setTicked(new Set(diffs.map(diff => diff.field)))}
                    accessibilityRole="button"
                  >
                    select all
                  </Text>
                  <Text
                    style={[styles.link, { color: accent.accent }]}
                    onPress={() => setTicked(new Set())}
                    accessibilityRole="button"
                  >
                    select none
                  </Text>
                </View>
              </View>
              {diffs.map(diff => (
                <Pressable
                  key={diff.field}
                  onPress={() => toggle(diff.field)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: ticked.has(diff.field) }}
                  accessibilityLabel={diffLabel(diff, song.hasArt)}
                  style={({ pressed }) => [
                    styles.diffRow,
                    !wide && styles.diffRowNarrow,
                    pressed && styles.diffPressed,
                  ]}
                >
                  <Checkbox checked={ticked.has(diff.field)} />
                  <View style={wide ? styles.diffBodyWide : styles.diffBodyNarrow}>
                    <Text
                      style={[
                        styles.diffLabel,
                        wide ? styles.diffLabelWide : styles.diffLabelNarrow,
                      ]}
                    >
                      {wide ? FIELD_LABELS[diff.field] : FIELD_LABELS[diff.field].toUpperCase()}
                    </Text>
                    {diff.field === 'artwork' ? (
                      <View style={styles.coverChange}>
                        {song.hasArt ? (
                          <Cover uri={artFor(song)} title={song.album || song.title} size={44} />
                        ) : (
                          <Text style={styles.hint}>No cover</Text>
                        )}
                        <Text style={styles.arrow}>→</Text>
                        <Cover
                          uri={String(diff.value)}
                          title={song.album || song.title}
                          size={44}
                        />
                        <Text style={styles.hint}>{diff.proposed}</Text>
                      </View>
                    ) : (
                      <Text style={[styles.values, !wide && styles.valuesNarrow]}>
                        {diff.current !== '—' ? (
                          <>
                            <Text style={styles.old}>{diff.current}</Text>
                            <Text style={styles.arrow}> → </Text>
                          </>
                        ) : null}
                        <Text style={styles.new}>{diff.proposed}</Text>
                      </Text>
                    )}
                  </View>
                </Pressable>
              ))}
            </>
          )}
        </View>
      ) : null}
    </View>
  )

  useOverlay(
    <View
      style={[
        styles.backdrop,
        !wide && styles.backdropNarrow,
        { backgroundColor: oklchToHexAlpha(0.1, 0.02, accent.hue, 0.6) },
      ]}
    >
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
      <View
        style={[styles.dialog, wide ? styles.dialogWide : styles.dialogNarrow]}
        role="dialog"
        aria-modal
        accessibilityLabel="Fix metadata"
        accessibilityViewIsModal
        testID="metadata-dialog"
      >
        <View style={[styles.head, !wide && { paddingTop: 14 + insets.top }]}>
          <Text style={styles.title} accessibilityRole="header">
            Fix metadata
          </Text>
          <IconButton onPress={onClose} label="Close">
            <X size={16} color={theme.colors.textSecondary} />
          </IconButton>
        </View>

        {wide ? (
          <View style={styles.bodyWide}>
            <ScrollView style={styles.currentScroll}>{current}</ScrollView>
            <ScrollView style={styles.candidatesScroll}>{suggestions}</ScrollView>
          </View>
        ) : (
          <ScrollView style={styles.bodyNarrow}>
            {current}
            {suggestions}
          </ScrollView>
        )}

        <View
          style={[styles.foot, !wide && [styles.footNarrow, { paddingBottom: 12 + insets.bottom }]]}
        >
          {apply.isError ? (
            <Text style={[styles.hint, styles.footError, { color: theme.colors.warning }]}>
              {apply.error?.message ?? 'Couldn’t apply the changes.'}
            </Text>
          ) : via ? (
            // Written into the server's library, which this device sees with
            // the next sync rather than the moment the dialog closes.
            <Text style={[styles.hint, styles.footError]}>
              Applied on your server; here with its next sync.
            </Text>
          ) : null}
          <Button label="Cancel" onPress={onClose} />
          <Button
            label={applyLabel(count, apply.isPending)}
            variant="primary"
            icon={<Check size={15} color={accent.onAccent} />}
            disabled={count === 0 || apply.isPending}
            onPress={submit}
          />
        </View>
      </View>
    </View>,
    true,
  )

  return null
}

function Pill({ text }: { text: string }): ReactNode {
  return (
    <View style={styles.pill}>
      <Text style={styles.pillText}>{text}</Text>
    </View>
  )
}

/** A remote thumbnail that quietly becomes an empty box when it will not load. */
const styles = StyleSheet.create(theme => ({
  backdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  backdropNarrow: { padding: 0, alignItems: 'stretch' },
  dialog: { backgroundColor: theme.colors.surface1, overflow: 'hidden' },
  dialogWide: {
    width: '100%',
    maxWidth: 880,
    maxHeight: 760,
    height: '86%',
    borderRadius: radius.sheet,
    ...floating(theme.colors),
  },
  dialogNarrow: { flex: 1 },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 14,
    paddingRight: 14,
    paddingBottom: 12,
    paddingLeft: 22,
  },
  title: sectionTitle(theme.colors),
  bodyWide: { flex: 1, minHeight: 0, flexDirection: 'row' },
  bodyNarrow: { flex: 1 },
  // The song as it is, a panel one step up from the dialog rather than a column behind a rule.
  currentScroll: {
    width: 240,
    flexGrow: 0,
    marginLeft: 12,
    marginBottom: 4,
    borderRadius: radius.card,
    backgroundColor: theme.colors.surface2,
  },
  candidatesScroll: { flex: 1 },
  current: { paddingVertical: 18, paddingHorizontal: 20, gap: 14 },
  currentWide: {},
  currentNarrow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: 16,
    rowGap: 0,
  },
  fullRow: { width: '100%', marginBottom: 12 },
  fields: { flex: 1, minWidth: 0, gap: 7 },
  fieldsWide: { flex: 0 },
  fieldRow: { flexDirection: 'row', gap: 12 },
  fieldLabel: { width: 84, color: theme.colors.textMuted, fontSize: 13 },
  fieldValue: { flex: 1, color: theme.colors.textPrimary, fontSize: 13 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  groupTitle: groupLabel(theme.colors),
  candidates: { paddingVertical: 18, paddingHorizontal: 20, gap: 12 },
  candidatesWide: {},
  hint: { color: theme.colors.textMuted, fontSize: 12, lineHeight: 17 },
  strong: { color: theme.colors.textPrimary },
  link: { fontSize: 12, textDecorationLine: 'underline' },
  list: { gap: 4 },
  candidate: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 14,
  },
  candidatePressed: { backgroundColor: theme.colors.surface2 },
  // The picked suggestion wears the palette's selected-row colour, not an accent edge.
  candidateActive: { backgroundColor: theme.colors.accentSelected },
  candidateMain: { flex: 1, minWidth: 0, gap: 2 },
  candidateTitle: { color: theme.colors.textSecondary, fontSize: 14, fontWeight: '500' },
  candidateSub: { color: theme.colors.textMuted, fontSize: 12 },
  candidateMeta: { alignItems: 'flex-end', gap: 4 },
  badge: { paddingVertical: 2, paddingHorizontal: 7, borderRadius: radius.pill },
  badgeText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  score: { color: theme.colors.textMuted, fontSize: 12, fontVariant: ['tabular-nums'] },
  // Space, not a rule, sets the changes apart from the suggestions.
  diff: { marginTop: 16, gap: 2 },
  diffHead: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 8,
  },
  diffActions: { flexDirection: 'row', gap: 12 },
  diffRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 7,
    paddingHorizontal: 8,
    borderRadius: 14,
  },
  diffRowNarrow: { alignItems: 'flex-start', paddingVertical: 9 },
  diffPressed: { backgroundColor: theme.colors.surface2 },
  diffBodyWide: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10 },
  diffBodyNarrow: { flex: 1, minWidth: 0, gap: 2 },
  diffLabel: { color: theme.colors.textMuted },
  diffLabelWide: { width: 92, fontSize: 13 },
  diffLabelNarrow: { fontSize: 11, fontWeight: '600', letterSpacing: 0.55 },
  values: { flex: 1, minWidth: 0, fontSize: 13, color: theme.colors.textSecondary },
  valuesNarrow: { fontSize: 14 },
  old: { color: theme.colors.textMuted, textDecorationLine: 'line-through' },
  arrow: { color: theme.colors.textMuted, fontSize: 12 },
  new: { color: theme.colors.textPrimary },
  coverChange: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 },
  pill: {
    paddingVertical: 1,
    paddingHorizontal: 7,
    borderRadius: radius.pill,
    backgroundColor: theme.colors.surface3,
  },
  pillText: {
    color: theme.colors.textSecondary,
    fontSize: 10,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  foot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  footNarrow: { flexWrap: 'wrap' },
  footError: { marginRight: 'auto' },
}))
