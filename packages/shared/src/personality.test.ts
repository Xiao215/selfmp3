import { describe, expect, it } from 'vitest'
import { listeningPersonality, personalityLine, type PersonalityInput } from './personality.js'

function hours(plan: Record<number, number>): number[] {
  const out = Array.from({ length: 24 }, () => 0)
  for (const [hour, plays] of Object.entries(plan)) out[Number(hour)] = plays
  return out
}

function weekdays(plan: Record<number, number>): number[] {
  const out = Array.from({ length: 7 }, () => 0)
  for (const [day, plays] of Object.entries(plan)) out[Number(day)] = plays
  return out
}

/** A hundred plays spread evenly through the day and week: no strong pattern. */
const BASE: PersonalityInput = {
  plays: 100,
  songsPlayed: 40,
  hourly: Array.from({ length: 24 }, (_, hour) => (hour >= 8 && hour < 20 ? 8 : 0)),
  weekday: Array.from({ length: 7 }, () => 14),
  topFivePlays: 20,
  discovered: 0,
  longestStreakDays: 3,
  minutes: 300,
  activeDays: 20,
}

describe('listeningPersonality', () => {
  it('claims nothing on too little data', () => {
    expect(listeningPersonality({ ...BASE, plays: 9 })).toEqual(['Casual listener'])
  })

  it('is a night owl when over a third of plays are late', () => {
    const traits = listeningPersonality({
      ...BASE,
      hourly: hours({ 23: 20, 0: 10, 1: 6, 12: 64 }),
    })
    expect(traits).toContain('Night owl')
    expect(traits).not.toContain('Early bird')
  })

  it('is an early bird for morning listening, and never both at once', () => {
    const traits = listeningPersonality({ ...BASE, hourly: hours({ 6: 20, 7: 20, 14: 60 }) })
    expect(traits).toContain('Early bird')
    expect(traits).not.toContain('Night owl')
  })

  it('is a daytime listener only when the day clearly dominates', () => {
    expect(listeningPersonality(BASE)).toContain('Daytime listener')
    expect(
      listeningPersonality({ ...BASE, hourly: hours({ 12: 50, 20: 25, 21: 25 }) }),
    ).not.toContain('Daytime listener')
  })

  it('separates repeat listeners from explorers', () => {
    expect(listeningPersonality({ ...BASE, topFivePlays: 45 })).toContain('Repeat listener')
    expect(listeningPersonality({ ...BASE, songsPlayed: 70 })).toContain('Explorer')
    expect(listeningPersonality(BASE)).not.toContain('Explorer')
  })

  it('is a collector on new additions, but explorer wins when both apply', () => {
    expect(listeningPersonality({ ...BASE, discovered: 3 })).toContain('Collector')
    const both = listeningPersonality({ ...BASE, discovered: 5, songsPlayed: 80 })
    expect(both).toContain('Explorer')
    expect(both).not.toContain('Collector')
  })

  it('recognises a daily ritual and a weekend habit', () => {
    expect(listeningPersonality({ ...BASE, longestStreakDays: 7 })).toContain('Daily ritual')
    expect(listeningPersonality({ ...BASE, longestStreakDays: 6 })).not.toContain('Daily ritual')
    expect(
      listeningPersonality({ ...BASE, weekday: weekdays({ 0: 25, 6: 25, 3: 50 }) }),
    ).toContain('Weekender')
  })

  it('is a marathoner on minutes per active day', () => {
    expect(listeningPersonality({ ...BASE, minutes: 2400 })).toContain('Marathoner')
    expect(listeningPersonality({ ...BASE, minutes: 2400, activeDays: 0 })).not.toContain(
      'Marathoner',
    )
  })

  it('falls back to casual when nothing stands out', () => {
    const flat = listeningPersonality({
      ...BASE,
      hourly: hours({ 3: 20, 8: 20, 13: 20, 18: 20, 21: 20 }),
    })
    expect(flat).toEqual(['Casual listener'])
  })

  it('joins traits with a middle dot', () => {
    expect(personalityLine(['Night owl', 'Repeat listener'])).toBe('Night owl · Repeat listener')
  })
})
