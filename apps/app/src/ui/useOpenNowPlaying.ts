import { useCallback, useRef } from 'react'
import type { RefObject } from 'react'
import type { View } from 'react-native'
import { useRouter } from 'expo-router'
import { handOffCover } from './coverHandoff'

/**
 * Opening Now Playing from the cover of the song playing: the mini player's
 * on a phone (`M2`, 1), the player bar's on a computer (`M3`, 2). Where the
 * cover is drawn is measured and handed over first, so the page's own cover
 * grows out of it; with nothing measured yet the page simply opens.
 *
 * `coverRef` goes on the view around the cover.
 */
export function useOpenNowPlaying(): { coverRef: RefObject<View | null>; open: () => void } {
  const router = useRouter()
  const coverRef = useRef<View>(null)
  const open = useCallback(() => {
    const node = coverRef.current
    if (!node) {
      router.push('/now-playing')
      return
    }
    node.measureInWindow((x, y, width) => {
      handOffCover({ x, y, size: width })
      router.push('/now-playing')
    })
  }, [router])
  return { coverRef, open }
}
