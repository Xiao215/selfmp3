import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App.js'
import './styles/index.css'

/**
 * Entry point.
 *
 * Query defaults are tuned for a personal library reached over a home network:
 * refetch when the app regains focus (you probably left it open on your phone
 * for hours), do not retry forever when the server is unreachable, and keep
 * cached data around long enough to survive a backgrounded tab.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 30 * 60_000,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      retry: 1,
    },
    mutations: {
      retry: 0,
    },
  },
})

const container = document.getElementById('root')
if (!container) throw new Error('#root is missing from index.html')

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)

/**
 * Register the service worker.
 *
 * Production only: in development it would cache the dev server's modules and
 * make every change invisible until a hard reload, which is a miserable way to
 * work. An update is applied on the next visit rather than mid-session, so a
 * new build never interrupts playback.
 */
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error: unknown) => {
      console.warn('service worker registration failed', error)
    })
  })
}
