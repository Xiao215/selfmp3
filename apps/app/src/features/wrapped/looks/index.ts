import type { ReactNode } from 'react'
import { radius } from '@selfmp3/client'
import type { LookId } from '../looks.model'
import { CALENDAR_SIZE, CalendarLook } from './Calendar'
import { FRONT_SIZE, FrontPageLook } from './FrontPage'
import { PAPER_SIZE, PaperLook } from './Paper'
import type { LookProps } from './parts'
import { RECEIPT_SIZE, ReceiptLook } from './Receipt'
import { WALL_SIZE, WallLook } from './Wall'
import { WORDS_SIZE, WordsLook } from './Words'

export type { LookProps } from './parts'

/**
 * How each look is drawn: its component, the size it was designed at, and the
 * corners of the object it is (a sheet, a slip, a poster). The page scales the
 * whole design to the room it has (`Scaled`), so a look is laid out once, at
 * its board's size, and reads the same on a phone and a computer — a picture,
 * not a layout.
 */
interface LookView {
  readonly Look: (props: LookProps) => ReactNode
  readonly size: { readonly width: number; readonly height: number }
  readonly corner: number
}

export const LOOK_VIEWS: Record<LookId, LookView> = {
  front: { Look: FrontPageLook, size: FRONT_SIZE, corner: 6 },
  paper: { Look: PaperLook, size: PAPER_SIZE, corner: radius.sheet },
  receipt: { Look: ReceiptLook, size: RECEIPT_SIZE, corner: 4 },
  wall: { Look: WallLook, size: WALL_SIZE, corner: radius.cardLg },
  calendar: { Look: CalendarLook, size: CALENDAR_SIZE, corner: radius.cardLg },
  words: { Look: WordsLook, size: WORDS_SIZE, corner: radius.cardLg },
}
