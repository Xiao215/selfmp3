import { useCallback, useEffect, useState } from 'react'
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
import { PracticePanel } from './components/PracticePanel.js'
import { NowPlaying } from './components/NowPlaying.js'
import { CommandPalette } from './components/CommandPalette.js'
import { DevicesProvider } from './devices/DevicesProvider.js'
import { ResumeToast } from './devices/ResumeToast.js'
import { LibraryView } from './views/LibraryView.js'
import { PlaylistsView } from './views/PlaylistsView.js'
import { PlaylistDetailView } from './views/PlaylistDetailView.js'
import { ImportView } from './views/ImportView.js'
import { MigrateView } from './views/MigrateView.js'
import { StatsView } from './views/StatsView.js'
import { WrappedView } from './views/WrappedView.js'
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

  // The accent hue is a saved setting, and every colour token in the app is
  // derived from it, so one custom property on the root repaints everything.
  const accentHue = settings?.accentHue
  useEffect(() => {
    if (accentHue === undefined) return
    document.documentElement.style.setProperty('--accent-hue', String(accentHue))
  }, [accentHue])

  return (
    <PlayerProvider
      songs={library?.songs ?? []}
      crossfadeSeconds={settings?.crossfadeSeconds ?? 0}
      gapless={settings?.gapless ?? true}
      playThreshold={settings?.playThreshold ?? 0.5}
    >
      {/* Inside the player: presence reads it, and remote commands drive it. */}
      <DevicesProvider>
        <Shell />
      </DevicesProvider>
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
  const [practiceOpen, setPracticeOpen] = useState(false)

  const toggleTag = useCallback((tagId: number) => {
    setSelectedTags(current => {
      const next = new Set(current)
      if (next.has(tagId)) next.delete(tagId)
      else next.add(tagId)
      return next
    })
  }, [])

  const clearTags = useCallback(() => setSelectedTags(new Set()), [])

  // Only one side panel at a time — two at once leaves no room for the library.
  const openLyrics = useCallback(() => {
    setLyricsOpen(open => !open)
    setQueueOpen(false)
    setPracticeOpen(false)
  }, [])

  const openQueue = useCallback(() => {
    setQueueOpen(open => !open)
    setLyricsOpen(false)
    setPracticeOpen(false)
  }, [])

  const openPractice = useCallback(() => {
    setPracticeOpen(open => !open)
    setLyricsOpen(false)
    setQueueOpen(false)
  }, [])

  // Declared after the panel callbacks so the shortcuts go through the same
  // one-panel-at-a-time rule the buttons use, rather than a second copy of it.
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
    l: openLyrics,
    q: openQueue,
    p: openPractice,
    Escape: () => {
      setPaletteOpen(false)
      setNowPlayingOpen(false)
    },
  })

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
            <Route path="/stats/wrapped" element={<WrappedView />} />
            <Route path="/settings" element={<SettingsView />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>

        {!isMobile && lyricsOpen && <LyricsPanel onClose={() => setLyricsOpen(false)} />}
        {!isMobile && queueOpen && <QueuePanel onClose={() => setQueueOpen(false)} />}
        {!isMobile && practiceOpen && <PracticePanel onClose={() => setPracticeOpen(false)} />}
      </div>

      {/* Toasts live between the content and the transport: they announce
          themselves without covering a song row or the player. */}
      <div className="toast-layer">
        <ResumeToast />
      </div>

      <PlayerBar
        onOpenLyrics={openLyrics}
        onOpenQueue={openQueue}
        onOpenPractice={openPractice}
        onOpenNowPlaying={() => setNowPlayingOpen(true)}
        lyricsOpen={lyricsOpen}
        queueOpen={queueOpen}
        practiceOpen={practiceOpen}
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
