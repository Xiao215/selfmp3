import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import type { ImportPreviewItem, ImportSource } from '@selfmp3/shared'
import { radius, space, type, withAlpha } from '@selfmp3/client'
import { Button } from '../../ui/components/Button'
import { Press } from '../../ui/components/Press'
import { OPACITY } from '../../ui/motion.model'
import { youtubeFoundWords, youtubeOptionWords } from './review.model'

/**
 * Where an open row's song comes from, to change (docs/features/import-sources.md).
 *
 * A song listed by 网易云 has both: 网易云's own file, when it gives the
 * whole song out, or the same song found on YouTube. A song known only by
 * its name — a Spotify list, a list of names — has YouTube's match, which is
 * looked for again by its name as it stands, for a match that was not the
 * song or a name fixed by hand. A pasted YouTube link has nothing to choose.
 */
export function SourceChoice({
  item,
  index,
  onSource,
  onLookAgain,
}: {
  item: ImportPreviewItem
  index: number
  onSource: (index: number, source: ImportSource) => void
  onLookAgain: (index: number) => void
}): ReactNode {
  const match = item.youtube?.match ?? null
  if (item.netease) {
    const free = item.netease.free
    return (
      <View style={styles.choice} accessibilityRole="radiogroup" accessibilityLabel="Download from">
        <SourceOption
          name="网易云"
          words={free ? 'The whole song' : 'Only a preview there (VIP)'}
          on={item.source === 'netease'}
          disabled={!free}
          onPress={() => onSource(index, 'netease')}
        />
        <SourceOption
          name="YouTube"
          words={youtubeOptionWords(match)}
          on={item.source === 'youtube'}
          disabled={false}
          onPress={() => onSource(index, 'youtube')}
        />
        {item.source === 'youtube' && (match === 'none' || match === 'unsure') ? (
          <Button label="Look again" variant="text" onPress={() => onLookAgain(index)} />
        ) : null}
      </View>
    )
  }
  if (!item.youtube) return null
  return (
    <View style={styles.found}>
      <Text style={[styles.foundWords, match === 'unsure' && styles.warn]} numberOfLines={1}>
        {youtubeFoundWords(match)}
      </Text>
      {match === 'looking' ? null : (
        <Button label="Look again" variant="text" onPress={() => onLookAgain(index)} />
      )}
    </View>
  )
}

/** One place a song can come from, in `SourceChoice`. */
function SourceOption({
  name,
  words,
  on,
  disabled,
  onPress,
}: {
  name: string
  words: string
  on: boolean
  disabled: boolean
  onPress: () => void
}): ReactNode {
  return (
    <Press
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityState={{ checked: on, disabled }}
      accessibilityLabel={`${name}: ${words}`}
      wrap={styles.optionPlace}
      style={[styles.option, on && styles.optionOn, disabled && styles.dim]}
    >
      <Text style={[styles.optionName, on && styles.optionNameOn]}>{name}</Text>
      <Text style={[styles.optionWords, on && styles.optionWordsOn]} numberOfLines={1}>
        {words}
      </Text>
    </Press>
  )
}

const styles = StyleSheet.create(theme => ({
  warn: { color: theme.colors.warning },
  // The open row's choice of where the song comes from: two options side by side.
  choice: { flexDirection: 'row', alignItems: 'center', gap: space.tight, flexWrap: 'wrap' },
  optionPlace: { flexGrow: 1, flexBasis: 0, minWidth: 120, maxWidth: 260 },
  option: {
    gap: 1,
    paddingHorizontal: space.md,
    paddingVertical: 7,
    borderRadius: radius.item,
    backgroundColor: theme.colors.surface0,
  },
  optionOn: { backgroundColor: theme.colors.textPrimary },
  optionName: { color: theme.colors.textPrimary, fontSize: type.sub, fontWeight: '700' },
  optionNameOn: { color: theme.colors.surface0 },
  optionWords: { color: theme.colors.textSecondary, fontSize: type.tiny },
  optionWordsOn: { color: withAlpha(theme.colors.surface0, 0.7) },
  found: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  foundWords: { flex: 1, minWidth: 0, color: theme.colors.textSecondary, fontSize: type.small },
  dim: { opacity: OPACITY.disabled },
}))
