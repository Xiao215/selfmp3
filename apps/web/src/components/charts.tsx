import { useId, useState } from 'react'

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
 *  - Thin marks with a rounded data-end and a square baseline.
 *  - Hairline, solid, recessive gridlines. Never dashed.
 *  - Text always wears text tokens, never the series colour.
 *  - Every chart has a hover tooltip and a table fallback for screen readers.
 */

const SERIES = 'var(--chart-series)'
const GRID = 'var(--chart-grid)'

export interface ColumnDatum {
  readonly label: string
  readonly value: number
  /** Longer label shown in the tooltip. */
  readonly detail?: string
}

/**
 * A column chart for values over time.
 *
 * Bars are capped at 24px and never fill their slot — the leftover space is
 * what makes a dense series readable rather than a solid block.
 */
export function ColumnChart({
  data,
  height = 160,
  unit = '',
  emptyMessage = 'No activity yet',
  labelEvery,
}: {
  data: readonly ColumnDatum[]
  height?: number
  unit?: string
  emptyMessage?: string
  /** Show an x label every Nth column; defaults to something sensible. */
  labelEvery?: number
}) {
  const [hovered, setHovered] = useState<number | null>(null)
  const titleId = useId()

  if (data.length === 0) return <p className="chart-empty">{emptyMessage}</p>

  const max = Math.max(...data.map(datum => datum.value), 1)
  const niceMax = niceCeiling(max)
  const step = data.length > 0 ? 100 / data.length : 100
  // Cap the bar so a sparse series does not render as slabs.
  const barWidth = Math.min(step * 0.62, 3.2)
  const everyN = labelEvery ?? Math.max(1, Math.ceil(data.length / 7))

  return (
    <figure className="chart" aria-labelledby={titleId}>
      <div className="chart-plot" style={{ height }}>
        <svg
          viewBox={`0 0 100 ${height}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`Column chart, ${data.length} points, maximum ${niceMax}${unit}`}
        >
          {/* Gridlines: solid hairlines, one step off the surface. */}
          {[0, 0.5, 1].map(fraction => (
            <line
              key={fraction}
              x1={0}
              x2={100}
              y1={height - fraction * (height - 8)}
              y2={height - fraction * (height - 8)}
              stroke={GRID}
              strokeWidth={0.5}
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {data.map((datum, index) => {
            const barHeight =
              niceMax > 0 ? Math.max(datum.value > 0 ? 2 : 0, (datum.value / niceMax) * (height - 8)) : 0
            const x = index * step + (step - barWidth) / 2

            return (
              <rect
                key={index}
                x={x}
                y={height - barHeight}
                width={barWidth}
                height={barHeight}
                // A rounded data-end reads as a cap; the baseline stays square
                // because the bar grows from it.
                rx={Math.min(barWidth / 2, 1.4)}
                fill={SERIES}
                opacity={hovered === null || hovered === index ? 1 : 0.45}
                onPointerEnter={() => setHovered(index)}
                onPointerLeave={() => setHovered(null)}
              />
            )
          })}
        </svg>

        <Tooltip datum={hovered === null ? undefined : data[hovered]} left={hovered === null ? 0 : (hovered + 0.5) * step} unit={unit} />
      </div>

      <div className="chart-axis">
        {data.map((datum, index) =>
          index % everyN === 0 ? (
            <span key={index} style={{ left: `${(index + 0.5) * step}%` }}>
              {datum.label}
            </span>
          ) : null,
        )}
      </div>

      <figcaption id={titleId} className="visually-hidden">
        Maximum {niceMax}
        {unit}
      </figcaption>
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
          <span className="bar-label" title={datum.label}>
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

  return (
    <div className="chart-tooltip" style={{ left: `${left}%` }} role="status">
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
