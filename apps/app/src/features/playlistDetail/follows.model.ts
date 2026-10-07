import type { SmartRules } from '@selfmp3/shared'

/**
 * Reading a playlist's rules back as a list of tags: the chips on the Follows
 * row.
 *
 * A rule set can hold more than tags — a length, a play count, "not this tag",
 * written by the rule editor this row replaced or by another client — and the
 * row has no chip for those. So this
 * narrows rather than asserts: anything that is not "has this tag" is left out
 * of the chips, and `withFollowedTags` below leaves it in the rules.
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
 * A live playlist's rules with the chips changed to `tagIds`, and nothing else.
 *
 * The row draws only the "has this tag" rules, but a playlist can follow more
 * than that — a length, a play count, "not this tag" — and say whether all or
 * any of them must hold, in an order, up to a limit. A chip edit is about tags,
 * so only the tag rules move: each rule that is not "has this tag" stays where
 * it was, a followed tag still chosen keeps its place, one no longer chosen
 * goes, and a newly chosen one is added at the end. `match`, `orderBy`,
 * `order` and `limit` come back exactly as they were.
 */
export function withFollowedTags(rules: SmartRules, tagIds: readonly number[]): SmartRules {
  const out: SmartRules['rules'] = []
  const kept = new Set<number>()
  for (const rule of rules.rules) {
    if (rule.field !== 'tag' || rule.op !== 'has') {
      out.push(rule)
      continue
    }
    // A tag written twice is drawn once (`followedTagIds`), so it is kept once.
    if (!tagIds.includes(rule.tagId) || kept.has(rule.tagId)) continue
    kept.add(rule.tagId)
    out.push(rule)
  }
  for (const tagId of tagIds) {
    if (kept.has(tagId)) continue
    kept.add(tagId)
    out.push({ field: 'tag', op: 'has', tagId })
  }
  return { ...rules, rules: out }
}
