import { describe, expect, it } from 'vitest'
import { AskProgress } from './progress.js'

describe('AskProgress', () => {
  it('keeps a count on the running step’s own line', () => {
    const progress = new AskProgress()
    const steps = progress.track('t')
    steps.begin('Looking up 75 songs')
    steps.update('Looking up 75 songs · 25 done')
    steps.update('Looking up 75 songs · 50 done')
    expect(progress.steps('t')).toEqual([{ text: 'Looking up 75 songs · 50 done', done: false }])

    steps.done('Found 70 of 75')
    steps.update('Reading 70 songs · 10 done')
    expect(progress.steps('t')).toEqual([
      { text: 'Found 70 of 75', done: true },
      { text: 'Reading 70 songs · 10 done', done: false },
    ])
  })
})
