import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import type { AskCard } from '@selfmp3/shared'
import { iconSize, radius, space, textStyle, type } from '@selfmp3/client'
import { SelectableText } from '../../ports/selectableText'
import { Sparkle } from '../../ui/components/Icons'
import { Press } from '../../ui/components/Press'

/**
 * A question back (AGENT-DESIGN 2.4, `clarify`): asked when the words could
 * mean things that would be answered differently. Each option is a press that
 * asks its words as the next turn, as if typed; the field is there for any
 * other answer. Without a way to ask (`onAsk`), only the question is shown.
 */
export function ClarifyAnswer({
  answer,
  onAsk,
}: {
  answer: Extract<AskCard, { kind: 'clarify' }>
  onAsk?: (words: string) => void
}): ReactNode {
  return (
    <View style={styles.clarify}>
      <SelectableText style={styles.question} testID="ask-clarify-question">
        {answer.question}
      </SelectableText>
      {onAsk && answer.options.length > 0 ? (
        <View style={styles.options}>
          {answer.options.map(each => (
            <Press
              key={each}
              onPress={() => onAsk(each)}
              accessibilityRole="button"
              accessibilityLabel={`Ask: ${each}`}
              wrap={styles.optionPlace}
              style={styles.option}
              testID="ask-clarify-option"
            >
              {/* Its own size, however long the words beside it wrap. */}
              <View style={styles.optionIcon}>
                <Sparkle size={iconSize.sub} />
              </View>
              <Text style={styles.optionText} numberOfLines={2}>
                {each}
              </Text>
            </Press>
          ))}
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  clarify: { gap: space.md },
  question: { color: theme.colors.textPrimary, ...textStyle('body') },
  options: { gap: space.tight },
  optionPlace: { alignSelf: 'flex-start', maxWidth: '100%' },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: 7,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    backgroundColor: theme.colors.surface2,
  },
  optionIcon: { flexShrink: 0 },
  optionText: { flexShrink: 1, color: theme.colors.textPrimary, fontSize: type.sub },
}))
