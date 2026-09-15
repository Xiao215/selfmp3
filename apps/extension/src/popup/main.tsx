import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Popup } from './Popup.js'

const root = document.getElementById('root')
if (root) {
  // A popup has no window focus to come back to; reading again on focus would only flicker.
  const client = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } })
  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={client}>
        <Popup />
      </QueryClientProvider>
    </StrictMode>,
  )
}
