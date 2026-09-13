import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { colors, oklchToHex } from '@selfmp3/client'
import { useAccent } from '../accent'
import { fractionOf } from './slider.model'
import type { SliderProps } from './slider.types'

/*
 * A browser already has a good slider, keyboard and all, so on the web this is
 * the web app's `input[type='range']` with its stylesheet. The thumb can only be
 * styled from CSS, so the rules are added to the page once.
 */
const HUE_STOPS = [0, 60, 120, 180, 240, 300, 360]
  .map(hue => oklchToHex(0.72, 0.16, hue))
  .join(', ')
const CSS = `
.selfmp3-range { appearance: none; -webkit-appearance: none; box-sizing: border-box; margin: 0;
  height: 20px; padding: 8px 0; border-radius: 2px; cursor: pointer; background-clip: content-box;
  background-color: transparent;
  background-image: linear-gradient(to right, var(--range-fill) 0%, var(--range-fill) var(--progress),
    ${colors.surface3} var(--progress), ${colors.surface3} 100%); }
.selfmp3-range::-webkit-slider-thumb { -webkit-appearance: none; width: 13px; height: 13px;
  border-radius: 50%; background: ${colors.textPrimary}; border: none; opacity: 0;
  transition: opacity 120ms; }
.selfmp3-range:hover::-webkit-slider-thumb, .selfmp3-range:active::-webkit-slider-thumb,
.selfmp3-range:focus-visible::-webkit-slider-thumb { opacity: 1; }
.selfmp3-range::-moz-range-thumb { width: 13px; height: 13px; border-radius: 50%;
  background: ${colors.textPrimary}; border: none; }
.selfmp3-range.is-hue { height: 22px; border-radius: 999px;
  background-image: linear-gradient(to right, ${HUE_STOPS}); }
.selfmp3-range.is-hue::-webkit-slider-thumb { opacity: 1; width: 15px; height: 15px;
  border: 2px solid ${colors.surface0}; }
`

if (typeof document !== 'undefined' && !document.getElementById('selfmp3-range')) {
  const style = document.createElement('style')
  style.id = 'selfmp3-range'
  style.textContent = CSS
  document.head.appendChild(style)
}

export function Slider({
  value,
  min,
  max,
  step,
  label,
  onChange,
  onCommit,
  hue = false,
  width = 140,
}: SliderProps): ReactNode {
  const accent = useAccent()
  const ref = useRef<HTMLInputElement>(null)
  // What the thumb shows while it is ahead of the saved value. Tied to the
  // value it moved away from, so a new value from anywhere wins.
  const [local, setLocal] = useState<{ value: number; from: number } | null>(null)
  const shown = local && local.from === value ? local.value : value

  const commit = useRef(onCommit)
  useEffect(() => {
    commit.current = onCommit
  }, [onCommit])
  // A range input's own `change` fires once, where the drag ends; React's
  // onChange fires on every step, so it is listened for directly.
  useEffect(() => {
    const input = ref.current
    if (!input) return undefined
    const done = (): void => commit.current?.(Number(input.value))
    input.addEventListener('change', done)
    return () => input.removeEventListener('change', done)
  }, [])

  const style = {
    width,
    '--progress': `${fractionOf(shown, { min, max, step }) * 100}%`,
    '--range-fill': accent.accent,
  } as React.CSSProperties

  return (
    <input
      ref={ref}
      type="range"
      className={hue ? 'selfmp3-range is-hue' : 'selfmp3-range'}
      min={min}
      max={max}
      step={step}
      value={shown}
      aria-label={label}
      style={style}
      onChange={event => {
        const next = Number(event.target.value)
        setLocal({ value: next, from: value })
        onChange?.(next)
      }}
    />
  )
}
