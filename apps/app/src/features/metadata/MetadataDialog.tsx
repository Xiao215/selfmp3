import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  formatDuration,
  type MetadataCandidate,
  type MetadataSuggestion,
  type Song,
} from '@selfmp3/shared'
import { failureText, oklchToHexAlpha, radius, type ServerConnection } from '@selfmp3/client'
import { useMetadataSource } from './metadataSource'
import { useMetadataSuggestion } from './useMetadataSuggestion'
import {
  applyInput,
  applyLabel,
  appliedCount,
  candidateLine,
  defaultTicked,
  diffFields,
  diffLabel,
  editable,
  FIELD_LABELS,
  handEdits,
  scorePercent,
  SOURCE_LABELS,
  type Edits,
  type Field,
  type TextField,
} from './metadata.model'
import { useArt } from '../../offline/useArt'
import { useLayout } from '../../shell/useLayout'
import { useAccent } from '../../ui/accent'
import { floating, label as groupLabel } from '../../ui/surfaces'
import { Button } from '../../ui/components/Button'
import { Checkbox } from '../../ui/components/Checkbox'
import { Cover } from '../../ui/components/Cover'
import { Dialog, DialogHead } from '../../ui/components/Dialog'
import { Check, Sparkle } from '../../ui/components/Icons'

/** A source's badge at one hue, as an OKLCH pair: ground, ink. */
const badgeTone = (hue: number): [string, string] => [
  oklchToHexAlpha(0.36, 0.09, hue, 0.5),
  oklchToHexAlpha(0.85, 0.1, hue, 1),
]

/** The sources' badges: each a hue, drawn the same way. */
const SOURCE_TONE: Record<MetadataCandidate['source'], [string, string]> = {
  itunes: badgeTone(340),
  musicbrainz: badgeTone(40),
  ai: badgeTone(280),
}

/** The song's own fields, in the order the panel lists them, and the keyboard each wants. */
const TEXT_FIELDS: readonly (readonly [TextField, 'default' | 'number-pad'])[] = [
  ['title', 'default'],
  ['artist', 'default'],
  ['album', 'default'],
  ['albumArtist', 'default'],
  ['year', 'number-pad'],
  ['trackNo', 'number-pad'],
]

