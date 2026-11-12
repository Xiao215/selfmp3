import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { type Href, router } from 'expo-router'
import { useUnistyles } from 'react-native-unistyles'
import { isRoomTrackId, useLibrary, useToggleLoved } from '@selfmp3/client'
import { CommandPalette } from '../features/commandPalette/CommandPalette'
import { NewPlaylist } from '../features/playlists/NewPlaylist'
import { usePlayer, usePlayerCommands, usePlayingSongId } from '../player/PlayerProvider'
import { pressed } from '../player/roomTransport'
import { SEEK_STEP_SECONDS, VOLUME_STEP } from '../player/progress.model'
import { onDeepLinkRoute } from '../ports/deepLinks'
import { desktop } from '../ports/desktop/bridge'
import { closeLayers } from './layers'
import { setPaletteOpen, usePaletteOpen } from './palette'
import { useCommands } from './useCommands'

/**
 * What the frame does for the operating system: the installed app's menu bar
 * (its commands, its ticks, the window's own colour), the windows a menu key
 * opens (the command palette, a new playlist), and `selfmp3://` links. Drawn
 * once, inside the shell's overlay host; each part draws nothing, or nothing
 * but its window, and does nothing where there is no menu bar or no link.
 */
export function MenuHosts(): ReactNode {
  return (
    <>
      <PaletteHost />
      <MenuCommands />
      {desktop ? <MenuChecks /> : null}
      {desktop ? <WindowGround /> : null}
      <NewPlaylistHost />
      <DeepLinkRoutes />
    </>
  )
}

/**
 * `selfmp3://playlist/12` and `selfmp3://now-playing`, from the operating
 * system: a link in a note, or one the app sent itself. Nothing on a phone or
 * in a browser, which have their own ways of being pointed at a page.
 */
function DeepLinkRoutes(): ReactNode {
  useEffect(
    () =>
      onDeepLinkRoute(route => {
        closeLayers()
        if (route.kind === 'now-playing') router.navigate('/now-playing')
        else router.navigate(`/playlists/${route.id}`)
      }),
    [],
  )
  return null
}

/**
 * Everything the desktop's application menu can ask for.
 *
 * Nothing on a phone or in a browser tab: `useCommands` has no shell to listen
 * to there, and the keys the menu draws but does not take are only registered
 * where the menu exists. So this component is the frame's wiring for a window
 * with a menu bar, and a no-op everywhere else.
 */
function MenuCommands(): ReactNode {
  const player = usePlayerCommands()
  const playingId = usePlayingSongId()
  const { data: library } = useLibrary()
  const toggleLoved = useToggleLoved()
  // A page chosen from the menu bar closes whatever was open over this one:
  // left open, a song's menu went on working over Settings.
  const open = (path: Href): void => {
    closeLayers()
    router.navigate(path)
  }
  useCommands({
    home: () => open('/'),
    library: () => open('/library'),
    import: () => open('/import'),
    stats: () => open('/stats'),
    playlists: () => open('/playlists'),
    'now-playing': () => open('/now-playing'),
    settings: () => open('/settings'),
    // File › Import…: the page, with its field ready to paste into. A new
    // value each time, so the field takes the focus again on the page itself.
    'start-import': () => open({ pathname: '/import', params: { focus: String(Date.now()) } }),
    // The playing song, as the heart beside it does; a friend's song in a room has none.
    like: () => {
      if (playingId === null || isRoomTrackId(playingId)) return
      const song = library?.songs.find(one => one.id === playingId)
      if (song) toggleLoved.mutate({ id: song.id, loved: !song.loved })
    },
    // Pressed, so in a room this device follows they are the room's (roomTransport.ts).
    'play-pause': () => pressed('toggle', player.toggle),
    next: () => pressed('next', player.next),
    previous: () => pressed('previous', player.previous),
    'seek-forward': () => player.seekBy(SEEK_STEP_SECONDS),
    'seek-back': () => player.seekBy(-SEEK_STEP_SECONDS),
    shuffle: () => player.toggleShuffle(),
    'repeat-off': () => player.setRepeatMode('off'),
    'repeat-all': () => player.setRepeatMode('all'),
    'repeat-one': () => player.setRepeatMode('one'),
    'volume-up': () => player.stepVolume(VOLUME_STEP),
    'volume-down': () => player.stepVolume(-VOLUME_STEP),
    mute: () => player.toggleMute(),
  })
  return null
}

/**
 * The Mac window's own colour follows the theme on screen: the ground it shows
 * at its edges while being resized, and opens in next time (Paper's on Paper).
 */
function WindowGround(): ReactNode {
  const { theme } = useUnistyles()
  const ground = theme.colors.surface0
  useEffect(() => {
    void desktop?.setWindowGround(ground)
  }, [ground])
  return null
}

/**
 * File › New Playlist (⌘N): the same window the sidebar's + opens, here so it
 * opens at any width, a window too narrow for the sidebar included.
 */
function NewPlaylistHost(): ReactNode {
  const [open, setOpen] = useState(false)
  useCommands({ 'new-playlist': () => setOpen(true) })
  return <NewPlaylist open={open} onClose={() => setOpen(false)} />
}

/**
 * The installed app's menu ticks Shuffle, the Repeat mode and Like as the
 * player has them (AO1): told to the shell whenever one changes. Drawn only
 * where there is a shell to tell.
 */
function MenuChecks(): ReactNode {
  const { queue, current } = usePlayer()
  const { data: library } = useLibrary()
  // The library's word on the like, which a heart pressed anywhere changes first.
  const liked = useMemo(() => {
    if (!current || isRoomTrackId(current.id)) return null
    return library?.songs.find(one => one.id === current.id)?.loved ?? current.loved
  }, [current, library])
  useEffect(() => {
    void desktop?.setMenuState({ shuffle: queue.shuffle, repeat: queue.repeat, liked })
  }, [queue.shuffle, queue.repeat, liked])
  return null
}

/**
 * The command palette, opened by the sidebar's Search row or, in the installed
 * app, by View › Search (⌘K), which arrives here as a menu command.
 *
 * A browser tab has no key for it on purpose: ⌘K there is
 * the browser's own, and a page that takes it answers a key the person meant
 * for the browser. The installed app has a menu that says ⌘K out loud.
 */
function PaletteHost(): ReactNode {
  const open = usePaletteOpen()
  useCommands({ search: () => setPaletteOpen(true) })
  // Mounted only while open, so each opening starts with an empty box.
  return open ? <CommandPalette onClose={() => setPaletteOpen(false)} /> : null
}
