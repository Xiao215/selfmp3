import type { ReactNode } from 'react'
import { View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { iconSize, radius } from '@selfmp3/client'
import { Cover } from '../../ui/components/Cover'
import { Link as LinkIcon } from '../../ui/components/Icons'
import { OPACITY } from '../../ui/motion.model'

/**
 * An import's picture, and once it has failed one small red dot on its
 * corner (AB1): the row's only red, so three failures read as three dots
 * rather than a red wall of reasons and retries. A link nothing is known
 * about yet (`untitled`, and no picture) is drawn as a link rather than as the
 * first letter of its kind. `dim` is for a row that cannot play yet
 * (Library's songs on their way); the dot is never dimmed.
 */
export function ImportCover({
  uri,
  title,
  size,
  failed,
  untitled = false,
  dim = false,
}: {
  uri: string | null | undefined
  title: string
  size: number
  failed: boolean
  untitled?: boolean
  dim?: boolean
}): ReactNode {
  return (
    <View>
      <View style={dim && styles.dim}>
        {untitled && !uri ? (
          <View style={[styles.link, { width: size, height: size }]}>
            <LinkIcon size={iconSize.item} tone="textSecondary" />
          </View>
        ) : (
          <Cover uri={uri} title={title} size={size} />
        )}
      </View>
      {failed ? <View style={styles.dot} testID="import-failed-dot" /> : null}
    </View>
  )
}

/** The dot, and the ring of the ground round it that sets it off the picture. */
const DOT = 14
const RING = 2

const styles = StyleSheet.create(theme => ({
  dim: { opacity: OPACITY.dim },
  link: {
    borderRadius: radius.cover,
    backgroundColor: theme.colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    position: 'absolute',
    right: -RING - 1,
    bottom: -RING - 1,
    width: DOT,
    height: DOT,
    borderRadius: radius.pill,
    backgroundColor: theme.colors.danger,
    borderWidth: RING,
    borderColor: theme.colors.surface0,
  },
}))
