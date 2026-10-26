import { useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { ARTIST_NAMES_MAX, namesFor, tidyArtistNames, type Artist } from '@selfmp3/shared'
import { failureText, space, type, useLibrary, useSetArtistNames } from '@selfmp3/client'
import { Button } from '../../ui/components/Button'
import { TextField } from '../../ui/components/TextField'
import { Popover } from '../../ui/components/Popover'
import { StatusLine } from '../../ui/components/StatusLine'
import { label } from '../../ui/surfaces'

/**
 * The names an artist also goes by, from the ⋯ on their page: search finds
 * them by these too — 周杰伦 as "Jay Chou", 幾田りら as "ikura". The server
 * fills them in from MusicBrainz where it can; what is typed here replaces
 * that, on every device. One field, the names apart by commas.
 *
 * A popover beside the ⋯ at desktop width and a sheet on a phone, as the tag
 * editor is.
 */
export function ArtistNamesEditor({
  artist,
  anchorRef,
  onClose,
}: {
  /** The artist being named, or null when closed. */
  artist: Artist | null
  anchorRef: RefObject<View | null>
  onClose: () => void
}): ReactNode {
  return (
    <Popover
      open={artist !== null}
      onClose={onClose}
      anchorRef={anchorRef}
      width={320}
      testID="artist-names-editor"
    >
      {artist ? <Editor key={artist.key} artist={artist} onSaved={onClose} /> : null}
    </Popover>
  )
}

/** "Jay Chou, 周杰倫、Zhou Jielun" → each name: commas of either width, and "、". */
function namesTyped(text: string): string[] {
  return text.split(/[,，、]/)
}

/**
 * Saved, it closes: left open with a tick on Save, it read as not saved
 * (X8, 2026-10-25). A refusal keeps it open and says why.
 */
function Editor({ artist, onSaved }: { artist: Artist; onSaved: () => void }): ReactNode {
  const { data: library } = useLibrary()
  const saved = library ? namesFor(library.artistNames, artist.key) : []
  const [text, setText] = useState(saved.join(', '))
  const save = useSetArtistNames()

  const names = tidyArtistNames(artist.name, namesTyped(text))
  const changed = names.join('\n') !== saved.join('\n')
  const submit = (): void => {
    if (!changed) return
    save.mutate({ artist: artist.name, names }, { onSuccess: onSaved })
  }

  return (
    <View>
      <View style={styles.title}>
        <Text style={styles.titleText} numberOfLines={1}>
          Artist <Text style={styles.titleName}>{artist.name}</Text>
        </Text>
      </View>
      <View style={styles.section}>
        <Text style={styles.fieldLabel}>Other names</Text>
        <TextField
          raised
          value={text}
          onChangeText={next => {
            setText(next)
            save.reset()
          }}
          onSubmitEditing={submit}
          autoCapitalize="none"
          placeholder="Names apart by commas"
          accessibilityLabel="Other names"
          action={
            <Button
              label="Save"
              variant="primary"
              disabled={!changed || save.isPending}
              onPress={submit}
            />
          }
        />
        {save.error ? (
          <StatusLine style={styles.error}>
            {failureText('Couldn’t save the names', save.error)}
          </StatusLine>
        ) : (
          <Text style={styles.hint}>
            Search finds {artist.name} by these too. Up to {ARTIST_NAMES_MAX}.
          </Text>
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  title: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  titleText: { color: theme.colors.textSecondary, fontSize: type.sub, flexShrink: 1 },
  titleName: { color: theme.colors.textPrimary, fontWeight: '700' },
  section: { paddingTop: space.xs, paddingHorizontal: space.xs, paddingBottom: space.sm },
  fieldLabel: { ...label(theme.colors), marginBottom: 5 },
  hint: { color: theme.colors.textMuted, fontSize: type.small, marginTop: 6 },
  error: { marginTop: 5 },
}))
