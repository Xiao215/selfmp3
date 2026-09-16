import { extractUrls } from '@selfmp3/shared'

/**
 * "Import link to self.mp3", on a right-click anywhere (B2).
 *
 * Two items: one that imports with your defaults and says so through the badge
 * and the notification, and one that opens the popup on that link so tags and a
 * playlist can be picked first. A link is all either needs, so neither asks for
 * permission to read any page.
 */

const QUICK_ID = 'selfmp3-import'
const REVIEW_ID = 'selfmp3-import-with'

/** The link a menu click was about: the link itself, or one in the selected text. */
export function linkFrom(info: {
  linkUrl?: string | undefined
  selectionText?: string | undefined
  pageUrl?: string | undefined
}): string | null {
  if (info.linkUrl) return info.linkUrl
  const inSelection = info.selectionText ? extractUrls(info.selectionText, 1)[0] : undefined
  return inSelection ?? info.pageUrl ?? null
}

interface MenuDeps {
  /** Import the link with the defaults, and watch the job it made. */
  readonly quickImport: (url: string) => Promise<void>
  /** Open the popup on a link, as a window of its own. */
  readonly openReview: (url: string) => Promise<void>
}

export function installMenus({ quickImport, openReview }: MenuDeps): void {
  chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({
        id: QUICK_ID,
        title: 'Import link to self.mp3',
        contexts: ['link', 'selection', 'page'],
      })
      chrome.contextMenus.create({
        id: REVIEW_ID,
        title: 'Import with tags and playlist…',
        contexts: ['link', 'selection', 'page'],
      })
    })
  })

  chrome.contextMenus.onClicked.addListener(info => {
    const url = linkFrom(info)
    if (!url) return
    if (info.menuItemId === QUICK_ID) void quickImport(url)
    else if (info.menuItemId === REVIEW_ID) void openReview(url)
  })
}

/** The popup, opened on a link in a window of its own. */
export async function openPopupWindow(url: string): Promise<void> {
  await chrome.windows.create({
    url: chrome.runtime.getURL(`popup.html?url=${encodeURIComponent(url)}`),
    type: 'popup',
    width: 400,
    height: 620,
  })
}
