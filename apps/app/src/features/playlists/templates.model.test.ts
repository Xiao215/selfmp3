import { describe, expect, it } from 'vitest'
import { SmartRulesSchema } from '@selfmp3/shared'

import { LIVE_TEMPLATES, TEMPLATES, templateRules, templateTitle } from './templates.model'

describe('templates', () => {
  it('each stand for rules the server accepts', () => {
    const tag = { id: 7, name: 'chill' }
    for (const template of TEMPLATES) {
      const rules = templateRules(template.id, tag)
      if (!template.hasRules) {
        expect(rules).toBeNull()
        continue
      }
      expect(SmartRulesSchema.safeParse(rules).success, template.id).toBe(true)
    }
  })

  it('leaves Forgotten gems out of what a live playlist can start from', () => {
    expect(LIVE_TEMPLATES.map(template => template.id)).not.toContain('gems')
  })

  it('needs a tag before By tag means anything', () => {
    expect(templateRules('tag')).toBeNull()
    expect(templateRules('tag', { id: 3 })?.rules).toEqual([{ field: 'tag', op: 'has', tagId: 3 }])
    expect(templateTitle('tag', { name: 'chill' })).toBe('chill')
  })

  it('draws the line between short and long songs in the same place', () => {
    const short = templateRules('short')?.rules[0]
    const long = templateRules('long')?.rules[0]
    expect(short).toMatchObject({ field: 'duration', op: 'lt' })
    expect(long).toMatchObject({ field: 'duration', op: 'gt' })
    expect(short && 'value' in short ? short.value : null).toBe(
      long && 'value' in long ? long.value : undefined,
    )
  })
})