/**
 * "Fix metadata…". The song as the library has it on one side, every field
 * a box to type into; suggestions from iTunes and MusicBrainz on the other,
 * and the changes a suggestion would make, each ticked or not, so exactly
 * the corrections agreed with are applied. What is typed by hand is applied
 * too, and wins over a ticked suggestion for the same field.
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
  const { lookup, apply } = useMetadataSource(via, askFor, song.id)

  const candidates = lookup.data?.candidates ?? []
  // The model's suggestion, when it has been asked for (`useMetadataSuggestion`).
  const suggest = useMetadataSuggestion(askFor)
  const suggested = suggest.ask.data?.suggestion ?? null
  // A listing by its place, or the Suggested card.
  const [selectedKey, setSelectedKey] = useState<number | 'ai'>(0)
  const selected = selectedKey === 'ai' ? (suggested ?? undefined) : candidates[selectedKey]
  const diffs = useMemo(() => (selected ? diffFields(song, selected) : []), [song, selected])
  const { mutate: askMutate } = suggest.ask
  const askSuggestion = useCallback(
    (again: boolean): void =>
      askMutate(again, {
        onSuccess: answer => {
          if (answer.suggestion) setSelectedKey('ai')
        },
      }),
    [askMutate],
  )
  // Nothing matched: the catalogues' other listings and the song's own file
  // are all there is to go on, which is the model's reading to do — asked
  // once, without a press.
  const nothingMatched = lookup.isSuccess && candidates.length === 0
  const idle = suggest.ask.isIdle
  useEffect(() => {
    if (suggest.on && nothingMatched && idle) askSuggestion(false)
  }, [suggest.on, nothingMatched, idle, askSuggestion])

  // What a suggestion corrects starts ticked, afresh for each suggestion picked.
  const [picked, setPicked] = useState<{
    key: number | 'ai'
    fields: ReadonlySet<Field>
  } | null>(null)
  const ticked = picked?.key === selectedKey ? picked.fields : defaultTicked(song, diffs)
  const setTicked = (fields: ReadonlySet<Field>): void => setPicked({ key: selectedKey, fields })
  const toggle = (field: Field): void => {
    const next = new Set(ticked)
    if (next.has(field)) next.delete(field)
    else next.add(field)
    setTicked(next)
  }

  const [edits, setEdits] = useState<Edits>({})
  const hand = useMemo(() => handEdits(song, edits), [song, edits])
  const count = appliedCount(diffs, ticked, hand)
  // From a cloud library the names change here at once; a cover is the server's to fetch.
  const coverLater = via !== undefined && applyInput(diffs, ticked, hand)?.artworkUrl !== undefined
  const submit = (): void => {
    const input = applyInput(diffs, ticked, hand)
    if (input) apply.mutate(input, { onSuccess: onClose })
  }

  const current = (
    <View style={[styles.current, !wide && styles.currentNarrow]}>
      <Text style={[styles.groupTitle, !wide && styles.fullRow]}>IN YOUR LIBRARY</Text>
      <Cover uri={artFor(song)} title={song.album || song.title} size={wide ? 120 : 96} />
      <View style={[styles.fields, wide && styles.fieldsWide]}>
        {TEXT_FIELDS.map(([field, keyboard]) => (
          <View key={field} style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>{FIELD_LABELS[field]}</Text>
            <TextInput
              value={edits[field] ?? editable(song[field])}
              onChangeText={text => setEdits(previous => ({ ...previous, [field]: text }))}
              placeholder="—"
              placeholderTextColor={theme.colors.textMuted}
              keyboardType={keyboard}
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              accessibilityLabel={FIELD_LABELS[field]}
              testID={`metadata-field-${field}`}
              style={[
                styles.fieldValue,
                styles.fieldInput,
                hand[field] !== undefined && styles.fieldEdited,
              ]}
            />
          </View>
        ))}
        <View style={styles.fieldRow}>
          <Text style={styles.fieldLabel}>Length</Text>
          <Text style={styles.fieldValue}>
            {song.duration ? formatDuration(song.duration) : '—'}
          </Text>
        </View>
      </View>
    </View>
  )

  const suggestions = (
    <View style={styles.candidates}>
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
          Nothing matched on iTunes or MusicBrainz.{' '}
          {suggest.on
            ? 'The suggestion below reads the other catalogues and the song’s file. '
            : ''}
          Or correct the title or artist on the left and apply — the next look-up searches with
          them.
        </Text>
      ) : null}

      {suggest.on ? (
        <SuggestedCard
          state={suggest.ask}
          active={selectedKey === 'ai'}
          onAsk={() => askSuggestion(false)}
          onAgain={() => askSuggestion(true)}
          onPick={() => setSelectedKey('ai')}
        />
      ) : null}

      <View role="radiogroup" accessibilityLabel="Candidates" style={styles.list}>
        {candidates.map((candidate, index) => {
          const active = index === selectedKey
          const [ground, ink] = SOURCE_TONE[candidate.source]
          return (
            <Pressable
              key={`${candidate.source}-${index}`}
              onPress={() => setSelectedKey(index)}
              accessibilityRole="radio"
              accessibilityState={{ checked: active }}
              accessibilityLabel={`${candidate.title}, ${candidateLine(candidate)}, ${SOURCE_LABELS[candidate.source]}, ${scorePercent(candidate.score)}`}
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
                  {candidateLine(candidate)}
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

  return (
    <Dialog
      onDismiss={onClose}
      label="Fix metadata"
      testID="metadata-dialog"
      // Full screen on a phone: no room round it, and the panel takes the width.
      frameStyle={!wide && styles.frameNarrow}
      style={[styles.dialog, wide ? styles.dialogWide : styles.dialogNarrow]}
    >
      <DialogHead
        title="Fix metadata"
        onClose={onClose}
        style={[styles.head, !wide && { paddingTop: 14 + insets.top }]}
      />

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
          <Text style={[styles.hint, styles.footLead, { color: theme.colors.warning }]}>
            {apply.error?.message ?? 'Couldn’t apply the changes.'}
          </Text>
        ) : coverLater ? (
          // Downloaded by the server into the bucket, which this device sees
          // with the next sync rather than the moment the dialog closes.
          <Text style={[styles.hint, styles.footLead]}>
            The new cover shows after your server’s next sync.
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
    </Dialog>
  )
}

/**
 * The model's suggestion, at the head of the listings (docs/features/ai.md):
 * a press to ask for it, then a row like a listing's that can be picked, drawn
 * dashed and with the sparkle as everything a model offers is until it is
 * taken. Under it, the model's one sentence of why, and which listing it
 * follows; a name it answered that was found nowhere was put back, and says so.
 */
