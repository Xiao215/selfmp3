import { useState } from 'react'
import type { ReactNode } from 'react'
import type { TextInputProps } from 'react-native'
import { TAG_NAME_MAX, type Tag } from '@selfmp3/shared'
import { failureText, useCreateTag } from '@selfmp3/client'
import { autoTagHue } from '../../ui/components/HueSwatches'
import { TextField } from '../../ui/components/TextField'
import { isComposing } from '../../shell/composing'
import { existingTag } from '../tag/tag.model'
import { useArtistNudge } from '../tag/useArtistNudge'

/** What a new-tag form holds and does, wherever it is drawn. */
interface NewTagForm {
  readonly name: string
  readonly setName: (name: string) => void
  /** The colour it will be: the one picked, or the one the name gives it. */
  readonly hue: number
  /** The colour it is given when none is picked, which leads the swatches. */
  readonly autoHue: number
  readonly setHue: (hue: number) => void
  readonly ready: boolean
  readonly busy: boolean
  /**
   * Why the last try made nothing, said under the form until the name
   * changes; null when it has not failed.
   */
  readonly failure: string | null
  readonly submit: () => void
  /** The artist's-name question (`P11`), drawn wherever the form is. */
  readonly nudge: ReactNode
}

/**
 * What the form says when the tag was not made, with the reason when there
 * is one to say: the server's disk full, its database busy, the library out
 * of reach. Not "try a different name": the server makes any name it is
 * given (a taken one is the tag already there), so the name was never why.
 */
const NEW_TAG_FAILED = 'Couldn’t make that tag'

/**
 * Making a tag, in the sidebar's form and on the Tags page alike: the name,
 * its colour (the name's own until one is picked), the artist's-name question
 * (`P11`) and the server's answer.
 *
 * A name that is already a tag's — compared as the server compares them,
 * case and spaces aside (`existingTag`) — makes nothing: `onExisting` gets
 * the tag, because choosing it beats making its twin. The sidebar opens its
 * page; the Tags page opens its editor.
 *
 * Once made, the name and the colour clear for the next, and `onMade` says
 * so (the sidebar closes its form; the Tags page keeps it, since tags arrive
 * in handfuls). A refusal keeps the name and says so: the sidebar's form
 * used to close at once and swallow it.
 */
export function useNewTagForm({
  tags,
  onExisting,
  onMade,
}: {
  tags: readonly Tag[]
  onExisting: (tag: Tag) => void
  onMade?: () => void
}): NewTagForm {
  const createTag = useCreateTag()
  const artistNudge = useArtistNudge()
  const [name, setNameState] = useState('')
  // A colour picked for the new tag; left alone, it is one no tag is near.
  const [picked, setPicked] = useState<number | undefined>(undefined)
  const trimmed = name.trim()
  const autoHue = autoTagHue(trimmed, tags)

  const make = async (wanted: string): Promise<void> => {
    const tag = { name: wanted, ...(picked === undefined ? {} : { hue: picked }) }
    if (!(await createTag.mutateAsync(tag).catch(() => null))) return
    setNameState('')
    setPicked(undefined)
    onMade?.()
  }

  return {
    name,
    setName: text => {
      setNameState(text)
      createTag.reset()
    },
    hue: picked ?? autoHue,
    autoHue,
    setHue: setPicked,
    ready: trimmed.length > 0,
    busy: createTag.isPending,
    failure: createTag.isError ? failureText(NEW_TAG_FAILED, createTag.error) : null,
    submit: () => {
      if (!trimmed) return
      const already = existingTag(tags, trimmed)
      if (already) {
        setNameState('')
        setPicked(undefined)
        onExisting(already)
        return
      }
      artistNudge.check(trimmed, () => void make(trimmed))
    },
    nudge: artistNudge.nudge,
  }
}

/**
 * A new tag's name: a `TextField` that stops where the server would refuse
 * (`TAG_NAME_MAX`) and makes the tag on Enter while keeping the field, as
 * tags arrive in handfuls. Escape is `onEscape`'s: in a browser a field keeps
 * its keys from the page, so the form's own `useEscape` never hears it here.
 */
export function TagNameField({
  form,
  onEscape,
  ...field
}: { form: NewTagForm } & Pick<
  TextInputProps,
  'placeholder' | 'autoFocus' | 'onBlur' | 'testID'
> & {
    action?: ReactNode
    size?: 'regular' | 'small'
    /** Escape pressed in the field: put the form away. */
    onEscape?: () => void
  }): ReactNode {
  return (
    <TextField
      {...field}
      onKeyPress={event => {
        if (event.nativeEvent.key !== 'Escape') return
        if (isComposing(event.nativeEvent as { isComposing?: boolean })) return
        onEscape?.()
      }}
      value={form.name}
      onChangeText={form.setName}
      onSubmitEditing={form.submit}
      maxLength={TAG_NAME_MAX}
      autoCapitalize="none"
      // Enter makes the tag and stays in the field: dismissing the keyboard
      // after each one costs a tap to get it back. react-native-web reads
      // only the older prop, and without it Enter left focus on nothing.
      submitBehavior="submit"
      blurOnSubmit={false}
      returnKeyType="done"
      accessibilityLabel="New tag name"
    />
  )
}
