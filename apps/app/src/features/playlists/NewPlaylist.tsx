import { useEffect, useMemo, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import type { View as RNView } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useRouter } from 'expo-router'
import { useQueryClient } from '@tanstack/react-query'
import { formatDuration, type Song, type Tag } from '@selfmp3/shared'
import { clientApi, queryKeys, radius, space, useLibrary } from '@selfmp3/client'
import { useLayout } from '../../shell/useLayout'
import { useArt } from '../../offline/useArt'
import { useAccent } from '../../ui/accent'
import { Button } from '../../ui/components/Button'
import { Checkbox } from '../../ui/components/Checkbox'
import { Cover } from '../../ui/components/Cover'
import { ChevronLeft, ChevronRight, ListMusic, Live, Sparkles } from '../../ui/components/Icons'
import { Popover } from '../../ui/components/Popover'
import { Sheet, SheetItem } from '../../ui/components/Sheet'
import { LIVE_NAME, madeFrom, newPlaylist } from './playlists.model'
import {
  LIVE_TEMPLATES,
  TEMPLATES,
  templateRules,
  templateTitle,
  type TemplateId,
} from './templates.model'

/**
 * Making a playlist, from wherever it is started: the sidebar's ＋, the
 * playlists page's New, the phone's ＋.
 *
 * One menu, three kinds. Choosing closes the menu and opens that kind's own
 * window: a name for a playlist; templates and the songs they pick for a
 * smart playlist; a name and a starting point for a live one, which then
 * opens with its rules showing so they can be tuned.
 */

/** Which window is open. A smart playlist is stored as a manual one: it is how it was made. */
type Flow = 'manual' | 'template' | 'live'

export function NewPlaylist({
  open,
  onClose,
  anchorRef,
}: {
  /** The menu of kinds is showing. */
  open: boolean
  onClose: () => void
  anchorRef: RefObject<RNView | null>
}): ReactNode {
  const { theme } = useUnistyles()
  const [flow, setFlow] = useState<Flow | null>(null)
  const icon = (Glyph: typeof ListMusic): ReactNode => (
    <Glyph size={16} color={theme.colors.textSecondary} />
  )
  const choose = (kind: Flow) => (): void => {
    onClose()
    setFlow(kind)
  }

  return (
    <>
      <Popover
        open={open}
        onClose={onClose}
        anchorRef={anchorRef}
        title="New"
        width={250}
        testID="new-playlist-menu"
      >
        <SheetItem
          icon={icon(ListMusic)}
          label="Playlist"
          detail="You pick"
          onPress={choose('manual')}
        />
        <SheetItem
          icon={icon(Sparkles)}
          label="Smart playlist"
          detail="Picks for you"
          onPress={choose('template')}
        />
        <SheetItem
          icon={icon(Live)}
          label={`${LIVE_NAME} playlist`}
          detail="Updates itself"
          onPress={choose('live')}
        />
      </Popover>

      <NameDialog open={flow === 'manual'} onClose={() => setFlow(null)} />
      <SmartDialog open={flow === 'template'} onClose={() => setFlow(null)} />
      <LiveDialog open={flow === 'live'} onClose={() => setFlow(null)} />
    </>
  )
}

/** Tell the library a playlist was made, and go to it. */
function useFinish(): (id: number, openRules?: boolean) => void {
  const router = useRouter()
  const client = useQueryClient()
  return (id, openRules = false) => {
    void client.invalidateQueries({ queryKey: queryKeys.library })
    router.push({
      pathname: '/playlists/[id]',
      params: openRules ? { id: String(id), rules: '1' } : { id: String(id) },
    })
  }
}

