import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import {
  formatDuration,
  formatSemitones,
  rateToSemitones,
  transposeCamelot,
  transposeKey,
} from '@selfmp3/shared'
import { countInMs, PRACTICE_SPEEDS, radius } from '@selfmp3/client'
import { usePlayer } from '../../player/PlayerProvider'
import { useAccent } from '../../ui/accent'
import { Button } from '../../ui/components/Button'
import { IconButton } from '../../ui/components/IconButton'
import { ChevronDown, ChevronRight, Metronome, X } from '../../ui/components/Icons'
import { Toggle } from '../../ui/components/Toggle'

export type PracticeGroup = 'loop' | 'speed' | 'key'
type Group = PracticeGroup

/** Which groups start open. The loop is the reason people open this panel. */
const INITIAL_OPEN: Record<Group, boolean> = { loop: true, speed: true, key: false }

/**
 * The practice panel: loop, speed and key, in one place.
 *
 * Learning a part means playing four bars over and over, slowly, without the
 * pitch drifting. Each group collapses, so it still fits a phone. The desktop
 * shows it beside the page; a phone shows it as a sheet from Now Playing.
 *
 * Where the engine cannot place a loop closely (a phone's), the loop and the
 * pitch-lock switch are not offered, and the panel says why.
 */
export function PracticePanel({
  onClose,
  side = false,
  section = null,
}: {
  onClose: () => void
  side?: boolean
  /**
   * A group to open and scroll to: the player bar's "1.25×" opens the panel at
   * Speed. Asked again for a different one, the panel opens that one too.
   */
  section?: Group | null
}): ReactNode {
  const { theme } = useUnistyles()
  const player = usePlayer()
  const song = player.current
  const [open, setOpen] = useState(() =>
    section ? { ...INITIAL_OPEN, [section]: true } : INITIAL_OPEN,
  )
  // Adjusted during render, not in an effect, so the group is never drawn shut for a frame.
  const [openedFor, setOpenedFor] = useState(section)
  if (section !== openedFor) {
    setOpenedFor(section)
    if (section) setOpen(current => ({ ...current, [section]: true }))
  }
  /*
   * Scrolled to once its group has a place: the group's top is only known after
   * it lays out, which on first opening is after this effect has run. So both
   * sides try — the effect with a top already measured, the layout with a
   * scroll still owed.
   */
  const scrollRef = useRef<ScrollView>(null)
  const tops = useRef(new Map<Group, number>())
  const owed = useRef<Group | null>(null)
  useEffect(() => {
    if (!section) return
    const top = tops.current.get(section)
    if (top === undefined) owed.current = section
    else scrollRef.current?.scrollTo({ y: Math.max(0, top - 4), animated: true })
  }, [section])
  const onGroupLayout = (group: Group, top: number): void => {
    tops.current.set(group, top)
    if (owed.current !== group) return
    owed.current = null
    scrollRef.current?.scrollTo({ y: Math.max(0, top - 4), animated: false })
  }
  // Transposing is a thought about one song: carrying +3 into the next would
  // quietly misstate its key. Kept with the song it was set for.
  const [transpose, setTranspose] = useState<{ songId: number | null; semitones: number }>({
    songId: null,
    semitones: 0,
  })
  const semitones = transpose.songId === (song?.id ?? null) ? transpose.semitones : 0
  const shift = (delta: number): void =>
    setTranspose({
      songId: song?.id ?? null,
      semitones: Math.max(-12, Math.min(12, semitones + delta)),
    })

  const toggle = (group: Group): void =>
    setOpen(current => ({ ...current, [group]: !current[group] }))

  const bpm = song?.audioFeatures?.bpm ?? null
  const key = song?.audioFeatures?.key ?? null
  const loopReady = player.loopA !== null && player.loopB !== null
  const loopLength = loopReady ? Math.abs((player.loopB ?? 0) - (player.loopA ?? 0)) : 0
  // Without pitch lock the speed drags the pitch, which is what a transposing
  // musician is trying to keep track of.
  const rateShift = player.preservesPitch ? 0 : rateToSemitones(player.rate)
  const shownShift = semitones + Math.round(rateShift)

  const sub = song
    ? `${song.title}${bpm !== null ? ` · ${Math.round(bpm)} BPM` : ''}${key !== null ? ` · ${key}` : ''}`
    : 'Nothing playing'

  return (
    <View style={side ? styles.side : styles.panel} testID="practice-panel">
      <View style={styles.head}>
        <View style={styles.titles}>
          <Text style={styles.title} accessibilityRole="header">
            Practice
          </Text>
          <Text style={styles.sub} numberOfLines={1}>
            {sub}
          </Text>
        </View>
        <IconButton onPress={onClose} label="Close practice">
          <X size={17} color={theme.colors.textSecondary} />
        </IconButton>
      </View>

      {!song ? (
        <View style={styles.empty}>
          <View style={styles.emptyIcon}>
            <Metronome size={20} color={theme.colors.textMuted} />
          </View>
          <Text style={styles.emptyTitle}>Start a song</Text>
          <Text style={styles.emptyText}>
            Then you can loop a phrase, slow it down without the pitch drifting, or read its key
            transposed.
          </Text>
        </View>
      ) : (
        <ScrollView ref={scrollRef} style={styles.body} contentContainerStyle={styles.bodyContent}>
          {player.canLoop ? (
            <GroupSection
              onTop={top => onGroupLayout('loop', top)}
              title="A–B loop"
              state={
                loopReady
                  ? `${formatDuration(player.loopA ?? 0)} – ${formatDuration(player.loopB ?? 0)}`
                  : player.loopA !== null
                    ? 'set B'
                    : 'off'
              }
              open={open.loop}
              onToggle={() => toggle('loop')}
            >
              <View style={styles.ab}>
                <LoopButton
                  letter="A"
                  time={player.loopA}
                  onPress={() => player.tapLoopPoint('A')}
                />
                <LoopButton
                  letter="B"
                  time={player.loopB}
                  onPress={() => player.tapLoopPoint('B')}
                />
                <Button
                  label="Clear"
                  onPress={player.clearLoop}
                  disabled={player.loopA === null && player.loopB === null}
                />
              </View>
              <Text style={styles.hint}>
                {loopReady
                  ? `Looping ${loopLength.toFixed(1)}s${player.countingIn ? ' · counting in…' : ''}`
                  : 'Tap A where the phrase starts, B where it ends. Play on either side of the region and it keeps playing until B.'}
              </Text>
              <View style={styles.check}>
                <Toggle value={player.countIn} onChange={player.setCountIn} label="Count in" />
                <Text style={styles.checkLabel}>
                  Count in
                  <Text style={styles.hint}>
                    {' '}
                    ({countInMs(bpm)} ms{bpm === null ? '' : ', one beat'})
                  </Text>
                </Text>
              </View>
            </GroupSection>
          ) : null}

          <GroupSection
            onTop={top => onGroupLayout('speed', top)}
            title="Speed"
            state={`${player.rate}×`}
            open={open.speed}
            onToggle={() => toggle('speed')}
          >
            <SpeedChoice value={player.rate} onChange={player.setRate} />
            {player.canLoop ? (
              <>
                <View style={styles.check}>
                  <Toggle
                    value={player.preservesPitch}
                    onChange={player.setPreservesPitch}
                    label="Pitch lock"
                  />
                  <Text style={styles.checkLabel}>
                    Pitch lock<Text style={styles.hint}> (keep the key when slowing down)</Text>
                  </Text>
                </View>
                {!player.preservesPitch && player.rate !== 1 ? (
                  <Text style={styles.hint}>
                    Pitch follows the speed: {formatSemitones(rateToSemitones(player.rate))}{' '}
                    semitones.
                  </Text>
                ) : null}
              </>
            ) : (
              <Text style={styles.hint}>
                On a phone the A–B loop and the pitch-lock switch wait for the desktop app; speed
                changes here keep the key where the phone can.
              </Text>
            )}
          </GroupSection>

          <GroupSection
            onTop={top => onGroupLayout('key', top)}
            title="Transpose"
            state={formatSemitones(semitones)}
            open={open.key}
            onToggle={() => toggle('key')}
          >
            {key === null ? (
              <Text style={styles.hint}>
                No key for this song yet — run the audio analyser in Settings and it appears here.
              </Text>
            ) : (
              <>
                <View style={styles.transpose}>
                  <Button
                    label="−"
                    onPress={() => shift(-1)}
                    accessibilityLabel="Down a semitone"
                  />
                  <View style={styles.keyBox}>
                    <Text style={styles.keyName}>{transposeKey(key, shownShift) ?? key}</Text>
                    <Text style={styles.keySub}>
                      {transposeCamelot(key, shownShift) ?? '—'} · from {key}
                    </Text>
                  </View>
                  <Button label="+" onPress={() => shift(1)} accessibilityLabel="Up a semitone" />
                </View>
                <Text style={styles.hint}>
                  Display only — the audio is not pitch-shifted. Use it to read the key you are
                  actually playing in with a capo, or transposed for another instrument.
                </Text>
              </>
            )}
          </GroupSection>
        </ScrollView>
      )}
    </View>
  )
}

