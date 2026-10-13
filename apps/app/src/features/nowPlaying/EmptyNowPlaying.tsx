import type { ReactNode } from 'react'
import { View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { space, iconSize } from '@selfmp3/client'
import { useEscape } from '../../shell/useEscape'
import { useLayoutValue } from '../../shell/useLayout'
import { EmptyState } from '../../ui/components/EmptyState'
import { IconButton } from '../../ui/components/IconButton'
import { ChevronDown } from '../../ui/components/Icons'
import { HEAD_LEFT } from './stageHead'

/**
 * Now Playing with no song loaded, on a computer's stage and on a phone's page
 * alike: the way down where each page keeps it, and "Nothing playing" in the
 * middle. Escape closes it, as it closes the stage.
 *
 * A page whose song went while it was open puts itself away instead
 * (`useNowPlayingSong`); this is the page opened with nothing playing at all.
 */
export function EmptyNowPlaying({ onClose }: { onClose: () => void }): ReactNode {
  const { theme } = useUnistyles()
  const wide = useLayoutValue(layout => layout.wide)
  const insets = useSafeAreaInsets()
  useEscape(true, onClose)
  return (
    <View
      style={[styles.page, { paddingTop: insets.top, paddingBottom: insets.bottom }]}
      accessibilityLabel="Now playing"
    >
      <View style={[styles.head, wide ? styles.headWide : styles.headPhone]}>
        {/* Filled on a phone, over a page of the song's colour; bare in the stage's head. */}
        <IconButton onPress={onClose} label="Close now playing" caption="Close" filled={!wide}>
          <ChevronDown
            size={iconSize.large}
            color={wide ? theme.colors.textSecondary : theme.colors.textPrimary}
          />
        </IconButton>
      </View>
      <EmptyState
        style={styles.empty}
        title="Nothing playing"
        line="Start a song and it turns up here, with its lyrics."
      />
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  page: { flex: 1, backgroundColor: theme.colors.surface0 },
  head: { flexDirection: 'row', alignItems: 'center' },
  // Where each layout's own head puts its chevron.
  headWide: { height: 60, paddingLeft: HEAD_LEFT },
  headPhone: { paddingTop: space.sm, paddingHorizontal: space.lg - space.xs },
  // The whole page, with the words in its middle.
  empty: { flex: 1, justifyContent: 'center' },
}))
