import type { SmartRules } from '@selfmp3/shared'

/**
 * Reading a playlist's rules back as a list of tags.
 *
 * Everything the app writes is a tag rule and nothing else, but the column is
 * a rule set and the server will hand back whatever is in it — a playlist made
 * before this, or edited by something that is not this app. So this narrows
 * rather than asserts: anything that is not "has this tag" is left out instead
 * of thrown at a reader who only wanted to see their chips.
 */
export function followedTagIds(rules: SmartRules | null): number[] {
  if (!rules) return []
  const ids: number[] = []
  for (const rule of rules.rules) {
    if (rule.field === 'tag' && rule.op === 'has' && !ids.includes(rule.tagId)) ids.push(rule.tagId)
  }
  return ids
}

/**
 * Whether a rule set says anything this app's own row cannot show.
 *
 * True means the playlist is following something more than tags, and the row
 * would be quietly lying about what it holds. The screen says so rather than
 * pretending; it is the one honest thing to do about a rule the interface no
 * longer has a way to express.
 */
export function hasRulesBeyondTags(rules: SmartRules | null): boolean {
  if (!rules) return false
  return rules.rules.some(rule => rule.field !== 'tag' || rule.op !== 'has')
}
