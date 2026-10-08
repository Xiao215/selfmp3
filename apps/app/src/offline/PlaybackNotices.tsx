import type { ReactNode } from 'react'
import { plural, formatBytes } from '@selfmp3/shared'
import { LARGE_SYNC_BYTES, useLibrary } from '@selfmp3/client'
import { ConfirmDialog } from '../ui/components/ConfirmDialog'
import { useDownloads, type DownloadQuestion } from './DownloadsProvider'
import { devicePlace } from '../features/settings/settings.model'
import { deviceKind } from '../ports/device'

/**
 * The questions downloading and streaming put to the person, in words.
 *
 * Mounted once, in the shell, so a song tapped anywhere that cannot play says
 * why rather than loading and sitting paused, and a download that would use
 * mobile data or a lot of space asks first.
 */
export function PlaybackNotices(): ReactNode {
  const { question, answer } = useDownloads()
  const library = useLibrary()
  if (!question) return null

  const title =
    question.kind === 'play'
      ? (library.data?.songs.find(song => song.id === question.songId)?.title ?? 'This song')
      : ''
  const words = wordsFor(question, title)

  return (
    <ConfirmDialog
      open
      title={words.title}
      body={words.body}
      confirmLabel={words.confirm}
      cancelLabel={words.cancel}
      onConfirm={() => answer(true)}
      onCancel={() => answer(false)}
    />
  )
}

function wordsFor(
  question: DownloadQuestion,
  title: string,
): { title: string; body: string; confirm: string; cancel: string | null } {
  if (question.kind === 'download') {
    const count = question.songIds.length
    const songs = `${plural(count, 'song', 'songs')}`
    const size = formatBytes(question.bytes)
    switch (question.ask) {
      case 'data':
        return {
          title: 'Download on mobile data?',
          body: `${songs} · ${size}. The answer holds until you’re back on Wi-Fi.`,
          confirm: 'Download',
          cancel: 'Not now',
        }
      case 'large':
        return {
          title: `Download ${size}?`,
          body: `That’s ${songs}. Anything over ${formatBytes(LARGE_SYNC_BYTES)} waits for you to ask, on any connection.`,
          confirm: 'Download',
          cancel: 'Not now',
        }
      case 'data-large':
        return {
          title: `Download ${size} on mobile data?`,
          body: `That’s ${songs}. The mobile data answer holds until you’re back on Wi-Fi.`,
          confirm: 'Download',
          cancel: 'Not now',
        }
    }
  }

  const place = devicePlace(deviceKind())
  const quoted = `“${title}” isn’t on this ${place}`
  switch (question.block) {
    case 'data':
      return {
        title: 'Stream on mobile data?',
        body: `${quoted}, so it plays over mobile data. The answer holds until you’re back on Wi-Fi.`,
        confirm: 'Play',
        cancel: 'Not now',
      }
    case 'streaming-off':
      return {
        title: quoted,
        body: `Playing songs that aren’t on this ${place} is off in Settings, so it plays once it’s downloaded.`,
        confirm: 'Download',
        cancel: 'Not now',
      }
    case 'cloud':
      return {
        title: quoted,
        body: `Songs from your storage play once they’re on this ${place}, so it needs downloading first.`,
        confirm: 'Download',
        cancel: 'Not now',
      }
    case 'offline':
      return {
        title: quoted,
        body: `This device is offline, and only songs on this ${place} play without a connection.`,
        confirm: 'OK',
        cancel: null,
      }
  }
}
