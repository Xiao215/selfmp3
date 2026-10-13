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
  /** On the control surface, as a button standing on its own in a header is. */
  filled?: boolean
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
        testID={testID}
      >
        <More size={18} tone="textPrimary" />
      </IconButton>
    </View>
  )
}

/**
 * A page's ⋯ and the menu it opens: what can be done to the page's songs
 * (`useListActions`) and what the page adds of its own. Every item closes the
 * menu, then acts. One width and one look for every list page's menu, which
 * had been four menus drawn four ways.
 */
export function MoreMenu({
  name,
  items,
  title,
  anchorRef,
  align = 'end',
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
  caption?: string
  testID?: string
  menuTestID?: string
}): ReactNode {
  const [open, setOpen] = useState(false)
  const own = useRef<View>(null)
  const anchor = anchorRef ?? own
  return (
    <>
      <MoreButton
        name={name}
        onPress={() => setOpen(was => !was)}
        anchorRef={anchor}
        active={open}
        caption={caption}
        testID={testID}
      />
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={anchor}
        title={title}
        width={MENU_WIDTH}
        align={align}
        testID={menuTestID}
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
                setOpen(false)
                item.onPress()
              }}
            />
          </Fragment>
        ))}
      </Popover>
    </>
  )
}

/** Wide enough for "Save a copy as playlist" and a size beside Download. */
const MENU_WIDTH = 250

const styles = StyleSheet.create({
  // Groups are told apart by the room between them, not a line.
  gap: { height: space.sm },
})
