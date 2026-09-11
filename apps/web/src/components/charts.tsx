import { useCallback, useId, useLayoutEffect, useRef, useState } from 'react'

/**
 * Charts.
 *
 * Hand-drawn SVG rather than a charting library: the whole stats page needs
 * three chart forms, and a library would add more bundle weight than the rest
 * of the app combined — on something that has to load fast over a phone
 * connection and work offline.
 *
 * The visual rules applied throughout, which are what keep these readable:
 *  - Single series, so one colour and no legend; the heading says what it is.
 *  - Thin marks capped at 24px, with a rounded data-end and a square baseline.
 *  - Hairline, solid, recessive gridlines, labelled with round numbers. Never
 *    dashed.
 *  - Text always wears text tokens, never the series colour.
 *  - Every chart has a hover tooltip, the same tooltip from the keyboard, and
 *    a table fallback for screen readers.
 *
 * The column chart measures its container and draws in real pixels rather than
 * stretching a 0–100 viewBox: a non-uniform stretch turns a 4px rounded cap
 * into an ellipse and makes the bar-width cap meaningless.
 */

const SERIES = 'var(--chart-series)'
const GRID = 'var(--chart-grid)'

/** Widest a bar is ever allowed to be. Past this it reads as a slab. */
const MAX_BAR = 24
const MIN_BAR = 2
/** Room under the plot for the value axis to breathe. */
const TOP_PAD = 10

export interface ColumnDatum {
  readonly label: string
  readonly value: number
  /** Longer label shown in the tooltip. */
  readonly detail?: string
}

