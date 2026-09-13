export interface SliderProps {
  value: number
  min: number
  max: number
  step: number
  /** What the slider sets, read out with its value. */
  label: string
  /** Every movement, for something cheap to follow along (a colour). */
  onChange?: (value: number) => void
  /** Where the drag ends, for something worth saving once (a server setting). */
  onCommit?: (value: number) => void
  /** The accent picker's rainbow track instead of a filled one. */
  hue?: boolean
  width?: number
}
