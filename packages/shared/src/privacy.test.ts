import { describe, expect, it } from 'vitest'
import { PRIVACY_POLICY, PRIVACY_POLICY_URL, renderPrivacyPage } from './privacy.js'

describe('the privacy policy', () => {
  it('is published beside the web app', () => {
    expect(PRIVACY_POLICY_URL).toBe('https://xiao215.github.io/selfmp3/privacy.html')
  })

  it('says what Google asks a policy to say', () => {
    const words = PRIVACY_POLICY.sections.flatMap(section => [section.heading, ...section.lines])
    const text = words.join(' ')
    expect(text).toMatch(/Limited Use/)
    expect(text).toMatch(/180 days/)
    expect(text).toMatch(/@/)
    for (const section of PRIVACY_POLICY.sections) {
      expect(section.heading, section.heading).not.toBe('')
      expect(section.lines.length, section.heading).toBeGreaterThan(0)
    }
  })

  it('renders one page with every section, and no script', () => {
    const page = renderPrivacyPage()
    expect(page.startsWith('<!doctype html>')).toBe(true)
    expect(page).not.toMatch(/<script/)
    expect(page).toContain(`Last updated ${PRIVACY_POLICY.updated}.`)
    for (const section of PRIVACY_POLICY.sections) {
      expect(page).toContain(`<h2>${section.heading}</h2>`)
    }
  })

  it('escapes what it is given, whoever wrote it', () => {
    const page = renderPrivacyPage({
      updated: '1 <b>January</b>',
      sections: [{ heading: 'A & B', lines: ['<script>alert(1)</script>'] }],
    })
    expect(page).toContain('1 &lt;b&gt;January&lt;/b&gt;')
    expect(page).toContain('<h2>A &amp; B</h2>')
    expect(page).not.toMatch(/<script>/)
  })
})
