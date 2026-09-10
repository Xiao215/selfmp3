import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api.js'
import { queryKeys } from '../lib/queries.js'
import { Trash } from '../components/Icons.js'
import { useDeviceContext } from './DevicesProvider.js'

/**
 * The devices section of Settings.
 *
 * Renaming is per-device and local: the name is what *this* browser calls
 * itself, and it reaches the server on the next heartbeat rather than through
 * a separate endpoint. Forgetting a device is the opposite — it removes a row
 * everyone can see, and a device that is still open will simply re-register
 * itself a few seconds later.
 */
export function DevicesSettings() {
  const { deviceId, name, rename, devices, connected } = useDeviceContext()
  const client = useQueryClient()
  const [draft, setDraft] = useState(name)

  // Follow the context if the name changes elsewhere, but never fight typing.
  useEffect(() => setDraft(name), [name])

  const forget = (id: string): void => {
    void api
      .forgetDevice(id)
      .then(() => client.invalidateQueries({ queryKey: queryKeys.devices }))
      .catch(() => undefined)
  }

  return (
    <section className="panel" id="devices">
      <header className="panel-head">
        <h2>Devices</h2>
        <span className="hint">{connected ? 'live updates' : 'polling'}</span>
      </header>

      <p className="panel-lead">
        Every browser you open self.mp3 in shows up here and can hand playback to any of the others.
        Nothing is stored beyond a name and what was last playing.
      </p>

      <label className="setting-row">
        <span className="setting-label">
          This device&rsquo;s name
          <span className="setting-hint">Shown on your other devices when handing off.</span>
        </span>
        <input
          className="input"
          value={draft}
          maxLength={60}
          onChange={event => setDraft(event.target.value)}
          onBlur={() => rename(draft)}
          onKeyDown={event => {
            if (event.key === 'Enter') event.currentTarget.blur()
          }}
        />
      </label>

      <ul className="device-list">
        {devices.map(device => (
          <li key={device.id} className="device-list-item">
            <span className={`device-dot ${device.online ? 'is-online' : ''}`} aria-hidden="true" />
            <span className="device-list-name">
              {device.name}
              {device.id === deviceId && <span className="device-tag">this device</span>}
            </span>
            <span className="device-list-when">
              {device.online ? 'online' : `last seen ${relativeTime(device.lastSeenAt)}`}
            </span>
            <button
              type="button"
              className="icon-button icon-button-tiny"
              onClick={() => forget(device.id)}
              aria-label={`Forget ${device.name}`}
              title="Forget this device"
            >
              <Trash size={14} />
            </button>
          </li>
        ))}
        {devices.length === 0 && <li className="device-list-empty">No devices registered yet.</li>}
      </ul>
    </section>
  )
}

/** Coarse on purpose — "3 days ago" is all anyone wants from this column. */
function relativeTime(timestamp: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  return `${Math.round(hours / 24)} d ago`
}
