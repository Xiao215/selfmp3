import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Pressable, Text, TextInput, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import {
  EMPTY_SMART_RULES,
  SmartRulesSchema,
  type SmartRule,
  type SmartRules,
  type Tag,
} from '@selfmp3/shared'
import { clientApi, oklchToHexAlpha, radius, space } from '@selfmp3/client'
import { useLayout } from '../../shell/useLayout'
import { useAccent } from '../../ui/accent'
import { IconButton } from '../../ui/components/IconButton'
import { Plus, Sparkles, X } from '../../ui/components/Icons'
import { Select } from '../../ui/components/Select'
import { useDebounced } from '../../ui/useDebounced'
import {
  DATE_OPS,
  defaultRuleFor,
  FIELD_GROUPS,
  joinWord,
  KEY_OPS,
  KEY_OPTIONS,
  matchLabel,
  NUMBER_OPS,
  SORT_OPTIONS,
  TAG_OPS,
  TEXT_OPS,
  unitFor,
  type FieldKey,
} from './rules.model'

/**
 * The smart-playlist rule builder: the web's `SmartRuleBuilder`.
 *
 * You should always be able to see what a rule set matches. Every edit is
 * previewed against the real library and the count shown beside the rules,
 * so rules are tuned by watching a number move, not by saving and guessing.
 *
 * At desktop width each rule is one line of a sentence, its controls in fixed
 * columns so six rules line up as six lines. On a phone each rule is a small
 * card: the joining word and ✕, then field, comparison and value, one to a line.
 *
 * Saves follow the preview's pace — once typing pauses — and only rules the
 * server will accept are saved, so a text rule still waiting for its text is
 * not sent. Closing the editor within the pause still saves the last change.
 */
export function SmartRuleBuilder({
  rules: initial,
  tags,
  onChange,
}: {
  rules?: SmartRules
  tags: readonly Tag[]
  onChange: (rules: SmartRules) => void
}): ReactNode {
  const { theme } = useUnistyles()
  const accent = useAccent()
  const { wide } = useLayout()
  const [rules, setRules] = useState<SmartRules>(initial ?? EMPTY_SMART_RULES)
  const [matchCount, setMatchCount] = useState<number | null>(null)
  const [description, setDescription] = useState('')

  const debounced = useDebounced(rules, 350)
  // While the two disagree the number on screen belongs to earlier rules, so it
  // is dimmed rather than left looking authoritative.
  const stale = debounced !== rules

  useEffect(() => {
    let cancelled = false
    const parsed = SmartRulesSchema.safeParse(debounced)
    if (!parsed.success) return undefined
    clientApi()
      .previewRules(parsed.data)
      .then(result => {
        if (cancelled) return
        setMatchCount(result.songIds.length)
        setDescription(result.description)
      })
      .catch(() => {
        if (!cancelled) setMatchCount(null)
      })
    return () => {
      cancelled = true
    }
  }, [debounced])

  const saved = useRef(rules)
  const latest = useRef(rules)
  const save = useRef(onChange)
  useEffect(() => {
    latest.current = rules
  }, [rules])
  useEffect(() => {
    save.current = onChange
  }, [onChange])

  useEffect(() => {
    if (debounced === saved.current) return
    const parsed = SmartRulesSchema.safeParse(debounced)
    if (!parsed.success) return
    saved.current = debounced
    save.current(parsed.data)
  }, [debounced])

  useEffect(
    () => () => {
      const last = latest.current
      if (last === saved.current) return
      const parsed = SmartRulesSchema.safeParse(last)
      if (parsed.success) save.current(parsed.data)
    },
    [],
  )

  const setRule = (index: number, rule: SmartRule): void =>
    setRules(current => ({
      ...current,
      rules: current.rules.map((item, i) => (i === index ? rule : item)),
    }))
  const removeRule = (index: number): void =>
    setRules(current => ({ ...current, rules: current.rules.filter((_, i) => i !== index) }))
  const addRule = (): void =>
    setRules(current => ({ ...current, rules: [...current.rules, defaultRuleFor('artist', tags)] }))

  const preview = matchLabel(matchCount)
  const empty = matchCount === 0
  const countInk = empty ? theme.colors.warning : accent.accent

  return (
    <View style={styles.builder} testID="rule-builder">
      <View style={[styles.head, !wide && styles.headCompact]}>
        <View style={styles.sentence}>
          <Sparkles size={16} color={accent.accent} />
          <Text style={styles.sentenceText}>Match</Text>
          <Select
            size="inline"
            value={rules.match}
            options={[
              { value: 'all', label: 'all' },
              { value: 'any', label: 'any' },
            ]}
            onChange={match => setRules(current => ({ ...current, match }))}
            label="Match all or any rule"
          />
          <Text style={styles.sentenceText}>of these rules</Text>
        </View>
        <View
          style={[
            styles.count,
            empty && { borderColor: oklchToHexAlpha(0.45, 0.1, 78, 0.6) },
            (stale || matchCount === null) && styles.countStale,
          ]}
          accessibilityLiveRegion="polite"
        >
          {preview.number ? (
            <Text style={[styles.countNumber, { color: countInk }]}>{preview.number}</Text>
          ) : null}
          <Text style={[styles.countText, { color: countInk }]}>{preview.text}</Text>
        </View>
      </View>

      <View style={styles.list}>
        {rules.rules.map((rule, index) => (
          <RuleRow
            key={index}
            rule={rule}
            tags={tags}
            wide={wide}
            join={joinWord(index, rules.match)}
            onChange={next => setRule(index, next)}
            onRemove={() => removeRule(index)}
          />
        ))}
        {rules.rules.length === 0 ? (
          <Text style={[styles.hint, wide && styles.indent]}>
            No rules yet — this matches your whole library. Add one to narrow it down.
          </Text>
        ) : null}
      </View>

      <View style={[styles.addRow, wide && styles.indent]}>
        <Pressable
          onPress={addRule}
          accessibilityRole="button"
          style={({ pressed }) => [styles.add, pressed && styles.addPressed]}
        >
          <Plus size={13} color={theme.colors.textPrimary} />
          <Text style={styles.addText}>Add rule</Text>
        </Pressable>
      </View>

      <View style={styles.foot}>
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Sort by</Text>
          <Select
            size="small"
            value={rules.orderBy}
            options={SORT_OPTIONS}
            onChange={orderBy => setRules(current => ({ ...current, orderBy }))}
            label="Sort by"
          />
        </View>
        {rules.orderBy !== 'random' ? (
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Order</Text>
            <Select
              size="small"
              value={rules.order}
              options={[
                { value: 'desc', label: 'Highest first' },
                { value: 'asc', label: 'Lowest first' },
              ]}
              onChange={order => setRules(current => ({ ...current, order }))}
              label="Order"
            />
          </View>
        ) : null}
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Limit to</Text>
          <TextInput
            style={[styles.input, styles.limit]}
            keyboardType="number-pad"
            placeholder="no limit"
            placeholderTextColor={theme.colors.textMuted}
            value={rules.limit === null ? '' : String(rules.limit)}
            onChangeText={text => {
              const trimmed = text.trim()
              const limit = trimmed === '' ? null : Number(trimmed)
              if (limit !== null && !Number.isFinite(limit)) return
              setRules(current => ({ ...current, limit }))
            }}
            accessibilityLabel="Limit to"
          />
          <Text style={styles.fieldLabel}>songs</Text>
        </View>
      </View>

      {description ? <Text style={styles.description}>{description}</Text> : null}
    </View>
  )
}

