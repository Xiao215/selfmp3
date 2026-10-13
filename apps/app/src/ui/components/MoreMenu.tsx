import { Fragment, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { space } from '@selfmp3/client'
import { IconButton } from './IconButton'
import { More } from './Icons'
import { Popover } from './Popover'
import { SheetItem } from './Sheet'

/** One thing a ⋯ menu offers. */
export interface MenuItem {
  readonly key: string
  readonly label: string
  readonly icon?: ReactNode
  /** Said at the end of the row: a size, a count. */
  readonly detail?: string
  readonly disabled?: boolean
  readonly danger?: boolean
  readonly testID?: string
  readonly onPress: () => void
  /** Begins a group of its own, set apart from the items before it by room. */
  readonly apart?: boolean
}

/**
 * The ⋯ in a page's head: a round button that names what it is for ("More
 * actions for Evening"), measured so a menu can hang off it. A tag's, an
 * artist's, a playlist's and an answer's page, and a song's own page, each
 * wrapped the same button in the same measured box and named it two ways.
 */
export function MoreButton({
  name,
  onPress,
  anchorRef,
  active = false,
  filled = true,
  disabled = false,
  caption,
  testID,
}: {
  /** What the menu is for: "More actions for <name>". */
  name: string
  onPress: () => void
  /** The box a menu is anchored to. */
  anchorRef: RefObject<View | null>
  /** Its menu is open. */
  active?: boolean
  /** On the control surface, as a button standing on its own in a header is; bare on a row. */
  filled?: boolean
  disabled?: boolean
  /** A hover caption, where the head has room to say it. */
  caption?: string
  testID?: string
}): ReactNode {
  return (
    <View ref={anchorRef} collapsable={false}>
      <IconButton
        label={`More actions for ${name}`}
        caption={caption}
        onPress={onPress}
        active={active}
        filled={filled}
        disabled={disabled}
        testID={testID}
      >
        <More size={18} tone={filled ? 'textPrimary' : 'textSecondary'} />
      </IconButton>
    </View>
  )
}

/**
 * The menu itself, hung off whatever opened it: a ⋯ (`MoreMenu`), or a row
 * right-clicked in Up next. Every item closes the menu, then acts; groups are
 * set apart by room. One width and one look for every menu of things to do.
 */
export function Menu({
  open,
  onClose,
  anchorRef,
  items,
  title,
  align = 'end',
  testID,
}: {
  open: boolean
  onClose: () => void
  anchorRef: RefObject<View | null>
  items: readonly MenuItem[]
  /** Shown over the items when the menu is a phone's sheet. */
  title?: string
  /** `start` for a menu that would otherwise hang back over what is beside its anchor. */
  align?: 'start' | 'end'
  testID?: string
}): ReactNode {
  return (
    <Popover
      open={open}
      onClose={onClose}
      anchorRef={anchorRef}
      title={title}
      width={MENU_WIDTH}
      align={align}
      testID={testID}
    >
      {items.map((item, index) => (
        <Fragment key={item.key}>
          {item.apart && index > 0 ? <View style={styles.gap} /> : null}
          <SheetItem
            icon={item.icon}
            label={item.label}
            detail={item.detail}
            disabled={item.disabled}
            danger={item.danger}
            testID={item.testID}
            onPress={() => {
              onClose()
              item.onPress()
            }}
          />
        </Fragment>
      ))}
    </Popover>
  )
}

/**
 * A ⋯ and the menu it opens: on a list page, what can be done to the page's
 * songs (`useListActions`) and what the page adds of its own; on a row, what
 * can be done to the row. One width and one look for every one of them, which
 * had been seven menus drawn seven ways.
 *
 * It keeps whether it is open itself, unless `open` and `onOpenChange` are
 * given: an import's row lights while its menu is open, so the row holds it.
 */
export function MoreMenu({
  name,
  items,
  title,
  anchorRef,
  align = 'end',
  filled = true,
  disabled = false,
  open: openProp,
  onOpenChange,
  caption,
  testID,
  menuTestID,
}: {
  /** What the menu is for, as its button names it. */
  name: string
  items: readonly MenuItem[]
  /** Shown over the items when the menu is a phone's sheet. */
  title?: string
  /**
   * The ⋯'s box, when something else the page opens hangs off it too (a tag's
   * editor). Left out, the menu keeps its own.
   */
  anchorRef?: RefObject<View | null>
  /** `start` for a ⋯ beside the head's buttons, whose menu would otherwise hang back over them. */
  align?: 'start' | 'end'
  /** The ⋯ on the control surface (a page's head, the default) or bare (a row's). */
  filled?: boolean
  disabled?: boolean
  /** Whether the menu is open, for a caller that holds it; with `onOpenChange`. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  caption?: string
  testID?: string
  menuTestID?: string
}): ReactNode {
  const [ownOpen, setOwnOpen] = useState(false)
  const open = openProp ?? ownOpen
  const setOpen = (next: boolean): void => {
    setOwnOpen(next)
    onOpenChange?.(next)
  }
  const own = useRef<View>(null)
  const anchor = anchorRef ?? own
  return (
    <>
      <MoreButton
        name={name}
        onPress={() => setOpen(!open)}
        anchorRef={anchor}
        active={open}
        filled={filled}
        disabled={disabled}
        caption={caption}
        testID={testID}
      />
      <Menu
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={anchor}
        items={items}
        title={title}
        align={align}
        testID={menuTestID}
      />
    </>
  )
}

/** Wide enough for "Save a copy as playlist" and a size beside Download. */
const MENU_WIDTH = 250

const styles = StyleSheet.create({
  // Groups are told apart by the room between them, not a line.
  gap: { height: space.sm },
})
