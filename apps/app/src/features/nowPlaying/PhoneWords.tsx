import type { ComponentProps, ReactNode } from 'react'
import { Text, View, type StyleProp, type ViewStyle } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { HIT_TARGET, coverSize, iconSize, space, type } from '@selfmp3/client'
import type { Guide } from '../guide/Guide'
import { useLayout } from '../../shell/useLayout'
import { rowTitle } from '../../ui/surfaces'
import { Cover } from '../../ui/components/Cover'
import { IconButton } from '../../ui/components/IconButton'
import { ChevronDown } from '../../ui/components/Icons'
import type { TouchFlag } from '../../ui/touchFlag'
import type { SongWords } from './nowPlaying.model'
import { StageLyrics } from './StageLyrics'
import { lyricsStatusText } from './stageLyrics.model'

/**
 * The phone's words view, as Now Playing draws it (`P22`) and a one-song
 * link's page draws it again (features/share/ShareSong.tsx): the head with the
 * way back, the song and the switch beside it, then the words across the page.
 * What is under them — the transport, or the link's bar and Play — is each
 * page's own.
 */

/** The size of a phone's words: from the app's own width, between 22 and 28. */
function phoneLyricSize(width: number): number {
  return Math.min(28, Math.max(22, width * 0.064))
}

/** The one lyrics guide, on the cover of either page: seen on one, it is not shown on the other. */
export const LYRICS_GUIDE_STEPS: ComponentProps<typeof Guide>['steps'] = [
  {
    gesture: 'swipe-up',
    text: 'Swipe up for lyrics',
    sub: 'Or tap the cover',
    distance: 90,
  },
]

/** The words view's head: back to the cover, the song small, and the page's switch at its end. */
export function PhoneWordsHead({
  title,
  artist,
  cover,
  coverTitle,
  onBack,
  tool,
  style,
}: {
  title: string
  artist: string
  cover: string | null | undefined
  /** What the cover's stand-in is drawn from: the page's big cover's own. */
  coverTitle: string
  onBack: () => void
  /** Romaji or pinyin, or Now Playing's Find lyrics. */
  tool: ReactNode
  /** Where the page lays it, when not across its whole width: a link's, in its one column. */
  style?: StyleProp<ViewStyle>
}): ReactNode {
  const { theme } = useUnistyles()
  return (
    <View style={[styles.head, style]}>
      <IconButton onPress={onBack} label="Back to the cover" filled>
        <ChevronDown size={iconSize.large} color={theme.colors.textPrimary} />
      </IconButton>
      <Cover uri={cover} title={coverTitle} size={coverSize.rowDense} />
      <View style={styles.titles}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.artist} numberOfLines={1}>
          {artist}
        </Text>
      </View>
      {tool}
    </View>
  )
}

/**
 * The words across the page, or what is said where they would be. It tells
 * `fingerOnWords` while a finger that came down on them is still down, so the
 * page's pull leaves a drag down to the list, which is reading back up the
 * song. `style` is where the page lays it: Now Playing's past its own
 * sides, so a line's press wash has room; a link's in its one column, the
 * wash's inset past the bar's ends.
 */
export function PhoneWordsBody({
  words,
  fingerOnWords,
  still,
  style,
}: {
  words: SongWords
  fingerOnWords: TouchFlag
  /** Held at the top, not in time: a link's song that is not the one playing. */
  still?: boolean
  style: StyleProp<ViewStyle>
}): ReactNode {
  // The app's own width, not the window's (`shell/rootWidth.ts`).
  const { width } = useLayout()
  return (
    <View
      style={[styles.body, style]}
      // Raw touches reach the view they landed in whoever holds the
      // gesture, so this is told of the lift even after the list has it.
      onTouchStart={() => fingerOnWords.set(true)}
      onTouchEnd={() => fingerOnWords.set(false)}
      onTouchCancel={() => fingerOnWords.set(false)}
    >
      {words.status === 'lyrics' ? (
        <StageLyrics
          parsed={words.parsed}
          roman={words.roman}
          focus={false}
          fontSize={phoneLyricSize(width)}
          still={still}
        />
      ) : (
        <Text style={styles.status}>{lyricsStatusText(words)}</Text>
      )}
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingTop: space.sm,
    minHeight: HIT_TARGET + space.sm,
  },
  titles: { flex: 1, minWidth: 0, gap: 1 },
  title: rowTitle(theme.colors),
  artist: {
    color: theme.colors.textSecondary,
    fontSize: type.small,
  },
  body: { flex: 1, minHeight: 0 },
  status: {
    color: theme.colors.textMuted,
    fontSize: type.sub,
    textAlign: 'center',
    marginTop: 40,
  },
}))
