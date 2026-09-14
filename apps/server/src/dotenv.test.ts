import { describe, expect, it } from 'vitest'
import { dotEnvCandidates } from './dotenv.js'

/*
 * Where a machine's `.env` is looked for. The point is the second place: a
 * worktree branched from the main checkout has no `.env` of its own, and a
 * server started there would run without the token one folder over.
 */
describe('dotEnvCandidates', () => {
  it('reads the main checkout’s .env once, from the main checkout', () => {
    expect(dotEnvCandidates('/Users/x/selfmp3', '.git')).toEqual(['/Users/x/selfmp3/.env'])
  })

  it('reads a worktree’s own .env, then the main checkout’s', () => {
    expect(
      dotEnvCandidates('/Users/x/selfmp3/.claude/worktrees/w1', '/Users/x/selfmp3/.git'),
    ).toEqual(['/Users/x/selfmp3/.claude/worktrees/w1/.env', '/Users/x/selfmp3/.env'])
  })

  it('looks nowhere outside a repository', () => {
    expect(dotEnvCandidates(undefined, undefined)).toEqual([])
  })
})
