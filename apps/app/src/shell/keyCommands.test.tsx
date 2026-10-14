// A hardware keyboard on an iPad or an iPhone: the hooks' native halves, which
// register UIKeyCommands through the app's own module (modules/key-commands).
// The module is the one thing faked — it is the boundary with UIKit — and the
// fake keeps what the module was last told and lets a test press a key.
import { act, renderHook } from '@testing-library/react-native'
import { requireOptionalNativeModule } from 'expo'

import type { KeyCommandSpec, KeyPress } from '../ports/keyCommands'
import { useMenuCommands } from '../ports/menuKeys'
import { useListKeys } from '../selection/useListKeys'
import { useCommands } from './useCommands'
import { useEscape } from './useEscape'
import { useHotkeys } from './useHotkeys'

interface FakeModule {
  /** What `setCommands` was last given. */
  commands: readonly KeyCommandSpec[]
  attached: boolean
  press(press: Partial<KeyPress> & { input: string }): void
  /** A keyboard attached or taken away. */
  connect(attached: boolean): void
}

jest.mock('expo', () => {
  const listeners = new Map<string, Set<(value: unknown) => void>>()
  const fake = {
    commands: [] as unknown[],
    attached: false,
    setCommands(commands: unknown[]) {
      fake.commands = commands
    },
    keyboardAttached: () => fake.attached,
    addListener(event: string, listener: (value: unknown) => void) {
      const set = listeners.get(event) ?? new Set()
      listeners.set(event, set)
      set.add(listener)
      return { remove: () => set.delete(listener) }
    },
    press(press: { input: string; modifiers?: string[]; typing?: boolean }) {
      const event = { modifiers: [], typing: false, ...press }
      listeners.get('onKeyCommand')?.forEach(listener => listener(event))
    },
    connect(attached: boolean) {
      fake.attached = attached
      listeners.get('onKeyboardChange')?.forEach(listener => listener({ attached }))
    },
  }
  return {
    ...jest.requireActual('expo'),
    requireOptionalNativeModule: (name: string) => (name === 'KeyCommands' ? fake : null),
  }
})

jest.mock('expo-router', () => ({
  // The page is in front for as long as the hook is mounted.
  useFocusEffect: (effect: () => undefined | (() => void)) => {
    const { useEffect: mockUseEffect } = jest.requireActual<typeof import('react')>('react')
    mockUseEffect(effect, [effect])
  },
}))

const native = requireOptionalNativeModule('KeyCommands') as FakeModule

/** Registrations reach the module once per turn of the event loop. */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}

function registered(): string[] {
  return native.commands.map(command => [...command.modifiers, command.input].join('+'))
}

describe('key commands on an iPad', () => {
  it('registers the menu’s keys that have a handler, titled for the ⌘ overlay', async () => {
    const toggle = jest.fn()
    const next = jest.fn()
    const frame = await renderHook(() => useCommands({ 'play-pause': toggle, next }))
    const palette = await renderHook(() => useCommands({ search: jest.fn() }))
    await settle()

    expect(registered()).toEqual([' ', 'command+ArrowRight', 'command+k'])
    expect(native.commands.find(command => command.input === 'k')).toMatchObject({
      title: 'Search',
      whileTyping: true,
    })
    // Space and ⌘→ are the page's on the desktop: a text field keeps them here.
    expect(native.commands.find(command => command.input === ' ')).toMatchObject({
      title: 'Play / Pause',
      whileTyping: false,
    })

    native.press({ input: ' ' })
    native.press({ input: 'ArrowRight', modifiers: ['command'] })
    expect(toggle).toHaveBeenCalledTimes(1)
    expect(next).toHaveBeenCalledTimes(1)

    // A press the module made while a field had the keyboard is not the page's.
    native.press({ input: ' ', typing: true })
    expect(toggle).toHaveBeenCalledTimes(1)

    await palette.unmount()
    await settle()
    expect(registered()).toEqual([' ', 'command+ArrowRight'])
    await frame.unmount()
    await settle()
    expect(registered()).toEqual([])
  })

  it('calls the handler given last, not the one it registered with', async () => {
    const first = jest.fn()
    const second = jest.fn()
    const hook = await renderHook(({ run }: { run: () => void }) => useHotkeys({ 'meta+e': run }), {
      initialProps: { run: first },
    })
    await hook.rerender({ run: second })
    await settle()
    native.press({ input: 'e', modifiers: ['command'] })
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
    expect(native.commands).toEqual([{ input: 'e', modifiers: ['command'], whileTyping: false }])
    await hook.unmount()
  })

  it('closes the top layer alone, and the page’s Escape only with no layer open', async () => {
    const clearSelection = jest.fn()
    const closeStage = jest.fn()
    const closeSheet = jest.fn()
    const closePopover = jest.fn()
    const selection = await renderHook(() => useEscape(true, clearSelection))
    const stage = await renderHook(() => useEscape(true, closeStage))
    const sheet = await renderHook(() => useEscape(true, closeSheet, { layer: true }))
    const popover = await renderHook(() => useEscape(true, closePopover, { layer: true }))
    await settle()
    // One key command for all four, kept in a text field: Escape types nothing.
    expect(native.commands).toEqual([{ input: 'Escape', modifiers: [], whileTyping: true }])

    native.press({ input: 'Escape', typing: true })
    expect(closePopover).toHaveBeenCalledTimes(1)
    expect(closeSheet).not.toHaveBeenCalled()

    await popover.unmount()
    native.press({ input: 'Escape' })
    expect(closeSheet).toHaveBeenCalledTimes(1)
    expect(clearSelection).not.toHaveBeenCalled()

    await sheet.unmount()
    native.press({ input: 'Escape' })
    expect(clearSelection).toHaveBeenCalledTimes(1)
    expect(closeStage).toHaveBeenCalledTimes(1)

    await selection.unmount()
    await stage.unmount()
    await settle()
    expect(native.commands).toEqual([])
  })

  it('selects every song with ⌘A, not under an open layer, and leaves ⌘A to a field', async () => {
    const selectAll = jest.fn(() => true)
    const list = await renderHook(() =>
      useListKeys({ toggle: jest.fn(), selectAll, reveal: jest.fn() }),
    )
    await settle()
    expect(native.commands).toEqual([
      { input: 'a', modifiers: ['command'], title: 'Select all songs', whileTyping: false },
    ])

    native.press({ input: 'a', modifiers: ['command'] })
    expect(selectAll).toHaveBeenCalledTimes(1)

    const sheet = await renderHook(() => useEscape(true, jest.fn(), { layer: true }))
    native.press({ input: 'a', modifiers: ['command'] })
    expect(selectAll).toHaveBeenCalledTimes(1)
    await sheet.unmount()

    await list.unmount()
  })

  it('names the menu’s keys only while a keyboard is attached', async () => {
    const menu = await renderHook(() => useMenuCommands())
    expect(menu.result.current).toBeNull()

    await act(async () => native.connect(true))
    expect(menu.result.current?.find(item => item.command === 'search')?.accelerator).toBe(
      'CmdOrCtrl+K',
    )

    await act(async () => native.connect(false))
    expect(menu.result.current).toBeNull()
    await menu.unmount()
  })
})
