import type { Settings } from '@selfmp3/shared'

/**
 * The Lyrics+ section of Settings.
 *
 * Romanization is one switch, and it runs entirely on your Mac, so there is
 * nothing to configure beyond on or off.
 */
export function LyricsSettings({
  settings,
  onSet,
}: {
  settings: Settings
  onSet: <K extends keyof Settings>(key: K, value: Settings[K]) => void
}) {
  return (
    <section className="panel" id="lyrics">
      <header className="panel-head">
        <h2>Lyrics</h2>
        <span className="hint">shared across your devices</span>
      </header>

      <label className="setting-row setting-row-toggle">
        <span className="setting-label">
          Show pinyin / romaji
          <span className="setting-hint">
            A romanized line under each Chinese or Japanese lyric, generated on your Mac —
            nothing leaves your library.
          </span>
        </span>
        <span className="setting-control">
          <input
            type="checkbox"
            className="toggle"
            checked={settings.lyricsRomanization === 'on'}
            onChange={event => onSet('lyricsRomanization', event.target.checked ? 'on' : 'off')}
          />
        </span>
      </label>
    </section>
  )
}
