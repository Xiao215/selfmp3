import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { plural, type Song } from '@selfmp3/shared'
import {
  STALE,
  queryKeys,
  useAnalysisStatus,
  useScanLibrary,
  useStartAnalysis,
  useFixCovers,
  useFixCoversStatus,
  useLibrary,
  type Api,
} from '@selfmp3/client'
import { ServerAway } from '../../connection/ServerAway'
import { useServerApi } from '../../connection/useServerApi'
import { viaKey } from '../../connection/via'
import { Button } from '../../ui/components/Button'
import { Refresh, Sparkles, X } from '../../ui/components/Icons'
import { Panel, partStyles, Row } from './SettingsParts'
import { NoticeCard } from '../../ui/components/NoticeCard'
import { analysisProgress, scanHint, soundHint, type Confirming } from './settings.model'
import {
  coverArtHint,
  coverProgress,
  coverResult,
  missingArtCount,
} from '../metadata/metadata.model'

/**
 * Settings › Advanced › Library: the library's folder on its server — the
 * inbox an import lands in, and where a file dropped by hand is picked up —
 * and the passes the server runs over the songs. All of it is the server's, so
 * a cloud library reaches the server for it, as Import does, and says so when
 * it cannot.
 */
export function LibraryPanel({
  anchor,
  onConfirm,
}: {
  anchor: (node: View | null) => void
  onConfirm: (what: Confirming) => void
}): ReactNode {
  const server = useServerApi()
  const library = useLibrary()
  const songs = library.data?.songs ?? []
  return (
    <Panel title="Library" anchor={anchor}>
      {server.reach.state !== 'reachable' || !server.api ? (
        <ServerAway reach={server.reach} need="settings" row testID="library-server" />
      ) : (
        <LibraryRows
          api={server.api}
          baseUrl={server.via?.baseUrl}
          songs={songs}
          onConfirm={onConfirm}
        />
      )}
    </Panel>
  )
}

function LibraryRows({
  api,
  baseUrl,
  songs,
  onConfirm,
}: {
  api: Api
  baseUrl: string | undefined
  songs: readonly Song[]
  onConfirm: (what: Confirming) => void
}): ReactNode {
  // The server's own health, for where its folder is: this device's says
  // nothing of it from a cloud library.
  const health = useQuery({
    queryKey: viaKey(baseUrl, 'health'),
    queryFn: () => api.health(),
    staleTime: STALE.minute,
    retry: false,
  })
  const libraryPath = health.data?.libraryPath
  const scan = useScanLibrary(api)
  const analysis = useAnalysisStatus(api, baseUrl ?? null)
  const startAnalysis = useStartAnalysis(api, baseUrl ?? null)
  const analysed = songs.filter(song => song.audioFeatures !== null).length
  const running = analysis.data?.running === true

  return (
    <>
      {libraryPath !== undefined ? <Row label="Folder" hint={libraryPath} /> : null}
      <Row label="Rescan the folder" hint={scanHint(scan.data)}>
        <Button
          label={scan.isPending ? 'Scanning…' : 'Rescan'}
          icon={<Refresh tone="textPrimary" />}
          disabled={scan.isPending}
          onPress={() => scan.mutate()}
        />
      </Row>
      <Row
        label="Audio analysis"
        hint={`Tempo, key and energy · ${analysed} of ${plural(songs.length, 'song', 'songs')}`}
      >
        <Button
          label={running ? 'Analysing…' : 'Analyse new songs'}
          icon={<Sparkles tone="textPrimary" />}
          disabled={running || startAnalysis.isPending}
          onPress={() => startAnalysis.mutate(false)}
        />
        {analysed > 0 && !running ? (
          <Button
            label="Redo all"
            icon={<Refresh tone="textPrimary" />}
            onPress={() => onConfirm('redo-analysis')}
          />
        ) : null}
      </Row>
      {analysis.data ? (
        <Row label="How songs sound" hint={soundHint(analysis.data.sound, songs.length)} />
      ) : null}
      {running ? (
        <View style={partStyles.progress} accessibilityLiveRegion="polite">
          <Text style={partStyles.progressText}>{analysisProgress(analysis.data)}</Text>
        </View>
      ) : null}
      <CoverArtRow api={api} baseUrl={baseUrl} songs={songs} last />
    </>
  )
}

/**
 * "Find missing cover art". The pass runs on the server; this starts, stops
 * and watches it, so leaving Settings interrupts nothing. Covers land one at a
 * time, so the library is refetched as they do.
 */
function CoverArtRow({
  api,
  baseUrl,
  songs,
  last,
}: {
  api: Api
  baseUrl: string | undefined
  songs: readonly Song[]
  last: boolean
}): ReactNode {
  const client = useQueryClient()
  const { data: status } = useFixCoversStatus(api, baseUrl ?? null)
  const fixCovers = useFixCovers(api, baseUrl ?? null)
  const missingArt = missingArtCount(songs)
  const running = status?.status === 'running'
  const result = status ? coverResult(status) : null

  const found = status?.found ?? 0
  const state = status?.status
  useEffect(() => {
    if (found > 0 || state === 'done' || state === 'cancelled') {
      void client.invalidateQueries({ queryKey: queryKeys.library })
    }
  }, [client, found, state])

  return (
    <>
      <Row
        label="Cover art"
        hint={coverArtHint(missingArt)}
        last={last && !running && result === null}
      >
        {running ? (
          <Button
            label="Stop looking"
            icon={<X tone="textPrimary" />}
            disabled={fixCovers.isPending}
            onPress={() => fixCovers.mutate('cancel')}
          />
        ) : missingArt > 0 ? (
          // Only once a song has no artwork: a greyed button beside "Every song
          // has artwork" offered nothing.
          <Button
            label="Find missing art"
            icon={<Sparkles tone="textPrimary" />}
            disabled={fixCovers.isPending}
            onPress={() => fixCovers.mutate('start')}
          />
        ) : null}
      </Row>
      {status && running ? (
        <View style={partStyles.progress} accessibilityLiveRegion="polite">
          <Text style={partStyles.progressText}>{coverProgress(status)}</Text>
        </View>
      ) : null}
      {result ? (
        <NoticeCard wash style={partStyles.notice} tone="good">
          {result}
        </NoticeCard>
      ) : null}
    </>
  )
}
