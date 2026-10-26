import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { formatLongDuration, plural, type Song } from '@selfmp3/shared'
import { iconSize, radius, space, type } from '@selfmp3/client'
import { useArt } from '../../offline/useArt'
import { glassBlur, glassFill } from '../../ports/glassBlur'
import { Button } from '../../ui/components/Button'
import { Cover } from '../../ui/components/Cover'
import { IconButton } from '../../ui/components/IconButton'
import { Press } from '../../ui/components/Press'
import { ListMusic, Play, QueueAdd, X } from '../../ui/components/Icons'
import { ScrollView } from '../../ui/components/Scroll'
import { floating, lineSub, smallTitle } from '../../ui/surfaces'

/** How far a drag on the tray's head has to go to open or fold it. */
const PULL = 24

/**
 * What the map has taken (D1, docs/features/sound-map.md): every line and
 * loop drawn since it was last cleared, gathered at the foot of the map.
 *
 * Folded, one line: the first covers, its name, how many and how long, Save
 * and Play. Pulled up (or pressed), the songs in the order they will play,
 * each with a × to leave it out, and Up next beside Save and Play. Nothing
 * here is a playlist until Save makes one.
 */
export function MapTray({
  name,
  songs,
  open,
  saving,
  onOpen,
  onRemove,
  onClear,
  onPlay,
  onSave,
  onUpNext,
}: {
  name: string
  songs: readonly Song[]
  open: boolean
  saving: boolean
  onOpen: (open: boolean) => void
  onRemove: (id: number) => void
  onClear: () => void
  onPlay: () => void
  onSave: () => void
  onUpNext: () => void
}): ReactNode {
  const { theme } = useUnistyles()
  const art = useArt()
  const seconds = songs.reduce((sum, song) => sum + song.duration, 0)
  const count =
    songs.length === 0
      ? 'No songs there'
      : `${plural(songs.length, 'song', 'songs')}, ${formatLongDuration(seconds)}`
  const pull = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        .activeOffsetY([-8, 8])
        .onEnd(event => {
          if (event.translationY < -PULL) onOpen(true)
          else if (event.translationY > PULL) onOpen(false)
        }),
    [onOpen],
  )

  return (
    <View style={[styles.tray, glassBlur]} testID="sound-map-tray">
      <GestureDetector gesture={pull}>
        <View style={styles.head}>
          <View style={styles.grab} />
          <View style={styles.row}>
            <Press
              feedback="dim"
              onPress={() => onOpen(!open)}
              accessibilityRole="button"
              accessibilityLabel={open ? `Fold ${name}` : `Show the songs in ${name}`}
              accessibilityState={{ expanded: open }}
              style={styles.open}
              wrap={styles.grow}
              testID="sound-map-tray-head"
            >
              {open ? null : (
                <View style={styles.stack}>
                  {songs.slice(0, 3).map((song, index) => (
                    <View key={song.id} style={[styles.stacked, index > 0 && styles.overlap]}>
                      <Cover uri={art(song)} title={song.title} size={STACK} radius={6} />
                    </View>
                  ))}
                </View>
              )}
              <View style={styles.words}>
                <Text style={styles.name} numberOfLines={1} testID="sound-map-tray-name">
                  {name}
                </Text>
                <Text style={styles.count} numberOfLines={1}>
                  {count}
                </Text>
              </View>
            </Press>
            {open ? (
              <IconButton label="Clear" onPress={onClear} testID="sound-map-clear">
                <X size={iconSize.item} tone="textSecondary" />
              </IconButton>
            ) : (
              <>
                <IconButton
                  label={saving ? 'Saving…' : 'Save as playlist'}
                  filled
                  disabled={saving || songs.length === 0}
                  onPress={onSave}
                  testID="sound-map-save"
                >
                  <ListMusic size={iconSize.item} tone="textPrimary" />
                </IconButton>
                <IconButton
                  label="Play"
                  filled="primary"
                  disabled={songs.length === 0}
                  onPress={onPlay}
                  testID="sound-map-play"
                >
                  <Play size={iconSize.item} color={theme.colors.onPrimary} />
                </IconButton>
              </>
            )}
          </View>
        </View>
      </GestureDetector>

      {open ? (
        <>
          <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
            {songs.map(song => (
              <View key={song.id} style={styles.song}>
                <Cover uri={art(song)} title={song.title} size={ROW_COVER} radius={6} />
                <View style={styles.words}>
                  <Text style={styles.songTitle} numberOfLines={1}>
                    {song.title}
                  </Text>
                  <Text style={styles.count} numberOfLines={1}>
                    {song.artist}
                  </Text>
                </View>
                <IconButton label={`Leave out ${song.title}`} onPress={() => onRemove(song.id)}>
                  <X size={iconSize.small} tone="textMuted" />
                </IconButton>
              </View>
            ))}
          </ScrollView>
          <View style={styles.actions}>
            <Button
              label="Up next"
              variant="secondary"
              icon={<QueueAdd size={iconSize.item} tone="textPrimary" />}
              disabled={songs.length === 0}
              onPress={onUpNext}
              testID="sound-map-up-next"
            />
            <View style={styles.grow}>
              <Button
                label={saving ? 'Saving…' : 'Save as playlist'}
                variant="secondary"
                icon={<ListMusic size={iconSize.item} tone="textPrimary" />}
                disabled={saving || songs.length === 0}
                onPress={onSave}
                testID="sound-map-save"
              />
            </View>
            <Button
              label="Play"
              variant="primary"
              icon={<Play size={iconSize.item} color={theme.colors.onPrimary} />}
              disabled={songs.length === 0}
              onPress={onPlay}
              testID="sound-map-play"
            />
          </View>
        </>
      ) : null}
    </View>
  )
}

const STACK = 32
const ROW_COVER = 36

const styles = StyleSheet.create(theme => ({
  tray: {
    backgroundColor: glassFill(theme.colors),
    borderRadius: radius.sheet,
    paddingHorizontal: space.md,
    paddingBottom: space.sm,
    overflow: 'hidden',
    ...floating(theme.colors),
  },
  head: { paddingTop: space.xs },
  grab: {
    alignSelf: 'center',
    width: 32,
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.colors.borderStrong,
    marginBottom: space.xs,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 44 },
  open: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 44,
  },
  stack: { flexDirection: 'row' },
  stacked: { borderRadius: 7, borderWidth: 2, borderColor: theme.colors.glassSolid },
  overlap: { marginLeft: -14 },
  words: { flex: 1, minWidth: 0 },
  name: smallTitle(theme.colors),
  count: lineSub(theme.colors),
  songTitle: { ...smallTitle(theme.colors), fontSize: type.sub },
  list: { maxHeight: 320, marginTop: space.sm },
  listContent: { gap: space.sm, paddingBottom: space.sm },
  song: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingTop: space.sm,
  },
  grow: { flex: 1, minWidth: 0 },
}))
