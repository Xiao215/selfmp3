import type { ReactNode } from 'react'
import { Pressable, Text, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import type { SmartRules, Tag } from '@selfmp3/shared'
import { radius, space } from '@selfmp3/client'
import { useAccent } from '../../ui/accent'
import { Live } from '../../ui/components/Icons'
import { describeOrder, describeRule } from './rules.model'

/**
 * A live playlist's rules, read back as a sentence under its title:
 * "Songs where [Length is more than 3:30] · longest first".
 *
 * The form that edits them is one press away and not on the page, so the
 * songs the rules pick are what the page shows.
 */
export function RulesSummary({
  rules,
  tags,
  editing,
  onEdit,
}: {
  rules: SmartRules | null
  tags: readonly Pick<Tag, 'id' | 'name'>[]
  editing: boolean
  onEdit: () => void
}): ReactNode {
  const { theme } = useUnistyles()
  const accent = useAccent()
  const list = rules?.rules ?? []

  return (
    <View style={styles.box} testID="rules-summary">
      <Live size={15} color={accent.accent} />
      <Text style={styles.word}>{list.length === 0 ? 'Every song' : 'Songs where'}</Text>
      {list.map((rule, index) => (
        <View key={index} style={styles.pair}>
          {index > 0 ? (
            <Text style={styles.word}>{rules?.match === 'any' ? 'or' : 'and'}</Text>
          ) : null}
          <View style={[styles.chip, { borderColor: accent.accentPill }]}>
            <Text style={[styles.chipText, { color: theme.colors.textPrimary }]}>
              {describeRule(rule, tags)}
            </Text>
          </View>
        </View>
      ))}
      {rules ? (
        <Text style={styles.word}>
          · {describeOrder(rules)}
          {rules.limit ? ` · first ${rules.limit}` : ''}
        </Text>
      ) : null}
      {/* While they are being edited, the panel or sheet has its own Done. */}
      {editing ? null : (
        <Pressable
          onPress={onEdit}
          accessibilityRole="button"
          accessibilityLabel="Edit rules"
          style={({ pressed }) => [styles.edit, pressed && styles.pressed]}
        >
          <Text style={[styles.editText, { color: accent.accent }]}>Edit rules</Text>
        </Pressable>
      )}
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  box: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    marginBottom: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  pair: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  word: { color: theme.colors.textSecondary, fontSize: 12.5 },
  chip: {
    paddingVertical: 3,
    paddingHorizontal: 9,
    borderRadius: 999,
    borderWidth: 1,
    backgroundColor: theme.colors.surface2,
  },
  chipText: { fontSize: 12 },
  edit: {
    marginLeft: 'auto',
    paddingVertical: 4,
    paddingHorizontal: space.sm,
    borderRadius: radius.sm,
  },
  editText: { fontSize: 12.5, fontWeight: '600' },
  pressed: { backgroundColor: theme.colors.surface2 },
}))
