import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Options } from './Options.js'

const root = document.getElementById('root')
if (root) {
  const client = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } })
  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={client}>
        <Options />
      </QueryClientProvider>
    </StrictMode>,
  )
}
