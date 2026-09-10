import { formatDuration } from '@selfmp3/shared'
import { useLibrary } from '../lib/queries.js'
import { usePlayer } from '../player/PlayerProvider.js'
import { Equalizer } from '../components/Icons.js'
import { Popover } from '../components/Menu.js'
import { useDeviceContext } from './DevicesProvider.js'
import { shortDeviceName } from './handoff.js'

/**
 * The handoff popover.
 *
 * One row per online device, saying what it is playing, with the two moves
 * that matter: bring it here, or send this there. Remote control is a switch
 * rather than a third button because it is a mode, not an action — while it
 * is on, the transport at the bottom of the screen belongs to that device.
 */
export function DevicesPopover({
  anchorRef,
  onClose,
  up = true,
}: {
  anchorRef: React.RefObject<HTMLElement | null>
  onClose: () => void
  up?: boolean
}) {
  const { deviceId, name, others, devices, connected, remote, setRemoteId, playHere, playOn } =
    useDeviceContext()
  const player = usePlayer()
  const { data: library } = useLibrary()

  const titleOf = (songId: number | null): string | null => {
    if (songId === null) return null
    const song = library?.songs.find(item => item.id === songId)
    return song ? `${song.title} — ${song.artist || 'Unknown artist'}` : 'Something not in view'
  }

  const self = devices.find(device => device.id === deviceId)

  return (
    <Popover
      anchorRef={anchorRef}
      onClose={onClose}
      role="dialog"
      label="Devices"
      className="devices-popover"
      placement={up ? 'above' : 'auto'}
      focus="trap"
      sheet
    >
      <div className="popover-title">
        Devices
        <span className={`devices-link ${connected ? 'is-live' : ''}`}>
          {connected ? 'live' : 'polling'}
        </span>
      </div>

      <div className="device-row is-self">
        <div className="device-row-main">
          <span className="device-name">
            {name} <span className="device-tag">this device</span>
          </span>
          <span className="device-sub">
            {player.current ? (
              <>
                {player.playing && <Equalizer />}
                {titleOf(player.current.id)}
              </>
            ) : (
              'Nothing playing'
            )}
          </span>
        </div>
      </div>

      {others.length === 0 && (
        <p className="devices-empty">
          No other devices are open right now. Open self.mp3 on your phone and it will appear here.
        </p>
      )}

      {others.map(device => {
        const title = titleOf(device.state.songId)
        const isRemote = remote?.id === device.id
        return (
          <div key={device.id} className={`device-row ${isRemote ? 'is-remote' : ''}`}>
            <div className="device-row-main">
              <span className="device-name">{device.name}</span>
              <span className="device-sub">
                {title ? (
                  <>
                    {device.state.playing && <Equalizer />}
                    {title}
                    {device.state.playing && device.state.position > 0 && (
                      <span className="device-at"> · {formatDuration(device.state.position)}</span>
                    )}
                  </>
                ) : (
                  'Nothing playing'
                )}
              </span>
            </div>

            <div className="device-row-actions">
              <button
                type="button"
                className="button button-small"
                disabled={device.state.songId === null}
                onClick={() => {
                  playHere(device)
                  onClose()
                }}
              >
                Play here
              </button>
              <button
                type="button"
                className="button button-small"
                disabled={player.current === null}
                onClick={() => {
                  playOn(device)
                  onClose()
                }}
              >
                Play on {shortDeviceName(device.name)}
              </button>
            </div>

            <label className="device-remote">
              <input
                type="checkbox"
                checked={isRemote}
                disabled={player.playing}
                onChange={event => setRemoteId(event.target.checked ? device.id : null)}
              />
              <span>
                Remote control
                {player.playing && <span className="device-at"> · pause here first</span>}
              </span>
            </label>
          </div>
        )
      })}

      {self && !self.online && (
        <p className="devices-empty">This device has not reached the server yet.</p>
      )}
    </Popover>
  )
}
