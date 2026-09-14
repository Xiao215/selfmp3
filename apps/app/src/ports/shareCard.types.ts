/** The colours a shared Wrapped card is drawn in: the theme on screen, resolved. */
export interface CardPalette {
  readonly background: string
  readonly surface: string
  readonly border: string
  readonly accent: string
  readonly accentDim: string
  /** The ranked rows' quiet bars, as the report page draws them. */
  readonly bar: string
  readonly text: string
  readonly secondary: string
  readonly muted: string
}
