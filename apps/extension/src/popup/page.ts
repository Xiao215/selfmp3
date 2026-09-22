/** The page the popup was opened on. */
export interface Page {
  readonly url: string | null
  readonly title: string | null
}

/**
 * The tab's link and title, which `activeTab` hands over for the tab the
 * toolbar button was pressed on — or the link given as `?url=`, which is how
 * the end-to-end specs and the menu's own window (menus.ts) open it.
 */
export async function currentPage(): Promise<Page> {
  const params = new URLSearchParams(location.search)
  const given = params.get('url')
  if (given !== null) return { url: given, title: params.get('title') }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  return { url: tab?.url ?? null, title: tab?.title ?? null }
}
