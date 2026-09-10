import { useEffect, useRef, useState } from 'react'
import { pickResumeState, type Device } from '@selfmp3/shared'
import { usePlayer } from '../player/PlayerProvider.js'
import { useLibrary } from '../lib/queries.js'
import { X } from '../components/Icons.js'
import { useDeviceContext } from './DevicesProvider.js'
import { handoffTarget, shortDeviceName } from './handoff.js'

/**
 * "Continue where you left off on your phone."
 *
 * Offered once per launch, never again after it is dismissed or taken, and
 * only when it would actually tell you something: nothing is playing here and
 * the freshest state elsewhere is a different song from whatever this device
 * restored from its own storage.
 *
 * It loads the song **paused**. Starting audio on its own, from a decision
 * this app made rather than one you made, is the behaviour every music app
 * gets shouted at for.
 */
export function ResumeToast() {
  const { deviceId, devices } = useDeviceContext()
  const player = usePlayer()
  const { data: library } = useLibrary()

  const [candidate, setCandidate] = useState<Device | null>(null)
  // The offer is a launch-time decision; re-deciding as devices come and go
  // would make a toast pop up an hour into a session.
  const decided = useRef(false)

  const playerRef = useRef(player)
  playerRef.current = player

  useEffect(() => {
    if (decided.current) return
    if (devices.length === 0 || !library) return
    decided.current = true

    const player = playerRef.current
    if (player.playing) return

    const picked = pickResumeState(devices, { thisDeviceId: deviceId, now: Date.now() })
    if (!picked) return
    // Nothing to say if this device already has that very song loaded.
    if (picked.state.songId === (player.current?.id ?? null)) return
    if (!library.songs.some(song => song.id === picked.state.songId)) return

    setCandidate(picked)
  }, [devices, library, deviceId])

  if (!candidate) return null

  const song = library?.songs.find(item => item.id === candidate.state.songId)
  if (!song) return null

  return (
    <div className="resume-toast" role="status">
      <button
        type="button"
        className="resume-toast-main"
        onClick={() => {
          const target = handoffTarget(candidate.state, Date.now())
          setCandidate(null)
          if (!target) return
          void playerRef.current.playQueue(target.queueIds, target.index, {
            position: target.position,
            autoplay: false,
            shuffle: candidate.state.shuffle,
            repeat: candidate.state.repeat,
          })
        }}
      >
        <span className="resume-toast-label">Continue</span>
        <span className="resume-toast-song">
          {song.title} — {song.artist || 'Unknown artist'}
        </span>
        <span className="resume-toast-from">from {shortDeviceName(candidate.name)}</span>
      </button>

      <button
        type="button"
        className="icon-button icon-button-tiny"
        onClick={() => setCandidate(null)}
        aria-label="Dismiss"
      >
        <X size={15} />
      </button>
    </div>
  )
}