function NameField({
  value,
  onChange,
  onSubmit,
  label,
  autoFocus = false,
}: {
  value: string
  onChange: (value: string) => void
  onSubmit?: () => void
  label: string
  autoFocus?: boolean
}): ReactNode {
  const { theme } = useUnistyles()
  const accent = useAccent()
  const [focused, setFocused] = useState(false)
  return (
    <TextInput
      style={[styles.input, focused && { borderColor: accent.accent }]}
      value={value}
      onChangeText={onChange}
      onSubmitEditing={onSubmit}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      placeholder="Name"
      placeholderTextColor={theme.colors.textMuted}
      accessibilityLabel={label}
      autoFocus={autoFocus}
      autoCorrect={false}
      returnKeyType="done"
    />
  )
}

// --- a playlist ---------------------------------------------------------------

function NameDialog({ open, onClose }: { open: boolean; onClose: () => void }): ReactNode {
  const finish = useFinish()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const create = async (): Promise<void> => {
    const input = newPlaylist('manual', name)
    if (!input || busy) return
    setBusy(true)
    setError(null)
    try {
      const created = await clientApi().createPlaylist(input)
      setName('')
      onClose()
      finish(created.id)
    } catch (caught) {
      // The name stays in the box, so trying again is one tap.
      setError(`Couldn’t make “${input.name}”: ${(caught as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="New playlist" testID="new-playlist">
      <View style={styles.body}>
        <NameField
          value={name}
          onChange={setName}
          onSubmit={() => void create()}
          label="Playlist name"
          autoFocus
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <View style={styles.actions}>
          <Button label="Cancel" onPress={onClose} />
          <Button
            label="Create"
            variant="primary"
            disabled={!name.trim()}
            busy={busy}
            onPress={() => void create()}
          />
        </View>
      </View>
    </Sheet>
  )
}

// --- a smart playlist ----------------------------------------------------------

/** The songs a template picks, asked of the server whenever the template changes. */
function usePicked(template: TemplateId, tag: Tag | null, open: boolean): number[] | null {
  const [picked, setPicked] = useState<{ key: string; songIds: number[] } | null>(null)
  const key = `${template}:${tag?.id ?? ''}`

  useEffect(() => {
    if (!open) return undefined
    let cancelled = false
    const rules = templateRules(template, tag)
    const asked =
      template === 'gems'
        ? clientApi()
            .gems(30)
            .then(result => result.songs.map(song => song.id))
        : rules
          ? clientApi()
              .previewRules(rules)
              .then(result => result.songIds)
          : Promise.resolve([])
    asked
      .then(songIds => {
        if (!cancelled) setPicked({ key, songIds })
      })
      .catch(() => {
        if (!cancelled) setPicked({ key, songIds: [] })
      })
    return () => {
      cancelled = true
    }
  }, [template, tag, open, key])

  return picked?.key === key ? picked.songIds : null
}

function SmartDialog({ open, onClose }: { open: boolean; onClose: () => void }): ReactNode {
  const { theme } = useUnistyles()
  const accent = useAccent()
  const { wide } = useLayout()
  const artFor = useArt()
  const finish = useFinish()
  const { data: library } = useLibrary()
  const tags = library?.tags ?? []

  const [template, setTemplate] = useState<TemplateId>('mostPlayed')
  const [tagId, setTagId] = useState<number | null>(null)
  // On a phone the templates and the songs are two steps of one sheet.
  const [step, setStep] = useState<'templates' | 'songs'>('templates')
  const [name, setName] = useState<string | null>(null)
  const [unticked, setUnticked] = useState<ReadonlySet<number>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const tag = tags.find(item => item.id === tagId) ?? tags[0] ?? null
  const picked = usePicked(template, template === 'tag' ? tag : null, open)
  const title = templateTitle(template, template === 'tag' ? tag : null)
  // The name follows the template until it is typed over.
  const shownName = name ?? title

  const songs = useMemo(() => {
    const byId = new Map((library?.songs ?? []).map(song => [song.id, song]))
    return (picked ?? []).flatMap(id => {
      const song = byId.get(id)
      return song ? [song] : []
    })
  }, [picked, library?.songs])
  const kept = songs.filter(song => !unticked.has(song.id))

  const reset = (): void => {
    setStep('templates')
    setName(null)
    setUnticked(new Set())
    setError(null)
  }
  const close = (): void => {
    onClose()
    reset()
  }
  const pick = (id: TemplateId): void => {
    setTemplate(id)
    setUnticked(new Set())
    setStep('songs')
  }

  const create = async (): Promise<void> => {
    const input = newPlaylist('manual', shownName, { description: madeFrom(title, new Date()) })
    if (!input || busy) return
    setBusy(true)
    setError(null)
    try {
      const created = await clientApi().createPlaylist(input)
      if (kept.length > 0) {
        await clientApi().addToPlaylist(created.id, { songIds: kept.map(song => song.id) })
      }
      close()
      finish(created.id)
    } catch (caught) {
      setError(`Couldn’t make “${input.name}”: ${(caught as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  const templates = (
    <View style={styles.templates}>
      <Text style={styles.section}>START FROM</Text>
      {TEMPLATES.map(item => {
        const on = item.id === template && (wide || step === 'songs')
        const disabled = item.id === 'tag' && tags.length === 0
        return (
          <Pressable
            key={item.id}
            onPress={() => pick(item.id)}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityState={{ selected: on, disabled }}
            style={({ pressed }) => [
              styles.template,
              on && { backgroundColor: theme.colors.surface3, borderColor: accent.accent },
              pressed && styles.pressed,
              disabled && styles.disabled,
            ]}
          >
            <View style={styles.templateText}>
              <Text style={styles.templateName}>{item.name}</Text>
              <Text style={styles.templateHint} numberOfLines={1}>
                {disabled ? 'Make a tag first' : item.hint}
              </Text>
            </View>
            {wide ? null : <ChevronRight size={16} color={theme.colors.textMuted} />}
          </Pressable>
        )
      })}
      <View style={[styles.template, styles.disabled]}>
        <View style={styles.templateText}>
          <Text style={styles.templateName}>Describe it</Text>
          <Text style={styles.templateHint}>Let AI pick the songs — coming later</Text>
        </View>
      </View>
    </View>
  )

  const picker = (
    <View style={styles.picker}>
      {wide ? null : (
        <Pressable
          onPress={() => setStep('templates')}
          accessibilityRole="button"
          style={styles.back}
        >
          <ChevronLeft size={16} color={theme.colors.textSecondary} />
          <Text style={styles.backText}>Templates</Text>
        </Pressable>
      )}
      <NameField value={shownName} onChange={setName} label="Playlist name" />
      {template === 'tag' && tags.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
        >
          {tags.map(item => (
            <Pressable
              key={item.id}
              onPress={() => {
                setTagId(item.id)
                setUnticked(new Set())
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: item.id === tag?.id }}
              style={[styles.chip, item.id === tag?.id && { borderColor: accent.accent }]}
            >
              <Text style={styles.chipText}>{item.name}</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
      <View style={styles.sectionRow}>
        <Text style={styles.section}>SONGS IT PICKED</Text>
        {picked ? (
          <Text style={styles.count}>
            {kept.length} of {songs.length}
          </Text>
        ) : null}
      </View>
      <ScrollView style={styles.songs} contentContainerStyle={styles.songsContent}>
        {picked === null ? (
          <ActivityIndicator color={accent.accent} style={styles.spinner} />
        ) : songs.length === 0 ? (
          <Text style={styles.hint}>Nothing in your library fits this yet.</Text>
        ) : (
          songs.map(song => (
            <PickedRow
              key={song.id}
              song={song}
              artUri={artFor(song)}
              detail={template === 'mostPlayed' ? `${song.playCount} plays` : undefined}
              ticked={!unticked.has(song.id)}
              onToggle={() =>
                setUnticked(current => {
                  const next = new Set(current)
                  if (next.has(song.id)) next.delete(song.id)
                  else next.add(song.id)
                  return next
                })
              }
            />
          ))
        )}
      </ScrollView>
      <Text style={styles.hint}>Makes a normal playlist. It won’t change by itself.</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.actions}>
        <Button label="Cancel" onPress={close} />
        <Button
          label={`Create · ${kept.length} ${kept.length === 1 ? 'song' : 'songs'}`}
          variant="primary"
          disabled={!shownName.trim() || picked === null}
          busy={busy}
          onPress={() => void create()}
          testID="smart-create"
        />
      </View>
    </View>
  )

  return (
    <Sheet
      open={open}
      onClose={close}
      title="New smart playlist"
      width={680}
      testID="new-smart-playlist"
    >
      {wide ? (
        <View style={styles.split}>
          {templates}
          {picker}
        </View>
      ) : step === 'templates' ? (
        templates
      ) : (
        picker
      )}
    </Sheet>
  )
}

function PickedRow({
  song,
  artUri,
  detail,
  ticked,
  onToggle,
}: {
  song: Song
  artUri: string | null
  detail?: string
  ticked: boolean
  onToggle: () => void
}): ReactNode {
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: ticked }}
      accessibilityLabel={`${song.title}, ${song.artist || 'Unknown artist'}`}
      style={({ pressed }) => [
        styles.pickedRow,
        pressed && styles.pressed,
        !ticked && styles.unticked,
      ]}
    >
      <Cover uri={artUri} title={song.album || song.title} size={32} />
      <View style={styles.templateText}>
        <Text style={styles.songTitle} numberOfLines={1}>
          {song.title}
        </Text>
        <Text style={styles.templateHint} numberOfLines={1}>
          {detail ?? (song.artist || 'Unknown artist')}
        </Text>
      </View>
      <Text style={styles.time}>{formatDuration(song.duration)}</Text>
      <Checkbox checked={ticked} />
    </Pressable>
  )
}

// --- a live playlist -----------------------------------------------------------

function LiveDialog({ open, onClose }: { open: boolean; onClose: () => void }): ReactNode {
  const accent = useAccent()
  const finish = useFinish()
  const { data: library } = useLibrary()
  const tags = library?.tags ?? []
  const [start, setStart] = useState<TemplateId | 'blank'>('long')
  const [name, setName] = useState<string | null>(null)
  const [count, setCount] = useState<{ key: string; value: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const tag = tags[0] ?? null
  const rules = start === 'blank' ? null : templateRules(start, tag)
  const title = start === 'blank' ? '' : templateTitle(start, tag)
  const shownName = name ?? title
  const key = `${start}:${tag?.id ?? ''}`

  useEffect(() => {
    if (!open) return undefined
    let cancelled = false
    const asked = rules
      ? clientApi()
          .previewRules(rules)
          .then(result => result.songIds.length)
      : Promise.resolve(library?.songs.length ?? 0)
    asked
      .then(value => {
        if (!cancelled) setCount({ key, value })
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
    // `rules` is rebuilt every render; `key` says when it actually changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, key, library?.songs.length])

  const close = (): void => {
    onClose()
    setName(null)
    setError(null)
  }

  const create = async (): Promise<void> => {
    const input = newPlaylist('live', shownName, rules ? { rules } : {})
    if (!input || busy) return
    setBusy(true)
    setError(null)
    try {
      const created = await clientApi().createPlaylist(input)
      close()
      finish(created.id, true)
    } catch (caught) {
      setError(`Couldn’t make “${input.name}”: ${(caught as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  const matches = count?.key === key ? count.value : null

  return (
    <Sheet
      open={open}
      onClose={close}
      title={`New ${LIVE_NAME.toLowerCase()} playlist`}
      width={460}
      testID="new-live-playlist"
    >
      <View style={styles.body}>
        <Text style={styles.lede}>Follows rules and updates itself as your library changes.</Text>
        <NameField value={shownName} onChange={setName} label="Playlist name" autoFocus />
        <Text style={styles.section}>START FROM</Text>
        <View style={styles.wrapChips}>
          {[
            ...LIVE_TEMPLATES.filter(item => item.id !== 'tag' || tag),
            { id: 'blank' as const, name: 'Blank' },
          ].map(item => (
            <Pressable
              key={item.id}
              onPress={() => setStart(item.id)}
              accessibilityRole="button"
              accessibilityState={{ selected: item.id === start }}
              style={[styles.chip, item.id === start && { borderColor: accent.accent }]}
            >
              <Text style={styles.chipText}>
                {item.id === 'tag' && tag ? `Tag: ${tag.name}` : item.name}
              </Text>
            </Pressable>
          ))}
        </View>
        <Text style={[styles.count, styles.liveCount, { color: accent.accent }]}>
          {matches === null
            ? 'Checking…'
            : `${matches} ${matches === 1 ? 'song matches' : 'songs match'} today`}
        </Text>
        <Text style={styles.hint}>You can change the rules on the next screen.</Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <View style={styles.actions}>
          <Button label="Cancel" onPress={close} />
          <Button
            label="Create"
            variant="primary"
            disabled={!shownName.trim()}
            busy={busy}
            onPress={() => void create()}
            testID="live-create"
          />
        </View>
      </View>
    </Sheet>
  )
}

const styles = StyleSheet.create(theme => ({
  body: { gap: space.sm, padding: space.sm },
  lede: { color: theme.colors.textSecondary, fontSize: 13 },
  input: {
    minHeight: 38,
    paddingHorizontal: space.md,
    color: theme.colors.textPrimary,
    fontSize: 14,
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.borderStrong,
    borderRadius: radius.sm,
  },
  error: { color: theme.colors.danger, fontSize: 12 },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: space.sm,
    marginTop: space.xs,
  },
  split: { flexDirection: 'row', gap: space.md, padding: space.xs },
  templates: { width: '100%', maxWidth: 230, gap: 4, padding: space.xs },
  picker: { flex: 1, minWidth: 0, gap: space.sm, padding: space.xs },
  section: {
    color: theme.colors.textMuted,
    fontSize: 10.5,
    fontWeight: '600',
    letterSpacing: 0.8,
    marginTop: space.xs,
  },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  template: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  templateText: { flex: 1, minWidth: 0 },
  templateName: { color: theme.colors.textPrimary, fontSize: 13, fontWeight: '600' },
  templateHint: { color: theme.colors.textMuted, fontSize: 11.5 },
  pressed: { backgroundColor: theme.colors.surface3 },
  disabled: { opacity: 0.45 },
  back: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    alignSelf: 'flex-start',
    paddingVertical: 4,
  },
  backText: { color: theme.colors.textSecondary, fontSize: 13, fontWeight: '600' },
  chips: { gap: 6 },
  wrapChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingVertical: 5,
    paddingHorizontal: 11,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.borderStrong,
    backgroundColor: theme.colors.surface1,
  },
  chipText: { color: theme.colors.textPrimary, fontSize: 12 },
  count: { color: theme.colors.textMuted, fontSize: 12, fontVariant: ['tabular-nums'] },
  liveCount: { fontWeight: '600', fontSize: 13 },
  songs: { maxHeight: 300 },
  songsContent: { gap: 2 },
  spinner: { marginVertical: space.lg },
  pickedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 5,
    paddingHorizontal: 6,
    borderRadius: radius.sm,
  },
  unticked: { opacity: 0.5 },
  songTitle: { color: theme.colors.textPrimary, fontSize: 13, fontWeight: '500' },
  time: { color: theme.colors.textMuted, fontSize: 11.5, fontVariant: ['tabular-nums'] },
  hint: { color: theme.colors.textMuted, fontSize: 12 },
}))
