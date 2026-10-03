import type { ReactNode, RefObject } from 'react'
import type { FlatList, LayoutChangeEvent } from 'react-native'
import type { Song } from '@selfmp3/shared'
import type { ScrollLabel } from '../ui/components/listScrollbar.model'

/**
 * A long song list's own scrollbar. A phone and a tablet draw their own fading
 * indicator, so there is nothing to add here; a browser's is
 * `listScrollbar.web.tsx`.
 */
interface ListScrollbarOptions {
  readonly list: RefObject<FlatList<Song> | null>
  readonly songs: readonly Song[]
  readonly label: ScrollLabel
  readonly hasHeader: boolean
  readonly enabled: boolean
}

interface ListScrollbar {
  readonly onLayout: ((event: LayoutChangeEvent) => void) | undefined
  readonly overlay: ReactNode
}

const NONE: ListScrollbar = { onLayout: undefined, overlay: null }

export function useListScrollbar(_options: ListScrollbarOptions): ListScrollbar {
  return NONE
}