/**
 * One rule, as one line of the sentence (desktop) or one card (phone). The
 * controls a field needs change with it; the columns do not move.
 */
function RuleRow({
  rule,
  tags,
  wide,
  join,
  onChange,
  onRemove,
}: {
  rule: SmartRule
  tags: readonly Tag[]
  wide: boolean
  join: string
  onChange: (rule: SmartRule) => void
  onRemove: () => void
}): ReactNode {
  const { theme } = useUnistyles()
  const { finePointer } = useLayout()
  const [hovered, setHovered] = useState(false)
  const unit = unitFor(rule.field)

  const numberInput = (value: number, set: (value: number) => void, label = 'Value'): ReactNode => (
    <TextInput
      style={[styles.input, wide ? styles.number : styles.grow]}
      keyboardType="numbers-and-punctuation"
      value={Number.isFinite(value) ? String(value) : ''}
      onChangeText={text => {
        const next = text.trim() === '' ? 0 : Number(text)
        if (Number.isFinite(next)) set(next)
      }}
      accessibilityLabel={label}
    />
  )

  let op: ReactNode = null
  let value: ReactNode = null

  switch (rule.field) {
    case 'title':
    case 'artist':
    case 'album':
    case 'albumArtist':
      op = (
        <Select
          size="small"
          value={rule.op}
          options={TEXT_OPS}
          onChange={next => onChange({ ...rule, op: next })}
          label="Operator"
        />
      )
      value = (
        <TextInput
          style={[styles.input, styles.grow]}
          value={rule.value}
          onChangeText={text => onChange({ ...rule, value: text })}
          placeholder="text"
          placeholderTextColor={theme.colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Value"
        />
      )
      break
    case 'tag':
      op = (
        <Select
          size="small"
          value={rule.op}
          options={TAG_OPS}
          onChange={next => onChange({ ...rule, op: next })}
          label="Operator"
        />
      )
      value = (
        <View style={styles.grow}>
          <Select
            size="small"
            value={rule.tagId}
            options={
              tags.length === 0
                ? [{ value: 0, label: 'no tags yet', disabled: true }]
                : tags.map(tag => ({ value: tag.id, label: tag.name }))
            }
            onChange={tagId => onChange({ ...rule, tagId })}
            label="Tag"
          />
        </View>
      )
      break
    case 'playCount':
    case 'skipCount':
    case 'duration':
    case 'year':
    case 'bpm':
    case 'energy':
    case 'loudness':
      op = (
        <Select
          size="small"
          value={rule.op}
          options={NUMBER_OPS}
          onChange={next => onChange({ ...rule, op: next } as SmartRule)}
          label="Operator"
        />
      )
      value = numberInput(rule.value, next => onChange({ ...rule, value: next } as SmartRule))
      break
    case 'addedAt':
    case 'lastPlayedAt':
      op = (
        <Select
          size="small"
          value={rule.op}
          options={DATE_OPS}
          onChange={next => onChange({ ...rule, op: next })}
          label="Operator"
        />
      )
      value =
        rule.op === 'never'
          ? null
          : numberInput(rule.days ?? 30, days => onChange({ ...rule, days }), 'Days')
      break
    case 'key':
      op = (
        <Select
          size="small"
          value={rule.op}
          options={KEY_OPS}
          onChange={next => onChange({ ...rule, op: next })}
          label="Operator"
        />
      )
      value = (
        <View style={styles.grow}>
          <Select
            size="small"
            value={rule.value}
            options={KEY_OPTIONS}
            onChange={next => onChange({ ...rule, value: next })}
            label="Key"
          />
        </View>
      )
      break
    case 'loved':
    case 'hasLyrics':
    case 'hasArt':
      op = (
        <Select
          size="small"
          value={rule.value ? 'yes' : 'no'}
          options={[
            { value: 'yes', label: 'is yes' },
            { value: 'no', label: 'is no' },
          ]}
          onChange={next => onChange({ ...rule, value: next === 'yes' })}
          label="Value"
        />
      )
      break
  }

  const field = (
    <Select
      size="small"
      value={rule.field}
      groups={FIELD_GROUPS}
      onChange={(next: FieldKey) => onChange(defaultRuleFor(next, tags))}
      label="Field"
    />
  )
  const remove = (
    <View style={{ opacity: !finePointer || hovered || !wide ? 1 : 0 }}>
      <IconButton onPress={onRemove} label="Remove this rule" size={24}>
        <X size={14} color={theme.colors.textMuted} />
      </IconButton>
    </View>
  )
  const valueCell = (
    <View style={wide ? styles.value : styles.valueCompact}>
      {value}
      {value && unit && unit !== 'days' ? <Text style={styles.unit}>{unit}</Text> : null}
      {value && unit === 'days' ? <Text style={styles.unit}>days</Text> : null}
    </View>
  )

  if (!wide) {
    return (
      <View style={styles.card}>
        <View style={styles.cardTop}>
          <Text style={styles.join}>{join.toUpperCase()}</Text>
          {remove}
        </View>
        {field}
        {op}
        {valueCell}
      </View>
    )
  }

  return (
    <View
      style={[styles.row, hovered && styles.rowHovered]}
      onPointerEnter={finePointer ? () => setHovered(true) : undefined}
      onPointerLeave={finePointer ? () => setHovered(false) : undefined}
    >
      <Text style={[styles.join, styles.joinWide]}>{join.toUpperCase()}</Text>
      <View style={styles.fieldCell}>{field}</View>
      <View style={styles.opCell}>{op}</View>
      {valueCell}
      {remove}
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  builder: {
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: radius.md,
    padding: space.lg,
    marginBottom: 22,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 14,
  },
  headCompact: { flexDirection: 'column', alignItems: 'flex-start' },
  sentence: { flexDirection: 'row', alignItems: 'center', gap: 6, flexGrow: 1 },
  sentenceText: { color: theme.colors.textSecondary, fontSize: 13 },
  count: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingVertical: 5,
    paddingHorizontal: space.md,
    borderRadius: 999,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  countStale: { opacity: 0.55 },
  countNumber: { fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] },
  countText: { fontSize: 13, fontWeight: '600' },
  list: { gap: 6 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingVertical: 3,
    borderRadius: radius.sm,
  },
  rowHovered: { backgroundColor: theme.colors.surface2 },
  join: { color: theme.colors.textMuted, fontSize: 11, letterSpacing: 0.5 },
  joinWide: { width: 46, textAlign: 'right', paddingRight: 2 },
  fieldCell: { width: 148 },
  opCell: { width: 152 },
  value: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 7 },
  valueCompact: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  card: {
    gap: 6,
    padding: 10,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: radius.sm,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  input: {
    minHeight: 30,
    paddingVertical: 5,
    paddingHorizontal: space.sm,
    color: theme.colors.textPrimary,
    fontSize: 12,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: radius.sm,
  },
  number: { width: 96 },
  grow: { flex: 1, minWidth: 0 },
  unit: { color: theme.colors.textMuted, fontSize: 12 },
  hint: { color: theme.colors.textMuted, fontSize: 12, paddingVertical: 10 },
  indent: { marginLeft: 53 },
  addRow: { flexDirection: 'row', marginTop: space.sm },
  add: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: theme.colors.borderStrong,
  },
  addPressed: { backgroundColor: theme.colors.surface2 },
  addText: { color: theme.colors.textPrimary, fontSize: 12, fontWeight: '600' },
  foot: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 18,
    marginTop: space.lg,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  field: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  fieldLabel: { color: theme.colors.textMuted, fontSize: 12 },
  limit: { width: 76 },
  description: {
    marginTop: space.md,
    color: theme.colors.textMuted,
    fontSize: 12,
    fontStyle: 'italic',
  },
}))
