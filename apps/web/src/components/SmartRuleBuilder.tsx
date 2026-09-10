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
      ['duration', 'Length (seconds)'],
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
    if (matchCount === null) return 'Checking…'
    if (matchCount === 0) return 'Nothing matches these rules yet'
    return `${matchCount} ${matchCount === 1 ? 'song' : 'songs'} match`
  }, [matchCount])

  return (
    <div className="rule-builder">
      <div className="rule-builder-head">
        <Sparkles size={16} />
        <span>
          Match{' '}
          <select
            className="select select-inline"
            value={rules.match}
            onChange={event =>
              update({ ...rules, match: event.target.value === 'any' ? 'any' : 'all' })
            }
          >
            <option value="all">all</option>
            <option value="any">any</option>
          </select>{' '}
          of these rules
        </span>
        <span className={`rule-count ${matchCount === 0 ? 'is-empty' : ''}`}>{preview}</span>
      </div>

      <div className="rule-list">
        {rules.rules.map((rule, index) => (
          <RuleRow
            key={index}
            rule={rule}
            tags={tags}
            onChange={next => setRule(index, next)}
            onRemove={() => removeRule(index)}
          />
        ))}

        {rules.rules.length === 0 && (
          <p className="hint">
            No rules yet — this matches your whole library. Add one to narrow it down.
          </p>
        )}
      </div>

      <button type="button" className="button button-small" onClick={addRule}>
        <Plus size={13} /> Add rule
      </button>

      <div className="rule-builder-foot">
        <label className="field-inline">
          Sort by
          <select
            className="select select-small"
            value={rules.orderBy}
            onChange={event =>
              update({ ...rules, orderBy: event.target.value as SongSortField })
            }
          >
            {SORT_LABELS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        {rules.orderBy !== 'random' && (
          <label className="field-inline">
            Order
            <select
              className="select select-small"
              value={rules.order}
              onChange={event =>
                update({ ...rules, order: event.target.value === 'asc' ? 'asc' : 'desc' })
              }
            >
              <option value="desc">Highest first</option>
              <option value="asc">Lowest first</option>
            </select>
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

/** One rule. The controls shown depend on which field is selected. */
function RuleRow({
  rule,
  tags,
  onChange,
  onRemove,
}: {
  rule: SmartRule
  tags: readonly Tag[]
  onChange: (rule: SmartRule) => void
  onRemove: () => void
}) {
  const changeField = (field: FieldKey): void => onChange(defaultRuleFor(field, tags))

  return (
    <div className="rule-row">
      <select
        className="select select-small"
        value={rule.field}
        onChange={event => changeField(event.target.value as FieldKey)}
        aria-label="Field"
      >
        {FIELD_GROUPS.map(group => (
          <optgroup key={group.label} label={group.label}>
            {group.fields.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>

      {(rule.field === 'title' ||
        rule.field === 'artist' ||
        rule.field === 'album' ||
        rule.field === 'albumArtist') && (
        <>
          <select
            className="select select-small"
            value={rule.op}
            onChange={event => onChange({ ...rule, op: event.target.value as typeof rule.op })}
            aria-label="Operator"
          >
            <option value="contains">contains</option>
            <option value="notContains">does not contain</option>
            <option value="equals">is exactly</option>
            <option value="startsWith">starts with</option>
          </select>
          <input
            className="input input-small input-grow"
            value={rule.value}
            onChange={event => onChange({ ...rule, value: event.target.value })}
            placeholder="text"
            aria-label="Value"
          />
        </>
      )}

      {rule.field === 'tag' && (
        <>
          <select
            className="select select-small"
            value={rule.op}
            onChange={event => onChange({ ...rule, op: event.target.value as typeof rule.op })}
            aria-label="Operator"
          >
            <option value="has">is</option>
            <option value="notHas">is not</option>
          </select>
          <select
            className="select select-small input-grow"
            value={rule.tagId}
            onChange={event => onChange({ ...rule, tagId: Number(event.target.value) })}
            aria-label="Tag"
          >
            {tags.length === 0 && <option value={0}>no tags yet</option>}
            {tags.map(tag => (
              <option key={tag.id} value={tag.id}>
                {tag.name}
              </option>
            ))}
          </select>
        </>
      )}

      {(rule.field === 'playCount' ||
        rule.field === 'skipCount' ||
        rule.field === 'duration' ||
        rule.field === 'year') && (
        <>
          <select
            className="select select-small"
            value={rule.op}
            onChange={event => onChange({ ...rule, op: event.target.value as typeof rule.op })}
            aria-label="Operator"
          >
            <option value="gt">is more than</option>
            <option value="gte">is at least</option>
            <option value="eq">is exactly</option>
            <option value="lte">is at most</option>
            <option value="lt">is less than</option>
          </select>
          <input
            className="input input-small"
            type="number"
            value={rule.value}
            onChange={event => onChange({ ...rule, value: Number(event.target.value) })}
            aria-label="Value"
          />
        </>
      )}

      {(rule.field === 'addedAt' || rule.field === 'lastPlayedAt') && (
        <>
          <select
            className="select select-small"
            value={rule.op}
            onChange={event => onChange({ ...rule, op: event.target.value as typeof rule.op })}
            aria-label="Operator"
          >
            <option value="inLastDays">in the last</option>
            <option value="notInLastDays">not in the last</option>
            <option value="never">never</option>
          </select>
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
        </>
      )}

      {(rule.field === 'loved' || rule.field === 'hasLyrics' || rule.field === 'hasArt') && (
        <select
          className="select select-small"
          value={rule.value ? 'yes' : 'no'}
          onChange={event => onChange({ ...rule, value: event.target.value === 'yes' })}
          aria-label="Value"
        >
          <option value="yes">yes</option>
          <option value="no">no</option>
        </select>
      )}

      <button type="button" className="icon-button" onClick={onRemove} aria-label="Remove rule">
        <X size={15} />
      </button>
    </div>
  )
}
