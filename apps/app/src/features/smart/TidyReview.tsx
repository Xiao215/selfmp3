import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { plural, type TidyField, type TidyResult } from '@selfmp3/shared'
import { radius, space, useBulkEditSongs, useLibrary } from '@selfmp3/client'
import { Button } from '../../ui/components/Button'
import { Checkbox } from '../../ui/components/Checkbox'
import { Sparkle } from '../../ui/components/Icons'
import { showToast } from '../../ui/toast'
import { tickedAtFirst, tidyEdits, tidyHere, tidySections } from './smart.model'
import { useSmartServer } from './useSmartServer'

const FIELD: Record<TidyField, string> = {
  title: 'Title',
  artist: 'Artist',
  album: 'Album',
  albumArtist: 'Album artist',
}

/**
 * A4 · Tidy up's changes (docs/features/ai.md), for a yes or no each: what a
 * field is, struck through, and what it would be. Under their reason, with a
 * tick for the whole reason; the model's reasons carry the sparkle and start
 * unticked. Apply is one ordinary edit per song, so it syncs and undoes like
 * an edit made by hand.
 *
 * Drawn by the Search box's Ask and by Library's Tidy up sheet.
 */
export function TidyReview({
  result,
  height,
  onClose,
}: {
  result: TidyResult
  /** How tall the list may grow before it scrolls. */
  height: number
  onClose?: () => void
}): ReactNode {
  const server = useSmartServer()
  const { data: library } = useLibrary()
  const save = useBulkEditSongs()
  const songsById = useMemo(
    () => new Map((library?.songs ?? []).map(song => [song.id, song])),
    [library],
  )
  const here = useMemo(
    () => tidyHere(result.changes, server.onDevice, songsById),
    [result.changes, server.onDevice, songsById],
  )
  const [ticked, setTicked] = useState<ReadonlySet<string> | null>(null)
  const chosen = ticked ?? tickedAtFirst(here)
  const sections = tidySections(here)
  const approved = here.filter(each => chosen.has(each.change.key))
  const edits = tidyEdits(approved)

  const flip = (keys: readonly string[], on: boolean): void => {
    const next = new Set(chosen)
    for (const key of keys) {
      if (on) next.add(key)
      else next.delete(key)
    }
    setTicked(next)
  }

  const apply = async (): Promise<void> => {
    try {
      await save.mutateAsync({ edits })
      showToast(`Fixed ${plural(edits.length, 'song', 'songs')}`, 'good')
      setTicked(new Set())
      onClose?.()
    } catch {
      // The mutation says what failed itself.
    }
  }

  if (here.length === 0) {
    return (
      <View style={styles.body}>
        <Text style={styles.line} testID="tidy-nothing">
          Nothing looks wrong in the names of your {plural(result.looked, 'song', 'songs')}.
        </Text>
        {result.note ? <Text style={styles.note}>{result.note}</Text> : null}
      </View>
    )
  }

  return (
    <View style={styles.body} testID="tidy-review">
      <Text style={styles.head}>
        {plural(here.length, 'change', 'changes')} for your {plural(result.looked, 'song', 'songs')}
      </Text>
      {result.note ? <Text style={styles.note}>{result.note}</Text> : null}
      <ScrollView style={{ maxHeight: height }} testID="tidy-list">
        {sections.map(section => {
          const keys = section.changes.map(each => each.change.key)
          const on = keys.filter(key => chosen.has(key)).length
          return (
            <View key={section.why} style={styles.section}>
              <Pressable
                onPress={() => flip(keys, on < keys.length)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on === keys.length ? true : on ? 'mixed' : false }}
                accessibilityLabel={`${section.why}, ${plural(keys.length, 'change', 'changes')}`}
                style={({ pressed }) => [styles.sectionHead, pressed && styles.pressed]}
                testID="tidy-section"
              >
                <Checkbox checked={on === keys.length} mixed={on > 0 && on < keys.length} />
                {section.byModel ? <Sparkle size={12} /> : null}
                <Text style={styles.sectionTitle} numberOfLines={1}>
                  {section.why}
                </Text>
                <Text style={styles.count}>{keys.length}</Text>
              </Pressable>
              {section.changes.map(({ change, songIds }) => {
                const isOn = chosen.has(change.key)
                const one = songIds.length === 1 ? songsById.get(songIds[0]!) : undefined
                return (
                  <Pressable
                    key={change.key}
                    onPress={() => flip([change.key], !isOn)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: isOn }}
                    accessibilityLabel={`${FIELD[change.field]}: ${change.from} to ${change.to}`}
                    style={({ pressed }) => [styles.change, pressed && styles.pressed]}
                    testID="tidy-change"
                  >
                    <Checkbox checked={isOn} />
                    <View style={styles.diff}>
                      <Text style={styles.from} numberOfLines={2}>
                        {change.from}
                      </Text>
                      <Text style={styles.to} numberOfLines={2}>
                        {change.to}
                      </Text>
                      <Text style={styles.meta} numberOfLines={1}>
                        {FIELD[change.field]} ·{' '}
                        {one && change.field === 'title'
                          ? one.artist || 'Unknown artist'
                          : plural(songIds.length, 'song', 'songs')}
                      </Text>
                    </View>
                  </Pressable>
                )
              })}
            </View>
          )
        })}
      </ScrollView>
      <View style={styles.actions}>
        {onClose ? <Button label="Close" onPress={onClose} /> : null}
        <Button
          label={
            edits.length === 0
              ? 'Apply'
              : `Apply ${plural(approved.length, 'change', 'changes')} · ${plural(edits.length, 'song', 'songs')}`
          }
          variant="primary"
          disabled={edits.length === 0}
          busy={save.isPending}
          onPress={() => void apply()}
          testID="tidy-apply"
        />
      </View>
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  body: { gap: space.sm },
  head: { color: theme.colors.textPrimary, fontSize: 15.5, fontWeight: '600' },
  line: { color: theme.colors.textSecondary, fontSize: 13.5, lineHeight: 19 },
  note: { color: theme.colors.textMuted, fontSize: 12.5, lineHeight: 18 },
  section: { marginBottom: space.sm },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
    paddingHorizontal: space.xs,
    borderRadius: radius.coverSm,
  },
  sectionTitle: { flex: 1, color: theme.colors.textPrimary, fontSize: 13, fontWeight: '600' },
  count: { color: theme.colors.textMuted, fontSize: 12, fontVariant: ['tabular-nums'] },
  change: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 6,
    paddingLeft: space.lg,
    paddingRight: space.xs,
    borderRadius: radius.coverSm,
  },
  diff: { flex: 1, minWidth: 0, gap: 1 },
  from: {
    color: theme.colors.danger,
    fontSize: 13,
    textDecorationLine: 'line-through',
    opacity: 0.8,
  },
  to: { color: theme.colors.good, fontSize: 13, fontWeight: '500' },
  meta: { color: theme.colors.textMuted, fontSize: 11.5 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: space.sm, marginTop: space.xs },
  pressed: { opacity: 0.7 },
}))
