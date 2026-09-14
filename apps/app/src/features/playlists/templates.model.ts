import { EMPTY_SMART_RULES, type SmartRules, type Tag } from '@selfmp3/shared'

/**
 * Starting points: what a smart playlist is made from, and what a live one
 * can start from.
 *
 * A template is a rule set with a name a person would use for it. A smart
 * playlist runs it once, shows the songs it picked, and keeps them as a plain
 * playlist; a live playlist keeps the rules and runs them on every read. The
 * same few templates serve both, so "Most played" means one thing.
 *
 * Forgotten gems is the one template without rules: the server picks gems by a
 * score no rule set can express (loved *or* played a lot, weighted by how long
 * it has been quiet), so a smart playlist asks the gems endpoint instead and a
 * live playlist cannot start from it.
 */

export type TemplateId =
  | 'mostPlayed'
  | 'gems'
  | 'short'
  | 'long'
  | 'recentlyAdded'
  | 'loved'
  | 'tag'

export interface Template {
  readonly id: TemplateId
  readonly name: string
  /** One line under the name, saying what it picks. */
  readonly hint: string
  /** False for Forgotten gems, which no rule set can express. */
  readonly hasRules: boolean
}

/** Three and a half minutes: the line between short and long songs. */
export const SHORT_SECONDS = 210

export const TEMPLATES: readonly Template[] = [
  { id: 'mostPlayed', name: 'Most played', hint: 'Your 25 most played', hasRules: true },
  { id: 'gems', name: 'Forgotten gems', hint: 'Loved or played a lot, quiet lately', hasRules: false },
  { id: 'short', name: 'Short ones', hint: 'Under 3:30, shortest first', hasRules: true },
  { id: 'long', name: 'Long songs', hint: 'Over 3:30, longest first', hasRules: true },
  { id: 'recentlyAdded', name: 'Recently added', hint: 'Added in the last 30 days', hasRules: true },
  { id: 'loved', name: 'Loved', hint: 'Every song you love', hasRules: true },
  { id: 'tag', name: 'By tag', hint: 'Everything with one tag', hasRules: true },
]

/** The templates a live playlist can start from: every one with rules. */
export const LIVE_TEMPLATES: readonly Template[] = TEMPLATES.filter(template => template.hasRules)

export function templateById(id: TemplateId): Template {
  const found = TEMPLATES.find(template => template.id === id)
  if (!found) throw new Error(`no template ${id}`)
  return found
}

/**
 * The rules a template stands for, or null where there are none (gems) or
 * where it needs something not yet chosen (a tag, in a library with none).
 */
export function templateRules(id: TemplateId, tag: Pick<Tag, 'id'> | null = null): SmartRules | null {
  switch (id) {
    case 'mostPlayed':
      return {
        ...EMPTY_SMART_RULES,
        rules: [{ field: 'playCount', op: 'gt', value: 0 }],
        orderBy: 'playCount',
        order: 'desc',
        limit: 25,
      }
    case 'gems':
      return null
    case 'short':
      return {
        ...EMPTY_SMART_RULES,
        rules: [{ field: 'duration', op: 'lt', value: SHORT_SECONDS }],
        orderBy: 'duration',
        order: 'asc',
      }
    case 'long':
      return {
        ...EMPTY_SMART_RULES,
        rules: [{ field: 'duration', op: 'gt', value: SHORT_SECONDS }],
        orderBy: 'duration',
        order: 'desc',
      }
    case 'recentlyAdded':
      return {
        ...EMPTY_SMART_RULES,
        rules: [{ field: 'addedAt', op: 'inLastDays', days: 30 }],
        orderBy: 'addedAt',
        order: 'desc',
      }
    case 'loved':
      return {
        ...EMPTY_SMART_RULES,
        rules: [{ field: 'loved', op: 'is', value: true }],
        orderBy: 'lastPlayedAt',
        order: 'desc',
      }
    case 'tag':
      return tag
        ? {
            ...EMPTY_SMART_RULES,
            rules: [{ field: 'tag', op: 'has', tagId: tag.id }],
            orderBy: 'addedAt',
            order: 'desc',
          }
        : null
  }
}

/** The name a playlist made from a template starts with. */
export function templateTitle(id: TemplateId, tag: Pick<Tag, 'name'> | null = null): string {
  if (id === 'tag') return tag ? tag.name : 'By tag'
  return templateById(id).name
}
