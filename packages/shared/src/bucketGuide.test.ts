import { describe, expect, it } from 'vitest'
import {
  BUCKET_GUIDE,
  BUCKET_GUIDE_URL,
  guideParts,
  guideText,
  renderBucketGuidePage,
} from './bucketGuide.js'

describe('the bucket guide', () => {
  it('is published beside the web app', () => {
    expect(BUCKET_GUIDE_URL).toBe('https://xiao215.github.io/selfmp3/bucket.html')
  })

  it('warns about every default the doorman refuses, before it has to', () => {
    const text = BUCKET_GUIDE.steps.flatMap(step => [step.detail, ...step.more]).join(' ')
    expect(text).toMatch(/Keep only the last version of the file/)
    expect(text).toMatch(/not All/)
    expect(text).toMatch(/master application key/)
    expect(text).toMatch(/Read and Write/)
    expect(text).toMatch(/Caps & Alerts/)
  })

  it('opens with signing up, and every step has both its short and its long words', () => {
    expect(BUCKET_GUIDE.steps[0]?.link?.url).toMatch(/sign-up/)
    for (const step of BUCKET_GUIDE.steps) {
      expect(step.detail, step.title).not.toBe('')
      expect(step.more.length, step.title).toBeGreaterThan(0)
      // An odd number of ** would leave a label open.
      for (const line of [step.detail, ...step.more]) {
        expect(line.split('**').length % 2, line).toBe(1)
      }
    }
  })

  it('marks the console’s labels', () => {
    expect(guideParts('Press **Buckets**, then **Create a Bucket**.')).toEqual([
      { text: 'Press ', label: false },
      { text: 'Buckets', label: true },
      { text: ', then ', label: false },
      { text: 'Create a Bucket', label: true },
      { text: '.', label: false },
    ])
    expect(guideText('Press **Buckets**.')).toBe('Press Buckets.')
  })

  it('renders one page with every step, and no script', () => {
    const page = renderBucketGuidePage()
    expect(page.startsWith('<!doctype html>')).toBe(true)
    expect(page).not.toMatch(/<script/)
    expect(page).not.toContain('**')
    BUCKET_GUIDE.steps.forEach((step, index) => {
      expect(page).toContain(`<h2>${index + 1}. ${step.title}</h2>`)
    })
    expect(page).toContain('<strong>Create a Bucket</strong>')
  })

  it('escapes what it is given, whoever wrote it', () => {
    const page = renderBucketGuidePage({
      intro: ['<b>hi</b>'],
      steps: [
        {
          title: 'A & B',
          detail: 'x',
          more: ['**<i>label</i>**'],
          link: { label: 'Go', url: 'https://example.com/?a="1"' },
        },
      ],
      refusals: [{ says: '<script>', fix: 'none' }],
    })
    expect(page).toContain('&lt;b&gt;hi&lt;/b&gt;')
    expect(page).toContain('<h2>1. A &amp; B</h2>')
    expect(page).toContain('<strong>&lt;i&gt;label&lt;/i&gt;</strong>')
    expect(page).toContain('href="https://example.com/?a=&quot;1&quot;"')
    expect(page).not.toMatch(/<script>/)
  })
})
