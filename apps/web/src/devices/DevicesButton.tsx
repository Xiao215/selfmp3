import { useRef, useState } from 'react'
import { Devices, Remote } from '../components/Icons.js'
import { useDeviceContext } from './DevicesProvider.js'
import { DevicesPopover } from './DevicesPopover.js'
import { shortDeviceName } from './handoff.js'

/**
 * The devices button, plus the chip that explains why the transport is not
 * doing what you expect.
 *
 * Two states worth surfacing: something is playing elsewhere while this device
 * is silent, and this device is currently driving another one. Both are quiet
 * text rather than a banner — it is a status, not a problem.
 */
export function DevicesButton({
  up = true,
  showChip = true,
}: {
  up?: boolean
  showChip?: boolean
}) {
  const { others, playingElsewhere, remote } = useDeviceContext()
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)

  const chip = remote
    ? { label: `Remote · ${shortDeviceName(remote.name)}`, icon: <Remote size={13} /> }
    : playingElsewhere
      ? {
          label: `Playing on ${shortDeviceName(playingElsewhere.name)}`,
          icon: <Devices size={13} />,
        }
      : null

  return (
    <div className="popover-anchor devices-anchor">
      {chip && showChip && (
        <button
          type="button"
          className="device-chip"
          onClick={() => setOpen(value => !value)}
          title="Devices"
        >
          {chip.icon}
          <span>{chip.label}</span>
        </button>
      )}

      <button
        ref={buttonRef}
        type="button"
        className={`icon-button ${chip ? 'is-accent' : ''}`}
        onClick={() => setOpen(value => !value)}
        aria-label="Devices"
        aria-haspopup="dialog"
        aria-expanded={open}
        title={others.length > 0 ? `${others.length} other device(s) online` : 'Devices'}
      >
        {remote ? <Remote size={17} /> : <Devices size={17} />}
      </button>

      {open && <DevicesPopover anchorRef={buttonRef} onClose={() => setOpen(false)} up={up} />}
    </div>
  )
}
