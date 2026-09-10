import { describe, expect, it } from 'vitest'
import { CliUsageError, parseCli } from './args.js'

describe('parseCli', () => {
  it('defaults to help with no arguments', () => {
    expect(parseCli([]).command).toEqual({ name: 'help' })
    expect(parseCli(['help']).command).toEqual({ name: 'help' })
    expect(parseCli(['--help']).command).toEqual({ name: 'help' })
    expect(parseCli(['-h']).command).toEqual({ name: 'help' })
  })

  it('treats --version as a command, whatever else is passed', () => {
    expect(parseCli(['--version']).command).toEqual({ name: 'version' })
    expect(parseCli(['scan', '-v']).command).toEqual({ name: 'version' })
  })

  it('parses the bare commands', () => {
    expect(parseCli(['start']).command).toEqual({ name: 'start' })
    expect(parseCli(['scan']).command).toEqual({ name: 'scan' })
    expect(parseCli(['doctor']).command).toEqual({ name: 'doctor' })
  })

  it('rejects stray arguments on bare commands', () => {
    expect(() => parseCli(['scan', 'now'])).toThrow(CliUsageError)
  })

  it('collects every url for import', () => {
    const parsed = parseCli(['import', 'https://a.example/1', 'https://b.example/2'])
    expect(parsed.command).toEqual({
      name: 'import',
      urls: ['https://a.example/1', 'https://b.example/2'],
    })
  })

  it('requires at least one url for import', () => {
    expect(() => parseCli(['import'])).toThrow(/at least one url/)
  })

  it('requires exactly one destination for backup', () => {
    expect(parseCli(['backup', '/Volumes/Backup/selfmp3']).command).toEqual({
      name: 'backup',
      dest: '/Volumes/Backup/selfmp3',
    })
    expect(() => parseCli(['backup'])).toThrow(/exactly one/)
    expect(() => parseCli(['backup', 'a', 'b'])).toThrow(/exactly one/)
  })

  it('reads --url and --token and strips a trailing slash', () => {
    const parsed = parseCli(['scan', '--url', 'http://nas:4600/', '--token', 'secret'])
    expect(parsed.url).toBe('http://nas:4600')
    expect(parsed.token).toBe('secret')
    expect(parseCli(['scan']).url).toBeNull()
  })

  it('rejects unknown commands and unknown flags', () => {
    expect(() => parseCli(['dance'])).toThrow(/unknown command/)
    expect(() => parseCli(['scan', '--loud'])).toThrow()
  })
})
