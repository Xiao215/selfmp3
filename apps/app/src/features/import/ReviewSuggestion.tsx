import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { iconSize, space, type } from '@selfmp3/client'
import { label as groupLabel } from '../../ui/surfaces'
import { Button } from '../../ui/components/Button'
import { Sparkle } from '../../ui/components/Icons'
import type { Rename } from './review.model'
import {
  changesWords,
  suggestionChanges,
  type NameChange,
  type NameSuggestion,
} from './importNames.model'

/*
 * The model's names for a review's row (A9, `useImportNames`): the sparkle,
 * each name it would change, why, and Use. ReviewRows.tsx draws them under a
 * phone's row and its open card, and on a computer's grid.
 */

/**
 * The model's names for a row (A9), under it where it has no columns — a
 * phone's row, or its open card: the sparkle, each name it would change with
 * what it is (Title, Artist, Album), why, and Use, which renames the row as
 * typing would. The names it keeps are left out. Only a row coming in has
 * one; a song the library has is not offered it.
 */
export function SuggestionLine({
  suggestion,
  index,
  onUse,
  wide,
}: {
  suggestion: NameSuggestion
  index: number
  onUse: (index: number, names: Rename) => void
  /** In a phone's open card: no room kept for the box. */
  wide: boolean
}): ReactNode {
  const changes = suggestionChanges(suggestion)
  return (
    <View
      style={[styles.suggestion, wide && styles.suggestionWide]}
      testID={`import-suggestion-${index}`}
    >
      <Sparkle size={iconSize.sub} />
      <View style={styles.suggestionWords}>
        {changes.map(change => (
          <View key={change.name} style={styles.suggestionChange}>
            <Text style={styles.suggestionLabel} numberOfLines={1}>
              {change.label}
            </Text>
            <SuggestedName change={change} />
          </View>
        ))}
        <SuggestionWhy why={suggestion.why} />
      </View>
      <UseSuggestion suggestion={suggestion} changes={changes} index={index} onUse={onUse} />
    </View>
  )
}

/**
 * A name the model would give, in the sparkle's accent so the sparkle, the
 * names and Use read as one thing; what leaving it empty would mean ("No
 * album") stays quiet.
 */
export function SuggestedName({ change }: { change: NameChange }): ReactNode {
  return (
    <Text style={[styles.suggestionName, change.empty && styles.suggestionEmpty]} numberOfLines={1}>
      {change.words}
    </Text>
  )
}

/** Use, the sparkle on a small accent pill: all three of the model's names at once, as one rename. */
export function UseSuggestion({
  suggestion,
  changes,
  index,
  onUse,
}: {
  suggestion: NameSuggestion
  changes: readonly NameChange[]
  index: number
  onUse: (index: number, names: Rename) => void
}): ReactNode {
  const { title, artist, album } = suggestion
  return (
    <Button
      label="Use"
      icon={<Sparkle tone="onAccent" />}
      variant="primary"
      size="small"
      onPress={() => onUse(index, { title, artist, album })}
      accessibilityLabel={`Use the suggested ${changesWords(changes)}`}
      testID={`import-suggestion-use-${index}`}
    />
  )
}

/** Why the model would rename the row, quietly, under the names. */
export function SuggestionWhy({ why }: { why: string }): ReactNode {
  return (
    <Text style={styles.suggestionWhy} numberOfLines={1}>
      {why}
    </Text>
  )
}

const styles = StyleSheet.create(theme => ({
  // The model's names for a row: the sparkle, the names it changes and why, and Use.
  suggestion: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingLeft: 34 + space.sm,
    paddingBottom: space.sm,
  },
  suggestionWide: { paddingLeft: 0, paddingBottom: 0 },
  suggestionWords: { flex: 1, minWidth: 0, gap: 1 },
  suggestionChange: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm },
  // Wide enough for ARTIST, as the open card's field labels are.
  suggestionLabel: {
    ...groupLabel(theme.colors),
    width: 52,
    fontSize: type.tiny,
    letterSpacing: 0.7,
  },
  suggestionName: { flexShrink: 1, color: theme.colors.accentStrong, fontSize: type.sub },
  suggestionEmpty: { color: theme.colors.textMuted },
  suggestionWhy: { color: theme.colors.textMuted, fontSize: type.tiny },
}))
