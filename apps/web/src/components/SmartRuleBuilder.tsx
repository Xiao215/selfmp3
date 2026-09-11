import { useEffect, useMemo, useState } from 'react'
import {
  EMPTY_SMART_RULES,
  SmartRulesSchema,
  type SmartRule,
  type SmartRules,
  type SongSortField,
  type Tag,
} from '@selfmp3/shared'
import { api } from '../lib/api.js'
import { useDebounced } from '../lib/hooks.js'
import { Plus, Sparkles, X } from './Icons.js'
import { Select } from './Select.js'

/**
 * The smart-playlist rule builder.
 *
 * The design principle: you should always be able to see what a rule set
 * actually matches. Every edit re-runs a preview against the real library and
 * reports the count, so you tune rules by watching a number move rather than
 * saving and guessing.
 */

type FieldKey = SmartRule['field']

const FIELD_GROUPS: ReadonlyArray<{ label: string; fields: ReadonlyArray<[FieldKey, string]> }> = [
  {
    label: 'Text',
    fields: [
      ['title', 'Title'],
      ['artist', 'Artist'],
      ['album', 'Album'],
      ['albumArtist', 'Album artist'],
    ],
  },
  { label: 'Tags', fields: [['tag', 'Tag']] },
  {
    label: 'Numbers',
    fields: [
      ['playCount', 'Play count'],
      ['skipCount', 'Skip count'],
      ['duration', 'Length'],
      ['year', 'Year'],
    ],
  },
  {
    label: 'Dates',
    fields: [
      ['addedAt', 'Date added'],
      ['lastPlayedAt', 'Last played'],
    ],
  },
  {
    label: 'Yes / no',
    fields: [
      ['loved', 'Loved'],
      ['hasLyrics', 'Has lyrics'],
      ['hasArt', 'Has cover art'],
    ],
  },
  {
    label: 'Audio',
    fields: [
      ['bpm', 'BPM'],
      ['key', 'Key'],
      ['energy', 'Energy'],
      ['loudness', 'Loudness'],
    ],
  },
]

/** The Camelot wheel in order, for the key picker. */
const CAMELOT_CODES: ReadonlyArray<[string, string]> = [
  ['1A', '1A · A♭ minor'],
  ['2A', '2A · E♭ minor'],
  ['3A', '3A · B♭ minor'],
  ['4A', '4A · F minor'],
  ['5A', '5A · C minor'],
  ['6A', '6A · G minor'],
  ['7A', '7A · D minor'],
  ['8A', '8A · A minor'],
  ['9A', '9A · E minor'],
  ['10A', '10A · B minor'],
  ['11A', '11A · F♯ minor'],
  ['12A', '12A · C♯ minor'],
  ['1B', '1B · B major'],
  ['2B', '2B · F♯ major'],
  ['3B', '3B · C♯ major'],
  ['4B', '4B · A♭ major'],
  ['5B', '5B · E♭ major'],
  ['6B', '6B · B♭ major'],
  ['7B', '7B · F major'],
  ['8B', '8B · C major'],
  ['9B', '9B · G major'],
  ['10B', '10B · D major'],
  ['11B', '11B · A major'],
  ['12B', '12B · E major'],
]

const SORT_LABELS: ReadonlyArray<[SongSortField, string]> = [
  ['addedAt', 'Date added'],
  ['title', 'Title'],
  ['artist', 'Artist'],
  ['album', 'Album'],
  ['duration', 'Length'],
  ['playCount', 'Play count'],
  ['lastPlayedAt', 'Last played'],
  ['random', 'Random'],
]

/**
 * `[value, label]` tuples are how the tables above read best; the dropdown
 * wants `{ value, label }`, so convert in one place.
 */
function toOptions<T extends string>(
  pairs: ReadonlyArray<[T, string]>,
): ReadonlyArray<{ value: T; label: string }> {
  return pairs.map(([value, label]) => ({ value, label }))
}

const FIELD_OPTIONS = FIELD_GROUPS.map(group => ({
  label: group.label,
  options: toOptions(group.fields),
}))