/**
 * Every speed there is, as one row that fills the panel's width.
 *
 * Not the shared `Segmented`: seven of its segments sized to their labels run
 * past a 340-point panel and a phone's sheet. These share the row equally and
 * leave the "×" to the group's header, which already reads "1.25×".
 */
function SpeedChoice({
  value,
  onChange,
}: {
  value: number
  onChange: (rate: number) => void
}): ReactNode {
  return (
    <View style={styles.speeds} role="group" accessibilityLabel="Playback speed">
      {PRACTICE_SPEEDS.map(speed => {
        const active = speed === value
        return (
          <Pressable
            key={speed}
            onPress={() => onChange(speed)}
            accessibilityRole="button"
            accessibilityLabel={`${speed}×`}
            accessibilityState={{ selected: active }}
            aria-pressed={active}
            style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
              styles.speed,
              (pressed || hovered) && !active && styles.speedHovered,
              active && styles.speedActive,
            ]}
          >
            <Text style={[styles.speedLabel, active && styles.speedLabelActive]} numberOfLines={1}>
              {speed}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

/** A group whose header says what state it is in, and opens or closes it. */
function GroupSection({
  title,
  state,
  open,
  onToggle,
  onTop,
  children,
}: {
  title: string
  state: string
  open: boolean
  onToggle: () => void
  /** Where the group starts inside the panel's scroll, once it is laid out. */
  onTop: (top: number) => void
  children: ReactNode
}): ReactNode {
  const { theme } = useUnistyles()
  const [hovered, setHovered] = useState(false)
  return (
    <View style={styles.group} onLayout={event => onTop(event.nativeEvent.layout.y)}>
      <Pressable
        onPress={onToggle}
        onHoverIn={() => setHovered(true)}
        onHoverOut={() => setHovered(false)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${title}, ${state}`}
        style={[styles.groupHead, hovered && styles.groupHeadHovered]}
      >
        {open ? (
          <ChevronDown size={14} color={theme.colors.textMuted} />
        ) : (
          <ChevronRight size={14} color={theme.colors.textMuted} />
        )}
        <Text style={styles.groupTitle}>{title}</Text>
        <Text style={styles.groupState}>{state}</Text>
      </Pressable>
      {open ? <View style={styles.groupBody}>{children}</View> : null}
    </View>
  )
}

/** A or B: tapped in time with the music, so bigger than a touch target needs. */
function LoopButton({
  letter,
  time,
  onPress,
}: {
  letter: 'A' | 'B'
  time: number | null
  onPress: () => void
}): ReactNode {
  const accent = useAccent()
  const set = time !== null
  const when = set ? formatDuration(time) : 'tap to set'
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${letter} ${when}`}
      style={({ pressed }) => [
        styles.abButton,
        set && { borderColor: accent.accent },
        pressed && styles.abPressed,
      ]}
    >
      <Text style={[styles.abLetter, set && { color: accent.accent }]}>{letter}</Text>
      <Text style={styles.abTime}>{when}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create(theme => ({
  panel: { flex: 1, minHeight: 0 },
  side: {
    width: 340,
    flexShrink: 0,
    minHeight: 0,
    backgroundColor: theme.colors.surface1,
    borderLeftWidth: 1,
    borderLeftColor: theme.colors.border,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    minHeight: 58,
    paddingVertical: 10,
    paddingLeft: 16,
    paddingRight: 10,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  titles: { flex: 1, minWidth: 0 },
  title: { color: theme.colors.textPrimary, fontSize: 14, fontWeight: '600' },
  sub: { color: theme.colors.textMuted, fontSize: 12 },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 44,
    paddingHorizontal: 24,
  },
  emptyIcon: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surface2,
    marginBottom: 2,
  },
  emptyTitle: { color: theme.colors.textSecondary, fontSize: 14, fontWeight: '600' },
  emptyText: { color: theme.colors.textMuted, fontSize: 13, lineHeight: 21, textAlign: 'center' },
  body: { flex: 1 },
  bodyContent: { paddingTop: 4, paddingBottom: 20 },
  group: { borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  groupHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 44,
    paddingVertical: 11,
    paddingLeft: 10,
    paddingRight: 16,
  },
  groupHeadHovered: { backgroundColor: theme.colors.surface2 },
  groupTitle: { color: theme.colors.textPrimary, fontSize: 13, fontWeight: '600' },
  groupState: {
    marginLeft: 'auto',
    color: theme.colors.textMuted,
    fontSize: 12,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
  },
  groupBody: { gap: 12, paddingHorizontal: 16, paddingBottom: 16 },
  speeds: {
    flexDirection: 'row',
    gap: 2,
    padding: 2,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: radius.sm,
  },
  speed: { flex: 1, minWidth: 0, alignItems: 'center', paddingVertical: 6, borderRadius: 5 },
  speedHovered: { backgroundColor: theme.colors.surface3 },
  speedActive: { backgroundColor: theme.colors.surface3 },
  speedLabel: {
    color: theme.colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  speedLabelActive: { color: theme.colors.textPrimary },
  ab: { flexDirection: 'row', gap: 8 },
  abButton: {
    flex: 1,
    minHeight: 52,
    justifyContent: 'center',
    gap: 1,
    paddingHorizontal: 12,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: radius.sm,
  },
  abPressed: { backgroundColor: theme.colors.surface3 },
  abLetter: { color: theme.colors.textPrimary, fontSize: 15, fontWeight: '700' },
  abTime: { color: theme.colors.textMuted, fontSize: 11, fontVariant: ['tabular-nums'] },
  hint: { color: theme.colors.textMuted, fontSize: 12, lineHeight: 17 },
  check: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, minHeight: 32 },
  checkLabel: { flex: 1, color: theme.colors.textPrimary, fontSize: 13, lineHeight: 18 },
  transpose: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  keyBox: { flex: 1, alignItems: 'center' },
  keyName: { color: theme.colors.textPrimary, fontSize: 20, fontWeight: '700' },
  keySub: { color: theme.colors.textMuted, fontSize: 12 },
}))