function SuggestedCard({
  state,
  active,
  onAsk,
  onAgain,
  onPick,
}: {
  state: { data?: MetadataSuggestion; isPending: boolean; error: Error | null }
  active: boolean
  onAsk: () => void
  onAgain: () => void
  onPick: () => void
}): ReactNode {
  const { theme } = useUnistyles()
  const accent = useAccent()
  const answer = state.data
  const sparkle = <Sparkle size={14} color={accent.accent} />

  if (state.isPending) {
    return (
      <View style={[styles.suggested, styles.suggestedAsk]} testID="metadata-suggest-pending">
        <ActivityIndicator size="small" color={accent.accent} />
        <Text style={styles.candidateSub}>Reading the listings and the song’s file…</Text>
      </View>
    )
  }
  if (!answer) {
    return (
      <View style={styles.suggestedWrap}>
        <Pressable
          onPress={onAsk}
          accessibilityRole="button"
          accessibilityLabel="Suggest names"
          testID="metadata-suggest"
          style={({ pressed }) => [
            styles.suggested,
            styles.suggestedAsk,
            pressed && styles.candidatePressed,
          ]}
        >
          {sparkle}
          <View style={styles.candidateMain}>
            <Text style={[styles.candidateTitle, { color: accent.accent }]}>Suggest</Text>
            <Text style={styles.candidateSub}>
              Reads this song’s names, file and link with the listings, 网易云’s too
            </Text>
          </View>
        </Pressable>
        {state.error ? (
          <Text style={[styles.hint, { color: theme.colors.danger }]}>
            {failureText('Couldn’t suggest', state.error)}
          </Text>
        ) : null}
      </View>
    )
  }

  const pick = answer.suggestion
  const follows = answer.agrees === null ? undefined : answer.candidates[answer.agrees]
  const notes = [
    follows ? `Follows ${SOURCE_LABELS[follows.source]}’s “${follows.title}”.` : null,
    answer.dropped.length > 0
      ? `Left ${answer.dropped.join(', ')} as it was: the name it gave wasn’t in any listing.`
      : null,
  ].filter(Boolean)
  return (
    <View style={styles.suggestedWrap}>
      <Pressable
        onPress={pick ? onPick : undefined}
        disabled={!pick}
        accessibilityRole={pick ? 'radio' : undefined}
        accessibilityState={pick ? { checked: active } : undefined}
        accessibilityLabel={pick ? `Suggested: ${pick.title}, ${candidateLine(pick)}` : answer.why}
        testID="metadata-suggested"
        style={({ pressed }) => [
          styles.suggested,
          pressed && pick && styles.candidatePressed,
          active && styles.candidateActive,
        ]}
      >
        {sparkle}
        <View style={styles.candidateMain}>
          <Text style={[styles.candidateTitle, active && styles.strong]} numberOfLines={1}>
            {pick ? pick.title : 'Looks right as it is'}
          </Text>
          {pick ? (
            <Text style={styles.candidateSub} numberOfLines={1}>
              {candidateLine(pick)}
            </Text>
          ) : null}
          <Text style={styles.suggestedWhy}>{answer.why}</Text>
          {notes.length > 0 ? <Text style={styles.candidateSub}>{notes.join(' ')}</Text> : null}
        </View>
        <View style={[styles.badge, { backgroundColor: SOURCE_TONE.ai[0] }]}>
          <Text style={[styles.badgeText, { color: SOURCE_TONE.ai[1] }]}>SUGGESTED</Text>
        </View>
      </Pressable>
      <Text
        style={[styles.link, styles.suggestedAgain, { color: accent.accent }]}
        onPress={onAgain}
        accessibilityRole="button"
      >
        Ask again
      </Text>
    </View>
  )
}

function Pill({ text }: { text: string }): ReactNode {
  return (
    <View style={styles.pill}>
      <Text style={styles.pillText}>{text}</Text>
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  frameNarrow: { padding: 0, alignItems: 'stretch' },
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
    paddingTop: 14,
    paddingRight: 14,
    paddingBottom: 12,
    paddingLeft: 22,
  },
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
  fieldLabel: { width: 84, color: theme.colors.textMuted, fontSize: 13, paddingTop: 2 },
  fieldValue: { flex: 1, color: theme.colors.textPrimary, fontSize: 13 },
  // A box only by its underline, so the panel still reads as the song's card.
  fieldInput: {
    paddingVertical: 2,
    paddingHorizontal: 0,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.surface3,
    _web: { outlineStyle: 'none' },
  },
  fieldEdited: { borderBottomColor: theme.colors.accent },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  groupTitle: groupLabel(theme.colors),
  candidates: { paddingVertical: 18, paddingHorizontal: 20, gap: 12 },
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
    borderRadius: radius.row,
  },
  candidatePressed: { backgroundColor: theme.colors.surface2 },
  // What a model offers is dashed until it is taken (docs/features/ai.md, rule 2).
  suggestedWrap: { gap: 4 },
  suggested: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: radius.row,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: theme.colors.surface3,
  },
  suggestedAsk: { paddingVertical: 12 },
  suggestedWhy: { color: theme.colors.textSecondary, fontSize: 12, lineHeight: 17, marginTop: 2 },
  suggestedAgain: { alignSelf: 'flex-end', marginRight: 4 },
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
    borderRadius: radius.row,
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
  // The foot's one line of text, pushed to the left of the buttons.
  footLead: { marginRight: 'auto' },
}))
