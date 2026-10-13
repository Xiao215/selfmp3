import type { ReactNode, Ref } from 'react'
import {
  FlatList as RNFlatList,
  ScrollView as RNScrollView,
  type FlatListProps,
  type ScrollViewProps,
} from 'react-native'

import { dragKeyboard } from '../../ports/keyboard'

/*
 * The app's ScrollView and FlatList: React Native's, with what an open keyboard
 * does settled here once rather than on each list (ESLint keeps screens to
 * these).
 *
 * - A tap with the keyboard up reaches the row or button it was on, instead of
 *   only putting the keyboard away (`handled`).
 * - Dragging a list puts the keyboard away so the rows under it can be seen
 *   (`dragKeyboard`). A sideways strip leaves it up: flicking through chips
 *   under a field is not being done typing.
 *
 * A list that wants otherwise says so where it is drawn; a prop it passes wins.
 */
function keyboard(props: ScrollViewProps) {
  return {
    keyboardShouldPersistTaps: props.keyboardShouldPersistTaps ?? 'handled',
    keyboardDismissMode: props.keyboardDismissMode ?? (props.horizontal ? 'none' : dragKeyboard),
  } as const
}

export function ScrollView({
  ref,
  ...props
}: ScrollViewProps & { ref?: Ref<RNScrollView> }): ReactNode {
  return <RNScrollView ref={ref} {...props} {...keyboard(props)} />
}

// The instance a ref holds, under the same name, as a class gives both.
// eslint-disable-next-line @typescript-eslint/no-redeclare
export type ScrollView = RNScrollView

export function FlatList<T>({
  ref,
  ...props
}: FlatListProps<T> & { ref?: Ref<RNFlatList<T>> }): ReactNode {
  return <RNFlatList ref={ref} {...props} {...keyboard(props)} />
}

// eslint-disable-next-line @typescript-eslint/no-redeclare
export type FlatList<T> = RNFlatList<T>