const SORT_OPTIONS = toOptions(SORT_LABELS)
const KEY_OPTIONS = toOptions(CAMELOT_CODES)

/** Every numeric field compares the same way, so the wording is shared. */
const NUMBER_OPS = [
  { value: 'gt', label: 'is more than' },
  { value: 'gte', label: 'is at least' },
  { value: 'eq', label: 'is exactly' },
  { value: 'lte', label: 'is at most' },
  { value: 'lt', label: 'is less than' },
] as const

/** A sensible starting rule for each field, so adding one is never a dead end. */
function defaultRuleFor(field: FieldKey, tags: readonly Tag[]): SmartRule {
  switch (field) {
    case 'title':
    case 'artist':
    case 'album':
    case 'albumArtist':
      return { field, op: 'contains', value: '' }
    case 'tag':
      return { field: 'tag', op: 'has', tagId: tags[0]?.id ?? 0 }
    case 'playCount':
    case 'skipCount':
    case 'duration':
    case 'year':
      return { field, op: 'gt', value: field === 'duration' ? 180 : 5 }
    case 'addedAt':
    case 'lastPlayedAt':
      return { field, op: 'inLastDays', days: 30 }
    case 'loved':
    case 'hasLyrics':
    case 'hasArt':
      return { field, op: 'is', value: true }
    case 'bpm':
      return { field, op: 'gte', value: 120 }
    case 'energy':
      return { field, op: 'gte', value: 0.6 }
    case 'loudness':
      return { field, op: 'gte', value: -12 }
    case 'key':
      return { field: 'key', op: 'compatible', value: '8A' }
  }
}

