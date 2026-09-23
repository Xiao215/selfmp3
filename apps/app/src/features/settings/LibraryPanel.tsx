import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { useQueryClient } from '@tanstack/react-query'
import { type Song } from '@selfmp3/shared'
import {
  queryKeys,
  useAnalysisStatus,
  useScanLibrary,
  useStartAnalysis,
  useFixCovers,
  useFixCoversStatus,
  useLibrary,
} from '@selfmp3/client'
import { Button } from '../../ui/components/Button'
import { Refresh, Sparkles, X } from '../../ui/components/Icons'
import { Lead, Notice, Panel, partStyles, Row } from './SettingsParts'
import { scanHint, type Confirming } from './settings.model'
import {
  coverArtHint,
  coverProgress,
  coverResult,
  missingArtCount,
} from '../metadata/metadata.model'

export function LibraryPanel({
  libraryPath,
  anchor,
  onConfirm,
}: {
  libraryPath: string | undefined
  anchor: (node: View | null) => void
  onConfirm: (what: Confirming) => void
}): ReactNode {
  const library = useLibrary()
  const scan = useScanLibrary()
  const analysis = useAnalysisStatus(true)
  const startAnalysis = useStartAnalysis()
  const songs = library.data?.songs ?? []
  const analysed = songs.filter(song => song.audioFeatures !== null).length
  const running = analysis.data?.running === true

  return (
    <Panel title="Library" hint={`${songs.length} songs`} anchor={anchor}>
      {libraryPath !== undefined ? (
        <Lead>
          Your music lives at <Text style={partStyles.code}>{libraryPath}</Text>. It is just a
          folder of files — copy it anywhere and you have a complete backup.
        </Lead>
      ) : null}
      <Row label="Rescan the folder" hint={scanHint(scan.data)}>
        <Button
          label={scan.isPending ? 'Scanning…' : 'Rescan'}
          icon={<Refresh size={15} tone="textPrimary" />}
          disabled={scan.isPending}
          onPress={() => scan.mutate()}
        />
      </Row>
      <Row
        label="Audio analysis"
        hint={`Works out each song’s tempo, key, energy and loudness from the file itself, on your server. It powers smart-playlist rules, “similar songs” and auto-mix. ${analysed} of ${songs.length} songs analysed.`}
      >
        <Button
          label={running ? 'Analysing…' : 'Analyse new songs'}
          icon={<Sparkles size={15} tone="textPrimary" />}
          disabled={running || startAnalysis.isPending}
          onPress={() => startAnalysis.mutate(false)}
        />
        {analysed > 0 && !running ? (
          <Button
            label="Redo all"
            icon={<Refresh size={15} tone="textPrimary" />}
            onPress={() => onConfirm('redo-analysis')}
          />
        ) : null}
      </Row>
      {running ? (
        <View style={partStyles.progress} accessibilityLiveRegion="polite">
          <Text style={partStyles.progressText}>
            Analysing{analysis.data?.current ? ` — ${analysis.data.current.title}` : '…'}
            {analysis.data && analysis.data.pending > 0 ? ` · ${analysis.data.pending} to go` : ''}
          </Text>
        </View>
      ) : null}
      <CoverArtRow songs={songs} last />
    </Panel>
  )
}

/**
 * "Find missing cover art". The pass runs on the server; this starts, stops
 * and watches it, so leaving Settings interrupts nothing. Covers land one at a
 * time, so the library is refetched as they do.
 */
function CoverArtRow({ songs, last }: { songs: readonly Song[]; last: boolean }): ReactNode {
  const client = useQueryClient()
  const { data: status } = useFixCoversStatus()
  const fixCovers = useFixCovers()
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
            icon={<X size={15} tone="textPrimary" />}
            disabled={fixCovers.isPending}
            onPress={() => fixCovers.mutate('cancel')}
          />
        ) : (
          <Button
            label="Find missing art"
            icon={<Sparkles size={15} tone="textPrimary" />}
            disabled={fixCovers.isPending || missingArt === 0}
            onPress={() => fixCovers.mutate('start')}
          />
        )}
      </Row>
      {status && running ? (
        <View style={partStyles.progress} accessibilityLiveRegion="polite">
          <Text style={partStyles.progressText}>{coverProgress(status)}</Text>
        </View>
      ) : null}
      {result ? <Notice tone="good">{result}</Notice> : null}
    </>
  )
}
