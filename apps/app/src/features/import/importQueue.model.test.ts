import { describe, expect, it } from 'vitest'
import { linkKindName } from '@selfmp3/client'
import { IDLE_PACING, type ImportJob, type Tag } from '@selfmp3/shared'

import { arrivedLine, jobName, nextLine } from './importQueue.model'

const job = (fields: Partial<ImportJob>): ImportJob =>
  ({ title: '', url: 'https://music.youtube.com/watch?v=abc', tagIds: [], ...fields }) as ImportJob

describe('what an import is called', () => {
  it('is its title once one is found', () => {
    expect(jobName(job({ title: 'Idol' }))).toBe('Idol')
  })

  it('is the kind of link before then', () => {
    const untitled = job({})
    expect(jobName(untitled)).toBe(linkKindName(untitled.url))
  })
})

describe('where a finished import went', () => {
  const tags = [
    { id: 1, name: 'night drive' },
    { id: 2, name: 'calm' },
  ] as Tag[]

  it('names the tags it arrived with', () => {
    expect(arrivedLine(job({ tagIds: [2, 1] }), tags)).toBe(
      'In your library · tagged night drive, calm',
    )
  })

  it('says only the library without any', () => {
    expect(arrivedLine(job({}), tags)).toBe('In your library')
  })
})

describe('when the next import starts', () => {
  it('is now, with no wait', () => {
    expect(nextLine(IDLE_PACING)).toBe('Next')
  })

  it('counts the wait down, and says why', () => {
    expect(nextLine({ ...IDLE_PACING, waitMs: 38_000 })).toMatch(/^Starts in .+ · pacing YouTube$/)
    expect(nextLine({ ...IDLE_PACING, waitMs: 38_000, pausedUntil: 1_800_000_000_000 })).toMatch(
      /YouTube asked us to slow down$/,
    )
  })
})
