import { useEffect, useState } from 'react'
import type { SecretProvider, Settings, TranslationProvider } from '@selfmp3/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api.js'
import { queryKeys } from '../lib/queries.js'
import { CheckCircle } from './Icons.js'
import { Select } from './Select.js'

/**
 * The Lyrics+ section of Settings.
 *
 * Romanization is one switch. Translation needs a language, a provider, and a
 * key for that provider — keys go to the server and never come back: the UI
 * only ever learns whether one is set, and shows a masked placeholder in its
 * place.
 */

const PROVIDERS: Array<{ value: TranslationProvider; label: string }> = [
  { value: 'none', label: 'Off' },
  { value: 'anthropic', label: 'Anthropic (Claude)' },
  { value: 'openai', label: 'OpenAI' },
]

const KEY_PLACEHOLDER: Record<SecretProvider, string> = {
  anthropic: 'sk-ant-…',
  openai: 'sk-…',
}

export function LyricsSettings({
  settings,
  onSet,
}: {
  settings: Settings
  onSet: <K extends keyof Settings>(key: K, value: Settings[K]) => void
}) {
  const client = useQueryClient()
  const { data: secrets } = useQuery({
    queryKey: queryKeys.secrets,
    queryFn: () => api.secrets(),
    staleTime: 5 * 60_000,
  })

  const setSecret = useMutation({
    mutationFn: ({ provider, key }: { provider: SecretProvider; key: string | null }) =>
      api.setSecret(provider, key),
    onSuccess: status => client.setQueryData(queryKeys.secrets, status),
  })

  // The language is free text, so it is committed on blur / Enter rather than
  // on every keystroke — a half-typed "z" is not a language.
  const [lang, setLang] = useState(settings.lyricsTranslationLang)
  useEffect(() => setLang(settings.lyricsTranslationLang), [settings.lyricsTranslationLang])
  const commitLang = (): void => {
    const trimmed = lang.trim().toLowerCase()
    if (trimmed.length >= 2 && trimmed !== settings.lyricsTranslationLang) {
      onSet('lyricsTranslationLang', trimmed)
    } else if (trimmed.length < 2) {
      setLang(settings.lyricsTranslationLang)
    }
  }

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

      <label className="setting-row">
        <span className="setting-label">
          Translate lyrics into
          <span className="setting-hint">
            A language code like <code>en</code>, <code>zh</code> or <code>ja</code>. Each song
            is translated once and cached.
          </span>
        </span>
        <span className="setting-control">
          <input
            className="input input-small lyrics-lang-input"
            value={lang}
            onChange={event => setLang(event.target.value)}
            onBlur={commitLang}
            onKeyDown={event => {
              if (event.key === 'Enter') event.currentTarget.blur()
            }}
            maxLength={16}
            spellCheck={false}
            autoComplete="off"
            aria-label="Translation language"
          />
        </span>
      </label>

      <div className="setting-row">
        <span className="setting-label">
          Translation provider
          <span className="setting-hint">
            Off by default. Pick one and add its API key below; the key is stored on your Mac
            and is only ever sent to that provider.
          </span>
        </span>
        <span className="setting-control">
          <Select<TranslationProvider>
            value={settings.lyricsTranslationProvider}
            onChange={value => onSet('lyricsTranslationProvider', value)}
            options={PROVIDERS}
            label="Translation provider"
            align="end"
          />
        </span>
      </div>

      {(['anthropic', 'openai'] as const).map(provider => (
        <ApiKeyRow
          key={provider}
          provider={provider}
          hasKey={secrets?.[provider].hasKey ?? false}
          active={settings.lyricsTranslationProvider === provider}
          pending={setSecret.isPending}
          onSave={key => setSecret.mutate({ provider, key })}
        />
      ))}

      {settings.lyricsTranslationProvider !== 'none' &&
        secrets &&
        !secrets[settings.lyricsTranslationProvider].hasKey && (
          <p className="notice notice-warn">
            Translations are on, but there is no API key for{' '}
            {PROVIDERS.find(option => option.value === settings.lyricsTranslationProvider)?.label}{' '}
            yet.
          </p>
        )}
    </section>
  )
}

/**
 * One provider's API key.
 *
 * A secret the UI never gets to read back, so the row has to *say* what it
 * knows: a "Key saved" pill when the server holds one, "Not set" when it does
 * not, and a masked field for pasting a replacement. The paste can be revealed
 * while it is being typed — checking a key you just pasted is the one moment
 * where hiding it helps nobody — but it is masked again the moment it is saved.
 */
function ApiKeyRow({
  provider,
  hasKey,
  active,
  pending,
  onSave,
}: {
  provider: SecretProvider
  hasKey: boolean
  active: boolean
  pending: boolean
  onSave: (key: string | null) => void
}) {
  const [draft, setDraft] = useState('')
  const [revealed, setRevealed] = useState(false)
  const label = provider === 'anthropic' ? 'Anthropic API key' : 'OpenAI API key'

  return (
    <div className={`setting-row lyrics-key-row ${active ? 'is-active' : ''}`}>
      <span className="setting-label">
        {label}
        <span className="setting-hint">
          {hasKey
            ? 'Stored on your Mac and never sent back to this page. Paste a new one to replace it.'
            : 'Stored on your Mac and only ever sent to this provider.'}
        </span>
      </span>
      <span className="setting-control lyrics-key-control">
        <span className={`secret-state ${hasKey ? 'is-set' : 'is-unset'}`}>
          {hasKey ? (
            <>
              <CheckCircle size={12} /> Key saved
            </>
          ) : (
            <>
              <Lock size={12} /> Not set
            </>
          )}
        </span>
        <input
          className="input input-small"
          type={revealed ? 'text' : 'password'}
          value={draft}
          onChange={event => setDraft(event.target.value)}
          placeholder={hasKey ? '••••••••••••' : KEY_PLACEHOLDER[provider]}
          autoComplete="off"
          spellCheck={false}
          aria-label={hasKey ? `Replace ${label.toLowerCase()}` : label}
        />
        {draft.length > 0 && (
          <button
            type="button"
            className="link-button"
            onClick={() => setRevealed(current => !current)}
            aria-pressed={revealed}
          >
            {revealed ? 'Hide' : 'Show'}
          </button>
        )}
        <button
          type="button"
          className="button button-small"
          disabled={pending || !draft.trim()}
          onClick={() => {
            onSave(draft.trim())
            setDraft('')
            setRevealed(false)
          }}
        >
          Save
        </button>
        {hasKey && (
          <button
            type="button"
            className="button button-small button-danger"
            disabled={pending}
            onClick={() => onSave(null)}
          >
            Remove
          </button>
        )}
      </span>
    </div>
  )
}

/** A small padlock, for the "no key here" state. */
function Lock({ size = 12 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="4" y="10" width="16" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
  )
}
