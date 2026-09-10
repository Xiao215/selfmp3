import { useCallback, useRef } from 'react'
import type { Device, DeviceCommand, PlaybackState } from '@selfmp3/shared'
import { usePlayer } from '../player/PlayerProvider.js'
import { handoffTarget } from './handoff.js'

/**
 * Executing a command that arrived over the event stream.
 *
 * Deliberately the only place in the app that turns a `DeviceCommand` into
 * player calls. Because the command type is a discriminated union, the switch
 * below stops compiling the moment a variant is added to the shared schema
 * without a handler here — which is the whole reason the union exists rather
 * than a bag of optional fields.
 *
 * Nothing here talks to the network except `transfer`, which has to tell the
 * device it took over from to stop.
 */
export function useRemoteCommands(options: {
  /** The devices this client knows about, as a ref so the callback stays stable. */
  readonly devicesRef: { readonly current: readonly Device[] }
  /** Fire-and-forget send, used only to pause the device we take over from. */
  readonly send: (deviceId: string, command: DeviceCommand) => void
}): (command: DeviceCommand) => void {
  const player = usePlayer()
  const playerRef = useRef(player)
  playerRef.current = player

  const { devicesRef, send } = options

  /** Start playing what a state describes, from where it had got to. */
  const adopt = useCallback((state: PlaybackState, autoplay: boolean): void => {
    const target = handoffTarget(state, Date.now())
    if (!target) return
    void playerRef.current.playQueue(target.queueIds, target.index, {
      position: target.position,
      autoplay,
      shuffle: state.shuffle,
      repeat: state.repeat,
    })
  }, [])

  return useCallback(
    (command: DeviceCommand): void => {
      const player = playerRef.current

      switch (command.type) {
        case 'play':
          player.play()
          return
        case 'pause':
          player.pause()
          return
        case 'toggle':
          player.toggle()
          return
        case 'next':
          player.next()
          return
        case 'prev':
          player.previous()
          return
        case 'seek':
          player.seek(command.position)
          return
        case 'setVolume':
          player.setVolume(command.volume)
          return
        case 'playSong': {
          const queueIds = command.queueIds?.length ? command.queueIds : [command.songId]
          const index = queueIds.indexOf(command.songId)
          void player.playQueue(queueIds, index === -1 ? (command.queueIndex ?? 0) : index, {
            position: command.position ?? 0,
            autoplay: command.play ?? true,
          })
          return
        }
        case 'transfer': {
          // "Take over from that one": adopt its state, then stop it, so the
          // same song is not coming out of two rooms at once.
          const from = devicesRef.current.find(device => device.id === command.fromDeviceId)
          if (!from) return
          adopt(from.state, true)
          send(from.id, { type: 'pause' })
          return
        }
      }
    },
    [adopt, devicesRef, send],
  )
}
