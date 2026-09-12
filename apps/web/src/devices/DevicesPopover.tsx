import { formatDuration, type Device } from '@selfmp3/shared'
import { useLibrary } from '../lib/queries.js'
import { usePlayer } from '../player/PlayerProvider.js'
import { Equalizer } from '../components/Icons.js'
import { Popover } from '../components/Menu.js'
import { useDeviceContext } from './DevicesProvider.js'
import { relativeTime, shortDeviceName } from '@selfmp3/client'

/** Enough offline rows for context, before the list turns into a graveyard. */
const OFFLINE_SHOWN = 3

/**
 * The handoff popover.
 *
 * One row per device, saying what it is playing, with the two moves that
 * matter: bring it here, or send this there. Remote control is a switch rather
 * than a third button because it is a mode, not an action — while it is on, the
 * transport at the bottom of the screen belongs to that device.
 *
 * Every row leads with a status dot and a state word ("playing here", "paused",
 * "offline"), because the question this list exists to answer is "where is the
 * music, and can I move it?" — and that has to be readable at a glance.
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
  // Offline devices are listed too, quietly: a list that silently drops them
  // cannot show you that a device is offline, only that it is missing. A few
  // is context; a long tail of dead browsers belongs in Settings.
  const offlineAll = devices
    .filter(device => device.id !== deviceId && !device.online)
    .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
  const offline = offlineAll.slice(0, OFFLINE_SHOWN)
  const offlineHidden = offlineAll.length - offline.length

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
            <span
              className={`device-dot ${self?.online === false ? '' : 'is-online'}`}
              aria-hidden="true"
            />
            {name}
            <span className="device-tag">this device</span>
          </span>
          <span className="device-sub">
            {player.current ? (
              <>
                {player.playing ? (
                  <>
                    <Equalizer />
                    <span className="device-state is-here">Playing here</span>
                  </>
                ) : (
                  <span className="device-state">Paused</span>
                )}
                <span className="device-what">{titleOf(player.current.id)}</span>
              </>
            ) : (
              <span className="device-state">Nothing playing</span>
            )}
          </span>
        </div>
      </div>

      {others.length === 0 && offline.length === 0 && (
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
              <span className="device-name">
                <span className="device-dot is-online" aria-hidden="true" />
                {device.name}
                {isRemote && <span className="device-tag is-accent">controlling</span>}
              </span>
              <span className="device-sub">
                {title ? (
                  <>
                    {device.state.playing ? (
                      <>
                        <Equalizer />
                        <span className="device-state is-there">Playing there</span>
                      </>
                    ) : (
                      <span className="device-state">Paused</span>
                    )}
                    <span className="device-what">{title}</span>
                    {device.state.position > 0 && (
                      <span className="device-at">{formatDuration(device.state.position)}</span>
                    )}
                  </>
                ) : (
                  <span className="device-state">Nothing playing</span>
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
                className="toggle toggle-small"
                checked={isRemote}
                disabled={player.playing}
                onChange={event => setRemoteId(event.target.checked ? device.id : null)}
              />
              <span>
                Remote control
                {player.playing && <span className="device-at">pause here first</span>}
              </span>
            </label>
          </div>
        )
      })}

      {offline.map(device => (
        <OfflineRow key={device.id} device={device} />
      ))}

      {offlineHidden > 0 && (
        <p className="devices-empty">
          {offlineHidden} more {offlineHidden === 1 ? 'device is' : 'devices are'} offline — see
          Settings.
        </p>
      )}

      {self && !self.online && (
        <p className="devices-empty">This device has not reached the server yet.</p>
      )}
    </Popover>
  )
}

/** A device that is registered but not open right now: named, but out of reach. */
function OfflineRow({ device }: { device: Device }) {
  return (
    <div className="device-row is-offline">
      <div className="device-row-main">
        <span className="device-name">
          <span className="device-dot" aria-hidden="true" />
          {device.name}
        </span>
        <span className="device-sub">
          <span className="device-state">Offline</span>
          <span className="device-what">last seen {relativeTime(device.lastSeenAt)}</span>
        </span>
      </div>
    </div>
  )
}

/** Coarse on purpose — "3 d ago" is all this row needs to say. */