export function SmartRuleBuilder({
  rules: initial,
  tags,
  onChange,
}: {
  rules?: SmartRules
  tags: readonly Tag[]
  onChange: (rules: SmartRules) => void
}) {
  const [rules, setRules] = useState<SmartRules>(initial ?? EMPTY_SMART_RULES)
  const [matchCount, setMatchCount] = useState<number | null>(null)
  const [description, setDescription] = useState('')

  const debounced = useDebounced(rules, 350)
  // The count is only about `debounced`; while the two disagree the number on
  // screen belongs to the previous rules, so it is dimmed rather than left
  // looking authoritative.
  const stale = debounced !== rules

  // Preview against the real library, debounced so typing does not spam it.
  useEffect(() => {
    let cancelled = false
    const parsed = SmartRulesSchema.safeParse(debounced)
    if (!parsed.success) return

    api
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

  const update = (next: SmartRules): void => {
    setRules(next)
    onChange(next)
  }

  const setRule = (index: number, rule: SmartRule): void => {
    update({ ...rules, rules: rules.rules.map((item, i) => (i === index ? rule : item)) })
  }

  const removeRule = (index: number): void => {
    update({ ...rules, rules: rules.rules.filter((_, i) => i !== index) })
  }

  const addRule = (): void => {
    update({ ...rules, rules: [...rules.rules, defaultRuleFor('artist', tags)] })
  }

  const preview = useMemo(() => {
    if (matchCount === null) return { number: '', text: 'Checking…' }
    if (matchCount === 0) return { number: '', text: 'Nothing matches yet' }
    return {
      number: matchCount.toLocaleString(),
      text: matchCount === 1 ? 'song matches' : 'songs match',
    }
  }, [matchCount])

  return (
    <div className="rule-builder">
      <div className="rule-builder-head">
        <Sparkles size={16} />
        <span>
          Match{' '}
          <Select<'all' | 'any'>
            value={rules.match}
            onChange={match => update({ ...rules, match })}
            options={[
              { value: 'all', label: 'all' },
              { value: 'any', label: 'any' },
            ]}
            label="Match all or any rule"
            size="inline"
          />{' '}
          of these rules
        </span>
        <span
          className={[
            'rule-count',
            matchCount === 0 ? 'is-empty' : '',
            stale || matchCount === null ? 'is-stale' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          aria-live="polite"
        >
          {preview.number && <span className="rule-count-number">{preview.number}</span>}
          {preview.text}
        </span>
      </div>

      <div className="rule-list">
        {rules.rules.map((rule, index) => (
          <RuleRow
            key={index}
            rule={rule}
            tags={tags}
            join={index === 0 ? 'Where' : rules.match === 'all' ? 'and' : 'or'}
            onChange={next => setRule(index, next)}
            onRemove={() => removeRule(index)}
          />
        ))}

        {rules.rules.length === 0 && (
          <p className="hint rule-empty">
            No rules yet — this matches your whole library. Add one to narrow it down.
          </p>
        )}
      </div>

      <button type="button" className="button button-small rule-add" onClick={addRule}>
        <Plus size={13} /> Add rule
      </button>

      <div className="rule-builder-foot">
        <label className="field-inline">
          Sort by
          <Select<SongSortField>
            value={rules.orderBy}
            onChange={orderBy => update({ ...rules, orderBy })}
            options={SORT_OPTIONS}
            label="Sort by"
            size="small"
          />
        </label>

        {rules.orderBy !== 'random' && (
          <label className="field-inline">
            Order
            <Select<'asc' | 'desc'>
              value={rules.order}
              onChange={order => update({ ...rules, order })}
              options={[
                { value: 'desc', label: 'Highest first' },
                { value: 'asc', label: 'Lowest first' },
              ]}
              label="Order"
              size="small"
            />
          </label>
        )}

        <label className="field-inline">
          Limit to
          <input
            className="input input-small"
            type="number"
            min={1}
            max={5000}
            placeholder="no limit"
            value={rules.limit ?? ''}
            onChange={event => {
              const value = event.target.value.trim()
              update({ ...rules, limit: value === '' ? null : Number(value) })
            }}
          />
          songs
        </label>
      </div>

      {description && <p className="rule-description">{description}</p>}
    </div>
  )
}

/**
 * One rule, as one line of the sentence.
 *
 * The grid in `playlists.css` gives every rule the same five cells — joint,
 * field, operator, value, remove — so which controls a field needs changes
 * without anything below it shifting sideways.
 */
function RuleRow({
  rule,
  tags,
  join,
  onChange,
  onRemove,
}: {
  rule: SmartRule
  tags: readonly Tag[]
  join: string
  onChange: (rule: SmartRule) => void
  onRemove: () => void
}) {
  const changeField = (field: FieldKey): void => onChange(defaultRuleFor(field, tags))

  return (
    <div className="rule-row">
      <span className="rule-join" aria-hidden="true">
        {join}
      </span>

      <Select<FieldKey>
        value={rule.field}
        onChange={changeField}
        options={FIELD_OPTIONS}
        label="Field"
        size="small"
        className="rule-field"
      />

      {(rule.field === 'title' ||
        rule.field === 'artist' ||
        rule.field === 'album' ||
        rule.field === 'albumArtist') && (
        <>
          <Select<typeof rule.op>
            value={rule.op}
            onChange={op => onChange({ ...rule, op })}
            options={[
              { value: 'contains', label: 'contains' },
              { value: 'notContains', label: 'does not contain' },
              { value: 'equals', label: 'is exactly' },
              { value: 'startsWith', label: 'starts with' },
            ]}
            label="Operator"
            size="small"
            className="rule-op"
          />
          <span className="rule-value">
            <input
              className="input input-small input-grow"
              value={rule.value}
              onChange={event => onChange({ ...rule, value: event.target.value })}
              placeholder="text"
              aria-label="Value"
            />
          </span>
        </>
      )}

      {rule.field === 'tag' && (
        <>
          <Select<typeof rule.op>
            value={rule.op}
            onChange={op => onChange({ ...rule, op })}
            options={[
              { value: 'has', label: 'is' },
              { value: 'notHas', label: 'is not' },
            ]}
            label="Operator"
            size="small"
            className="rule-op"
          />
          <span className="rule-value">
            <Select<number>
              value={rule.tagId}
              onChange={tagId => onChange({ ...rule, tagId })}
              options={
                tags.length === 0
                  ? [{ value: 0, label: 'no tags yet', disabled: true }]
                  : tags.map(tag => ({ value: tag.id, label: tag.name }))
              }
              label="Tag"
              size="small"
              className="input-grow"
            />
          </span>
        </>
      )}

      {(rule.field === 'playCount' ||
        rule.field === 'skipCount' ||
        rule.field === 'duration' ||
        rule.field === 'year') && (
        <>
          <Select<typeof rule.op>
            value={rule.op}
            onChange={op => onChange({ ...rule, op })}
            options={NUMBER_OPS}
            label="Operator"
            size="small"
            className="rule-op"
          />
          <span className="rule-value">
            <input
              className="input input-small"
              type="number"
              value={rule.value}
              onChange={event => onChange({ ...rule, value: Number(event.target.value) })}
              aria-label="Value"
            />
            {rule.field === 'duration' && <span className="rule-unit">seconds</span>}
          </span>
        </>
      )}

      {(rule.field === 'addedAt' || rule.field === 'lastPlayedAt') && (
        <>
          <Select<typeof rule.op>
            value={rule.op}
            onChange={op => onChange({ ...rule, op })}
            options={[
              { value: 'inLastDays', label: 'in the last' },
              { value: 'notInLastDays', label: 'not in the last' },
              { value: 'never', label: 'never' },
            ]}
            label="Operator"
            size="small"
            className="rule-op"
          />
          <span className="rule-value">
            {rule.op !== 'never' && (
              <>
                <input
                  className="input input-small"
                  type="number"
                  min={1}
                  max={3650}
                  value={rule.days ?? 30}
                  onChange={event => onChange({ ...rule, days: Number(event.target.value) })}
                  aria-label="Days"
                />
                <span className="rule-unit">days</span>
              </>
            )}
          </span>
        </>
      )}

      {(rule.field === 'bpm' || rule.field === 'energy' || rule.field === 'loudness') && (
        <>
          <Select<typeof rule.op>
            value={rule.op}
            onChange={op => onChange({ ...rule, op })}
            options={NUMBER_OPS}
            label="Operator"
            size="small"
            className="rule-op"
          />
          <span className="rule-value">
            <input
              className="input input-small"
              type="number"
              step={rule.field === 'energy' ? 0.05 : 1}
              min={rule.field === 'energy' ? 0 : undefined}
              max={rule.field === 'energy' ? 1 : undefined}
              value={rule.value}
              onChange={event => onChange({ ...rule, value: Number(event.target.value) })}
              aria-label="Value"
            />
            <span className="rule-unit">
              {rule.field === 'bpm' ? 'BPM' : rule.field === 'energy' ? '0–1' : 'LUFS'}
            </span>
          </span>
        </>
      )}

      {rule.field === 'key' && (
        <>
          <Select<typeof rule.op>
            value={rule.op}
            onChange={op => onChange({ ...rule, op })}
            options={[
              { value: 'compatible', label: 'mixes with' },
              { value: 'is', label: 'is exactly' },
            ]}
            label="Operator"
            size="small"
            className="rule-op"
          />
          <span className="rule-value">
            <Select<string>
              value={rule.value}
              onChange={value => onChange({ ...rule, value })}
              options={KEY_OPTIONS}
              label="Key"
              size="small"
              className="input-grow"
            />
          </span>
        </>
      )}

      {(rule.field === 'loved' || rule.field === 'hasLyrics' || rule.field === 'hasArt') && (
        <>
          <Select<'yes' | 'no'>
            value={rule.value ? 'yes' : 'no'}
            onChange={value => onChange({ ...rule, value: value === 'yes' })}
            options={[
              { value: 'yes', label: 'is yes' },
              { value: 'no', label: 'is no' },
            ]}
            label="Value"
            size="small"
            className="rule-op"
          />
          <span className="rule-value" />
        </>
      )}

      <button
        type="button"
        className="icon-button icon-button-tiny rule-remove"
        onClick={onRemove}
        aria-label="Remove this rule"
        data-tip="Remove this rule"
      >
        <X size={14} />
      </button>
    </div>
  )
}