/** The rendered width of an element, kept in sync with its container. */
function useMeasuredWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    setWidth(element.clientWidth)
    const observer = new ResizeObserver(entries => {
      const entry = entries[0]
      if (entry) setWidth(Math.round(entry.contentRect.width))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return [ref, width]
}

/** A bar with a rounded data-end and a square baseline, as a path. */
function barPath(x: number, y: number, width: number, height: number): string {
  const radius = Math.min(4, width / 2, height)
  if (height <= radius) return `M${x} ${y + height}h${width}v${-height}h${-width}z`
  return [
    `M${x} ${y + height}`,
    `V${y + radius}`,
    `a${radius} ${radius} 0 0 1 ${radius} ${-radius}`,
    `h${width - radius * 2}`,
    `a${radius} ${radius} 0 0 1 ${radius} ${radius}`,
    `V${y + height}`,
    'z',
  ].join('')
}

/**
 * A column chart for values over time.
 *
 * Bars never fill their slot — the leftover space is what makes a dense series
 * readable rather than a solid block — and each column carries a full-height
 * transparent hit area, so hovering a one-play day does not mean landing on a
 * 3px sliver.
 */
export function ColumnChart({
  data,
  height = 160,
  unit = '',
  emptyMessage = 'No activity yet',
  labelEvery,
  caption,
}: {
  data: readonly ColumnDatum[]
  height?: number
  unit?: string
  emptyMessage?: string
  /** Show an x label every Nth column; defaults to something sensible. */
  labelEvery?: number
  /** What the chart plots, for the screen-reader table. */
  caption?: string
}) {
  const [hovered, setHovered] = useState<number | null>(null)
  const [plotRef, plotWidth] = useMeasuredWidth<HTMLDivElement>()
  const tableId = useId()

  const move = useCallback(
    (delta: number) => {
      setHovered(current => {
        const next = current === null ? 0 : current + delta
        return Math.max(0, Math.min(data.length - 1, next))
      })
    },
    [data.length],
  )

  if (data.length === 0) return <p className="chart-empty">{emptyMessage}</p>

  const max = Math.max(...data.map(datum => datum.value), 1)
  const niceMax = niceCeiling(max)
  const plotHeight = height - TOP_PAD
  const step = plotWidth / data.length
  const barWidth = Math.max(MIN_BAR, Math.min(step * 0.62, MAX_BAR))
  const everyN = labelEvery ?? Math.max(1, Math.ceil(data.length / 7))

  return (
    <figure className="chart">
      <div className="chart-body">
        {/* Round numbers on the gridlines carry the values nothing labels. */}
        <div className="chart-yaxis" style={{ height }} aria-hidden="true">
          <span>
            {formatNumber(niceMax)}
            {unit}
          </span>
          <span>
            {formatNumber(niceMax / 2)}
            {unit}
          </span>
          <span>0</span>
        </div>

        <div
          className="chart-plot"
          ref={plotRef}
          style={{ height }}
          tabIndex={0}
          role="group"
          aria-describedby={tableId}
          aria-label={`${caption ?? 'Chart'}. Use the left and right arrow keys to read each value.`}
          onKeyDown={event => {
            if (event.key === 'ArrowRight') {
              event.preventDefault()
              move(1)
            } else if (event.key === 'ArrowLeft') {
              event.preventDefault()
              move(-1)
            } else if (event.key === 'Home') {
              event.preventDefault()
              setHovered(0)
            } else if (event.key === 'End') {
              event.preventDefault()
              setHovered(data.length - 1)
            } else if (event.key === 'Escape') {
              setHovered(null)
            }
          }}
          onBlur={() => setHovered(null)}
          onPointerLeave={() => setHovered(null)}
        >
          {plotWidth > 0 && (
            <svg width={plotWidth} height={height} aria-hidden="true">
              {[0, 0.5, 1].map(fraction => (
                <line
                  key={fraction}
                  x1={0}
                  x2={plotWidth}
                  y1={height - fraction * plotHeight}
                  y2={height - fraction * plotHeight}
                  stroke={GRID}
                  strokeWidth={1}
                  shapeRendering="crispEdges"
                />
              ))}

              {data.map((datum, index) => {
                const barHeight =
                  niceMax > 0
                    ? Math.max(datum.value > 0 ? 2 : 0, (datum.value / niceMax) * plotHeight)
                    : 0
                const x = index * step + (step - barWidth) / 2

                return (
                  <g key={index}>
                    {barHeight > 0 && (
                      <path
                        d={barPath(x, height - barHeight, barWidth, barHeight)}
                        fill={SERIES}
                        opacity={hovered === null || hovered === index ? 1 : 0.4}
                      />
                    )}
                    {/* The hit area is the whole column, not the 3px mark. */}
                    <rect
                      x={index * step}
                      y={0}
                      width={step}
                      height={height}
                      fill="transparent"
                      onPointerEnter={() => setHovered(index)}
                    />
                  </g>
                )
              })}
            </svg>
          )}

          <Tooltip
            datum={hovered === null ? undefined : data[hovered]}
            left={
              hovered === null || plotWidth === 0 ? 0 : ((hovered + 0.5) * step * 100) / plotWidth
            }
            unit={unit}
          />
        </div>
      </div>

      <div className="chart-axis">
        {data.map((datum, index) =>
          index % everyN === 0 ? (
            <span key={index} style={{ left: `${((index + 0.5) / data.length) * 100}%` }}>
              {datum.label}
            </span>
          ) : null,
        )}
      </div>

      {/* Every value, reachable without the plot. */}
      <table className="visually-hidden" id={tableId}>
        <caption>{caption ?? 'Chart data'}</caption>
        <tbody>
          {data.map((datum, index) => (
            <tr key={index}>
              <th scope="row">{datum.detail ?? datum.label}</th>
              <td>
                {datum.value}
                {unit}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}

export interface BarDatum {
  readonly label: string
  readonly value: number
  readonly sub?: string
}

/**
 * Horizontal bars for ranked categories.
 *
 * Values are direct-labelled at the tip, so no y-axis or gridlines are needed
 * at all — the label carries what the axis would have.
 */
export function BarList({
  data,
  unit = '',
  emptyMessage = 'Nothing here yet',
  max: explicitMax,
}: {
  data: readonly BarDatum[]
  unit?: string
  emptyMessage?: string
  max?: number
}) {
  if (data.length === 0) return <p className="chart-empty">{emptyMessage}</p>

  const max = explicitMax ?? Math.max(...data.map(datum => datum.value), 1)

  return (
    <div className="bar-list">
      {data.map(datum => (
        <div key={datum.label} className="bar-row">
          <span className="bar-label" data-tip={datum.label}>
            {datum.label}
          </span>
          <span className="bar-track">
            <span
              className="bar-fill"
              style={{ width: `${Math.max(2, (datum.value / max) * 100)}%` }}
            />
          </span>
          <span className="bar-value">
            {formatNumber(datum.value)}
            {unit}
            {datum.sub && <span className="bar-sub"> {datum.sub}</span>}
          </span>
        </div>
      ))}
    </div>
  )
}

/**
 * A single headline number.
 *
 * The most under-used chart form: when the story is one value, a tile beats
 * any plot — and it is the right answer far more often than it gets used.
 */
export function StatTile({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint?: string
}) {
  return (
    <div className="stat-tile">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  )
}

/**
 * The hover tooltip.
 *
 * Split out so the datum is read from the array exactly once — indexing twice
 * and relying on a truthiness check in between is how you end up with a
 * `possibly undefined` that only shows up under a stricter compiler.
 */
function Tooltip({
  datum,
  left,
  unit,
}: {
  datum: ColumnDatum | undefined
  left: number
  unit: string
}) {
  if (!datum) return null

  // Near either edge the tooltip anchors to its own edge instead of its middle,
  // so it never hangs off the side of the panel.
  const anchor = left < 18 ? 'start' : left > 82 ? 'end' : 'center'

  return (
    <div
      className={`chart-tooltip is-${anchor}`}
      style={{ left: `${left}%` }}
      role="status"
    >
      <strong>
        {formatNumber(datum.value)}
        {unit}
      </strong>
      <span>{datum.detail ?? datum.label}</span>
    </div>
  )
}

/** Round an axis maximum up to something a person would choose. */
function niceCeiling(value: number): number {
  if (value <= 5) return 5
  if (value <= 10) return 10
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)))
  const normalized = value / magnitude
  const rounded = normalized <= 1.5 ? 1.5 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10
  return rounded * magnitude
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '0'
  if (Number.isInteger(value)) return value.toLocaleString()
  return value.toFixed(1)
}
