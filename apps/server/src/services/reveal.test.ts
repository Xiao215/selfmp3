import { describe, expect, it } from 'vitest'
import { revealCommand } from './reveal.js'

// Who is allowed to ask for this at all moved to `http/local.test.ts`, with the
// check itself: the bearer exemption turns on the same question.

describe('revealCommand', () => {
  const file = '/Users/me/music/library/YOASOBI - 夜に駆ける.m4a'

  it('selects the file in Finder on a Mac', () => {
    expect(revealCommand(file, 'darwin')).toEqual({ command: 'open', args: ['-R', file] })
  })

  it('selects it in Explorer on Windows', () => {
    expect(revealCommand(file, 'win32')?.args).toEqual([`/select,${file}`])
  })

  it('opens the folder on Linux, and has nothing for other platforms', () => {
    expect(revealCommand(file, 'linux')?.args).toEqual(['/Users/me/music/library'])
    expect(revealCommand(file, 'aix')).toBeNull()
  })
})
