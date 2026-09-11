import { useCallback, useEffect, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useLibrary, useSettings } from './lib/queries.js'
import { PlayerProvider } from './player/PlayerProvider.js'
import { OfflineProvider } from './offline/OfflineProvider.js'
import { useHotkeys, useIsMobile } from './lib/hooks.js'
import { Sidebar } from './components/Sidebar.js'
import { MobileNav } from './components/MobileNav.js'
import { PlayerBar } from './components/PlayerBar.js'
import { QueuePanel } from './components/QueuePanel.js'
import { PracticePanel } from './components/PracticePanel.js'
import { NowPlaying } from './components/NowPlaying.js'
import {
  NowPlayingPage,
  type PageMode,
  type StageTab,
} from './components/nowplaying/NowPlayingPage.js'
import { CommandPalette } from './components/CommandPalette.js'
import { ToastHost } from './components/Toast.js'
import { TooltipHost } from './components/Tooltip.js'
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
import { TagInboxView } from './views/TagInboxView.js'

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
  const isMobile = useIsMobile()

  const [selectedTags, setSelectedTags] = useState<ReadonlySet<number>>(() => new Set())
  const [excludedTags, setExcludedTags] = useState<ReadonlySet<number>>(() => new Set())
  const [queueOpen, setQueueOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [nowPlayingOpen, setNowPlayingOpen] = useState(false)
  const [practiceOpen, setPracticeOpen] = useState(false)
  const [tagsOpen, setTagsOpen] = useState(false)
  // The now-playing page on a computer: closed, Stage, or Focus.
  const [page, setPage] = useState<PageMode | null>(null)
  const [pageTab, setPageTab] = useState<StageTab>('lyrics')
  // Focus with a still mouse: the bar steps aside too.
  const [ambient, setAmbient] = useState(false)
  const pageOpen = !isMobile && page !== null

  // A tag filters one of two ways — "only these" or "none of these" — never
  // both, so moving it to one side takes it off the other.
  const toggleTag = useCallback((tagId: number) => {
    setSelectedTags(current => {
      const next = new Set(current)
      if (next.has(tagId)) next.delete(tagId)
      else next.add(tagId)
      return next
    })
    setExcludedTags(current => {
      if (!current.has(tagId)) return current
      const next = new Set(current)
      next.delete(tagId)
      return next
    })
  }, [])

  const excludeTag = useCallback((tagId: number) => {
    setExcludedTags(current => {
      const next = new Set(current)
      if (next.has(tagId)) next.delete(tagId)
      else next.add(tagId)
      return next
    })
    setSelectedTags(current => {
      if (!current.has(tagId)) return current
      const next = new Set(current)
      next.delete(tagId)
      return next
    })
  }, [])

  const clearTags = useCallback(() => {
    setSelectedTags(new Set())
    setExcludedTags(new Set())
  }, [])

  // Only one side panel at a time — two at once leaves no room for the library.
  const openQueue = useCallback(() => {
    // With the page open, the queue is one of its tabs rather than a second
    // copy of itself beside it.
    if (pageOpen) {
      setPage('stage')
      setPageTab(tab => (tab === 'queue' && page === 'stage' ? 'lyrics' : 'queue'))
      setQueueOpen(false)
      return
    }
    setQueueOpen(open => !open)
    setPracticeOpen(false)
  }, [pageOpen, page])

  const openPractice = useCallback(() => {
    setPracticeOpen(open => !open)
    setQueueOpen(false)
  }, [])

  /** The cover in the bar: open the page at Stage, or close it. */
  const togglePage = useCallback(() => {
    if (isMobile) {
      setNowPlayingOpen(true)
      return
    }
    setPage(current => (current === null ? 'stage' : null))
    setPageTab('lyrics')
  }, [isMobile])

  /** The mic: straight to the words, and the same again to put them away. */
  const toggleLyrics = useCallback(() => {
    if (isMobile) {
      setNowPlayingOpen(true)
      return
    }
    setPage(current => (current === 'focus' ? null : 'focus'))
    setPageTab('lyrics')
  }, [isMobile])

  const closePage = useCallback(() => setPage(null), [])

  // Everything is done with the mouse for now. ⌘K stays: it is the only way
  // into the search palette, which closes itself on Escape.
  useHotkeys({
    'meta+k': () => setPaletteOpen(true),
    'ctrl+k': () => setPaletteOpen(true),
  })

  const classes = ['app']
  if (isMobile) classes.push('is-mobile')
  if (pageOpen && ambient) classes.push('is-ambient')

  return (
    <div className={classes.join(' ')}>
      <div className="app-body">
        {/*
          The page lies over the library rather than replacing it, so the view
          underneath keeps its scroll position, search and filters for when you
          come back. Side panels stay beside it: practice next to the lyrics is
          exactly where it is wanted.
        */}
        <div className={`app-content ${pageOpen ? 'has-page' : ''}`}>
          {!isMobile && (
            <Sidebar
              inert={pageOpen}
              library={library}
              selectedTags={selectedTags}
              excludedTags={excludedTags}
              onToggleTag={toggleTag}
              onExcludeTag={excludeTag}
              onClearTags={clearTags}
            />
          )}

          <main className="app-main" inert={pageOpen}>
            <Routes>
              <Route
                path="/"
                element={
                  <LibraryView
                    selectedTags={selectedTags}
                    excludedTags={excludedTags}
                    onToggleTag={toggleTag}
                    onExcludeTag={excludeTag}
                    onClearTags={clearTags}
                  />
                }
              />
              <Route path="/inbox" element={<TagInboxView />} />
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

          {/* Toasts are a real row under what they would otherwise cover: the
              library, or the page when it is open. Never under the sidebar,
              which would lift its foot off the bottom of the window. */}
          <div className="toast-layer">
            <ResumeToast />
            <ToastHost />
          </div>

          {!isMobile && page !== null && (
            <NowPlayingPage
              mode={page}
              tab={pageTab}
              onModeChange={setPage}
              onTabChange={setPageTab}
              onClose={closePage}
              onIdleChange={setAmbient}
            />
          )}
        </div>

        {!isMobile && queueOpen && <QueuePanel onClose={() => setQueueOpen(false)} />}
        {!isMobile && practiceOpen && <PracticePanel onClose={() => setPracticeOpen(false)} />}
      </div>

      <PlayerBar
        onToggleLyrics={toggleLyrics}
        onOpenQueue={openQueue}
        onOpenPractice={openPractice}
        onTogglePage={togglePage}
        page={pageOpen ? page : null}
        queueOpen={queueOpen || (pageOpen && page === 'stage' && pageTab === 'queue')}
        practiceOpen={practiceOpen}
        tagsOpen={tagsOpen}
        onToggleTags={() => setTagsOpen(open => !open)}
      />

      {isMobile && <MobileNav />}

      {isMobile && nowPlayingOpen && <NowPlaying onClose={() => setNowPlayingOpen(false)} />}

      <CommandPalette library={library} open={paletteOpen} onClose={() => setPaletteOpen(false)} />

      <TooltipHost />
    </div>
  )
}
