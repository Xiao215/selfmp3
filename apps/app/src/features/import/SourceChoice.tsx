import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import type { ImportPreviewItem, ImportSource } from '@selfmp3/shared'
import { radius, space, type, withAlpha } from '@selfmp3/client'
import { Button } from '../../ui/components/Button'
import { Cover } from '../../ui/components/Cover'
import { Press } from '../../ui/components/Press'
import { OPACITY } from '../../ui/motion.model'
import { foundAs, youtubeFoundWords, youtubeOptionWords } from './review.model'

/**
 * Where an open row's song comes from, to change (docs/features/import-sources.md).
 *
 * A song listed by 网易云 has both: 网易云's own file, when it gives the
 * whole song out, or the same song found on YouTube. A song known only by
 * its name — a Spotify list, a list of names — has YouTube's match, which is
 * looked for again by its name as it stands, for a match that was not the
 * song or a name fixed by hand. A pasted YouTube link has nothing to choose.
 *
 * The row is named by where it was listed, so when YouTube's song goes by
 * other names — another script's spelling, or another singer altogether —
 * the row says what YouTube has (`foundAs`), with its cover when that is not
 * the row's own.
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
  const as = foundAs(item)
  const found = item.youtube?.found
  // YouTube's cover only where the row wears another: a row with none of its own took YouTube's.
  const cover =
    as !== null && found?.thumbnail && found.thumbnail !== item.thumbnail ? (
      <Cover uri={found.thumbnail} title={found.title} size={FOUND_COVER} />
    ) : null
  if (item.netease) {
    const free = item.netease.free
    return (
      <View style={styles.sources}>
        <View
          style={styles.choice}
          accessibilityRole="radiogroup"
          accessibilityLabel="Download from"
        >
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
        {item.source === 'youtube' && as !== null ? (
          <View style={styles.found}>
            {cover}
            <Text style={[styles.foundWords, match === 'unsure' && styles.warn]} numberOfLines={2}>
              {`YouTube has ${as}`}
            </Text>
          </View>
        ) : null}
      </View>
    )
  }
  if (!item.youtube) return null
  return (
    <View style={styles.found}>
      {cover}
      <Text style={[styles.foundWords, match === 'unsure' && styles.warn]} numberOfLines={2}>
        {youtubeFoundWords(match, as)}
      </Text>
      {match === 'looking' ? null : (
        <Button label="Look again" variant="text" onPress={() => onLookAgain(index)} />
      )}
    </View>
  )
}

/** YouTube's cover beside what it calls the song: small, a mark of whose song it is. */
const FOUND_COVER = 28

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
  sources: { gap: space.sm },
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
