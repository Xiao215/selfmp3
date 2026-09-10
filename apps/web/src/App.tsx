import { useCallback, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useLibrary, useSettings } from './lib/queries.js'
import { PlayerProvider, usePlayer } from './player/PlayerProvider.js'
import { OfflineProvider } from './offline/OfflineProvider.js'
import { useHotkeys, useIsMobile } from './lib/hooks.js'
import { Sidebar } from './components/Sidebar.js'
import { MobileNav } from './components/MobileNav.js'
import { PlayerBar } from './components/PlayerBar.js'
import { LyricsPanel } from './components/LyricsPanel.js'
import { QueuePanel } from './components/QueuePanel.js'
import { NowPlaying } from './components/NowPlaying.js'
import { CommandPalette } from './components/CommandPalette.js'
import { LibraryView } from './views/LibraryView.js'
import { PlaylistsView } from './views/PlaylistsView.js'
import { PlaylistDetailView } from './views/PlaylistDetailView.js'
import { ImportView } from './views/ImportView.js'
import { MigrateView } from './views/MigrateView.js'
import { StatsView } from './views/StatsView.js'
import { SettingsView } from './views/SettingsView.js'

/**
 * App shell.
 *
 * The provider order matters: offline state wraps everything (the player needs
 * to know what is cached), and the player wraps the routed views (every view
 * can start playback).
 */
export default function App() {
  return (
    <OfflineProvider>
      <AppWithLibrary />
    </OfflineProvider>
  )
}

function AppWithLibrary() {
  const { data: library } = useLibrary()
  const { data: settings } = useSettings()

  return (
    <PlayerProvider
      songs={library?.songs ?? []}
      crossfadeSeconds={settings?.crossfadeSeconds ?? 0}
      gapless={settings?.gapless ?? true}
      playThreshold={settings?.playThreshold ?? 0.5}
    >
      <Shell />
    </PlayerProvider>
  )
}

function Shell() {
  const { data: library } = useLibrary()
  const player = usePlayer()
  const isMobile = useIsMobile()

  const [selectedTags, setSelectedTags] = useState<ReadonlySet<number>>(() => new Set())
  const [lyricsOpen, setLyricsOpen] = useState(false)
  const [queueOpen, setQueueOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [nowPlayingOpen, setNowPlayingOpen] = useState(false)

  const toggleTag = useCallback((tagId: number) => {
    setSelectedTags(current => {
      const next = new Set(current)
      if (next.has(tagId)) next.delete(tagId)
      else next.add(tagId)
      return next
    })
  }, [])

  const clearTags = useCallback(() => setSelectedTags(new Set()), [])

  useHotkeys({
    'meta+k': () => setPaletteOpen(true),
    'ctrl+k': () => setPaletteOpen(true),
    ' ': () => player.toggle(),
    ArrowRight: () => player.seekBy(5),
    ArrowLeft: () => player.seekBy(-5),
    'shift+ArrowRight': () => player.next(),
    'shift+ArrowLeft': () => player.previous(),
    s: () => player.toggleShuffle(),
    r: () => player.cycleRepeatMode(),
    l: () => setLyricsOpen(open => !open),
    q: () => setQueueOpen(open => !open),
    Escape: () => {
      setPaletteOpen(false)
      setNowPlayingOpen(false)
    },
  })

  // Only one side panel at a time — two at once leaves no room for the library.
  const openLyrics = useCallback(() => {
    setLyricsOpen(open => !open)
    setQueueOpen(false)
  }, [])

  const openQueue = useCallback(() => {
    setQueueOpen(open => !open)
    setLyricsOpen(false)
  }, [])

  return (
    <div className={`app ${isMobile ? 'is-mobile' : ''}`}>
      <div className="app-body">
        {!isMobile && (
          <Sidebar
            library={library}
            selectedTags={selectedTags}
            onToggleTag={toggleTag}
            onClearTags={clearTags}
          />
        )}

        <main className="app-main">
          <Routes>
            <Route
              path="/"
              element={
                <LibraryView
                  selectedTags={selectedTags}
                  onToggleTag={toggleTag}
                  onClearTags={clearTags}
                />
              }
            />
            <Route path="/playlists" element={<PlaylistsView />} />
            <Route path="/playlists/:id" element={<PlaylistDetailView />} />
            <Route path="/import" element={<ImportView />} />
            <Route path="/import/migrate" element={<MigrateView />} />
            <Route path="/stats" element={<StatsView />} />
            <Route path="/settings" element={<SettingsView />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>

        {!isMobile && lyricsOpen && <LyricsPanel onClose={() => setLyricsOpen(false)} />}
        {!isMobile && queueOpen && <QueuePanel onClose={() => setQueueOpen(false)} />}
      </div>

      <PlayerBar
        onOpenLyrics={openLyrics}
        onOpenQueue={openQueue}
        onOpenNowPlaying={() => setNowPlayingOpen(true)}
        lyricsOpen={lyricsOpen}
        queueOpen={queueOpen}
      />

      {isMobile && <MobileNav />}

      {isMobile && nowPlayingOpen && <NowPlaying onClose={() => setNowPlayingOpen(false)} />}

      <CommandPalette
        library={library}
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
      />
    </div>
  )
}
