import { afterEach, describe, expect, it } from 'vitest'
import { handleRemoteCommands, sendRemoteCommand, type RemoteCommand } from './remoteCommands'

describe('remote commands', () => {
  let stop: () => void = () => undefined

  afterEach(() => stop())

  it('reach the player while it listens, and say when nothing does', () => {
    const heard: RemoteCommand[] = []
    stop = handleRemoteCommands(command => heard.push(command))

    expect(sendRemoteCommand('next')).toBe(true)
    expect(sendRemoteCommand('previous')).toBe(true)
    expect(heard).toEqual(['next', 'previous'])

    stop()
    // The service then skips in the OS player's own queue instead.
    expect(sendRemoteCommand('next')).toBe(false)
  })

  it('go to the newest listener, and an older one stopping does not silence it', () => {
    const older: RemoteCommand[] = []
    const newer: RemoteCommand[] = []
    const stopOlder = handleRemoteCommands(command => older.push(command))
    stop = handleRemoteCommands(command => newer.push(command))

    stopOlder()
    expect(sendRemoteCommand('next')).toBe(true)
    expect(older).toEqual([])
    expect(newer).toEqual(['next'])
  })
})
