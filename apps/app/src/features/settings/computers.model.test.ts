import { describe, expect, it } from 'vitest'
import { computerRow, hostOf, noComputersHint } from './computers.model'

describe('Settings › Computers', () => {
  it('reads a server by its host', () => {
    expect(hostOf('https://pi.tail3d8516.ts.net')).toBe('pi.tail3d8516.ts.net')
    expect(hostOf('http://10.0.0.190:4600/')).toBe('10.0.0.190:4600')
  })

  it('names a computer by what it calls itself, and says where it is', () => {
    const row = computerRow({
      id: '0123456789abcdef',
      server: 'https://pi.tail3d8516.ts.net',
      name: 'pi',
      createdAt: '2026-10-12T00:00:00.000Z',
    })
    expect(row.label).toBe('pi')
    expect(row.hint).toContain('pi.tail3d8516.ts.net')
  })

  it('offers the shared computer when none has been let in, and only when there is one', () => {
    expect(noComputersHint('https://pi.tail3d8516.ts.net')).toContain('pi.tail3d8516.ts.net can')
    expect(noComputersHint('')).toMatch(/^None\. /)
  })
})
