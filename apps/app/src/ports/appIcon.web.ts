import { oklchToHex } from '@selfmp3/client'

/**
 * The tab's icon in this device's accent: `public/icons/icon.svg`, the beamed
 * 音符 on its dark tile, redrawn at the chosen hue and put in the page head as
 * a data URL. It replaces the build's static favicon, so picking Teal in
 * Settings turns the tab teal too.
 *
 * The installed icons (the manifest's PNGs, the home-screen one) are files a
 * browser fetched once; they keep the colour they were built with.
 */

const ICON_LINK_ID = 'selfmp3-accent-icon'

export function setAppIconHue(hue: number): void {
  if (typeof document === 'undefined') return
  const svg = iconSvg(hue)
  const href = `data:image/svg+xml,${encodeURIComponent(svg)}`

  let link = document.getElementById(ICON_LINK_ID) as HTMLLinkElement | null
  if (!link) {
    // The build's `favicon.ico` would otherwise win in some browsers.
    for (const other of document.head.querySelectorAll('link[rel~="icon"]')) other.remove()
    link = document.createElement('link')
    link.id = ICON_LINK_ID
    link.rel = 'icon'
    link.type = 'image/svg+xml'
    document.head.appendChild(link)
  }
  if (link.href !== href) link.href = href
}

function iconSvg(hue: number): string {
  // The shipped icon's violet (#b9a4ff → #6d5ce7 on #1a1526 → #0c0b10), as
  // lightness and chroma, so every hue gets the same weight.
  const noteLight = oklchToHex(0.76, 0.13, hue)
  const noteDeep = oklchToHex(0.54, 0.18, hue)
  const tileTop = oklchToHex(0.2, 0.035, hue)
  const tileBottom = oklchToHex(0.14, 0.012, hue)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
<defs>
<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${tileTop}"/><stop offset="100%" stop-color="${tileBottom}"/></linearGradient>
<linearGradient id="note" x1="0.1" y1="0" x2="0.9" y2="1"><stop offset="0%" stop-color="${noteLight}"/><stop offset="100%" stop-color="${noteDeep}"/></linearGradient>
</defs>
<rect width="512" height="512" rx="114" fill="url(#bg)"/>
<g fill="url(#note)">
<path d="M186 168 L370 130 L370 190 L186 228 Z"/>
<rect x="186" y="168" width="26" height="180" rx="13"/>
<rect x="344" y="130" width="26" height="180" rx="13"/>
<ellipse cx="152" cy="348" rx="52" ry="39" transform="rotate(-22 152 348)"/>
<ellipse cx="310" cy="310" rx="52" ry="39" transform="rotate(-22 310 310)"/>
</g>
</svg>`
}
