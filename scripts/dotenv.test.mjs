import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { dotEnvCandidates } from './dotenv.mjs'

/** A path as this machine spells it: on Windows, with a drive and `\`. */
const native = posix => resolve(posix)

/*
 * Where a machine's `.env` is looked for. The point is the second place: a
 * worktree branched from the main checkout has no `.env` of its own, and its
 * builds went ad-hoc for want of a certificate name that was one folder over.
 */
describe('dotEnvCandidates', () => {
  it('reads the main checkout’s .env once, from the main checkout', () => {
    expect(dotEnvCandidates('/Users/x/selfmp3', '.git')).toEqual([native('/Users/x/selfmp3/.env')])
  })

  it('reads a worktree’s own .env, then the main checkout’s', () => {
    expect(
      dotEnvCandidates('/Users/x/selfmp3/.claude/worktrees/w1', '/Users/x/selfmp3/.git'),
    ).toEqual([
      native('/Users/x/selfmp3/.claude/worktrees/w1/.env'),
      native('/Users/x/selfmp3/.env'),
    ])
  })

  it('looks nowhere outside a repository', () => {
    expect(dotEnvCandidates(undefined, undefined)).toEqual([])
  })
})
