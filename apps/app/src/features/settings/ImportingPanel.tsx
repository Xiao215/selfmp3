import { useCallback, useMemo } from 'react'
import type { ReactNode } from 'react'
import { View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Tag } from '@selfmp3/shared'
import { STALE, space, useLibrary } from '@selfmp3/client'
import { useConnection } from '../../connection/ConnectionProvider'
import { ServerAway } from '../../connection/ServerAway'
import { useServerApi, type ServerApi } from '../../connection/useServerApi'
import { noServer, viaKey } from '../../connection/via'
import { Select } from '../../ui/components/Select'
import { TagChooser } from '../../ui/components/TagChooser'
import { Toggle } from '../../ui/components/Toggle'
import { Panel, Row } from './SettingsParts'
import { useServerSettings } from './useServerSettings'

/**
 * Settings › Advanced › Importing: how the library's server imports, so read
 * from and written to that server — reached directly from a cloud library, the
 * way Import is, and said to be away when it is.
 */
export function ImportingPanel({ anchor }: { anchor: (node: View | null) => void }): ReactNode {
  const server = useServerApi()
  const { settings, set } = useServerSettings(server.api)
  return (
    <Panel title="Importing" hint="on your library’s computer" anchor={anchor}>
      {server.reach.state !== 'reachable' ? (
        <ServerAway reach={server.reach} need="settings" row testID="importing-server" />
      ) : settings ? (
        <>
          <Row label="Downloads at once" hint="Two is a good default.">
            <Select<number>
              value={settings.importConcurrency}
              onChange={value => set('importConcurrency', value)}
              options={[1, 2, 3, 4].map(value => ({ value, label: String(value) }))}
              label="Downloads at once"
            />
          </Row>
          <Row
            label="Look up lyrics automatically"
            hint="Fetches timed lyrics when a song is imported."
          >
            <Toggle
              value={settings.autoFetchLyrics}
              onChange={value => set('autoFetchLyrics', value)}
              label="Look up lyrics automatically"
            />
          </Row>
          <Row label="Tags for every import" hint="Added on top of the ones you pick." />
          <View style={styles.tags} testID="importing-default-tags">
            <DefaultTags
              server={server}
              selected={settings.defaultImportTagIds}
              onChange={ids => set('defaultImportTagIds', ids)}
            />
          </View>
          <Row label="Watch the library folder" hint="Picks up files the moment they change." last>
            <Toggle
              value={settings.watchLibrary}
              onChange={value => set('watchLibrary', value)}
              label="Watch the library folder"
            />
          </Row>
        </>
      ) : null}
    </Panel>
  )
}

/**
 * The tags every import gets (`defaultImportTagIds`), chosen with the picker an
 * import's own tags use. They are the server's tag ids, so a cloud library
 * offers the server's tags and makes a new one there, as Import does
 * (importSource.ts, under the same key); a device talking to its server has
 * them as its own.
 */
function DefaultTags({
  server,
  selected,
  onChange,
}: {
  server: ServerApi
  selected: readonly number[]
  onChange: (ids: number[]) => void
}): ReactNode {
  const { fromCloud } = useConnection()
  const queryClient = useQueryClient()
  const { api } = server
  const baseUrl = server.via?.baseUrl
  const libraryKey = useMemo(() => viaKey(baseUrl, 'library'), [baseUrl])
  const theirs = useQuery({
    queryKey: libraryKey,
    queryFn: () => (api ? api.library() : noServer()),
    enabled: fromCloud && api !== null,
    staleTime: STALE.halfMinute,
  })
  const own = useLibrary()
  const create = useCallback(
    async (name: string): Promise<Tag> => {
      if (!api) return noServer()
      const tag = await api.createTag({ name })
      await queryClient.invalidateQueries({ queryKey: libraryKey })
      return tag
    },
    [api, queryClient, libraryKey],
  )
  const tags = (fromCloud ? theirs.data?.tags : own.data?.tags) ?? []
  const from = useMemo(
    () => (fromCloud ? { tags: theirs.data?.tags ?? [], create } : undefined),
    [fromCloud, theirs.data?.tags, create],
  )
  const chosen = useMemo(() => new Set(selected), [selected])
  return (
    <TagChooser
      tags={tags}
      selected={chosen}
      onChange={next => onChange([...next])}
      from={from}
      title="Tag every import"
    />
  )
}

const styles = StyleSheet.create(() => ({
  tags: { paddingBottom: space.sm },
}))
