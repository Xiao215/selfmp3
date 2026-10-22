import { useCallback, useMemo } from 'react'
import type { ReactNode } from 'react'
import { View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Tag } from '@selfmp3/shared'
import { clientApi, queryKeys, STALE, space, useLibrary } from '@selfmp3/client'
import { useConnection } from '../../connection/ConnectionProvider'
import { ServerAway } from '../../connection/ServerAway'
import { useServerApi, type ServerApi } from '../../connection/useServerApi'
import { noServer, viaKey } from '../../connection/via'
import { copyText } from '../../ports/clipboard'
import { showToast } from '../../ui/toast'
import { Button } from '../../ui/components/Button'
import { Copy } from '../../ui/components/Icons'
import { Select } from '../../ui/components/Select'
import { TagChooser } from '../../ui/components/TagChooser'
import { Toggle } from '../../ui/components/Toggle'
import { Panel, Row, SettingsWaiting } from './SettingsParts'
import { addressForElsewhere, serverTokenHint } from './settings.model'
import { useServerSettings } from './useServerSettings'

/**
 * Settings › Advanced › Importing: how the library's server imports, so read
 * from and written to that server — reached directly from a cloud library, the
 * way Import is, and said to be away when it is. Under them, the server's
 * address and token for an import sent from outside the app.
 */
export function ImportingPanel({ anchor }: { anchor: (node: View | null) => void }): ReactNode {
  const server = useServerApi()
  const { settings, failed, retry, set } = useServerSettings(server.api)
  const named = useNamedServer()
  return (
    <Panel title="Importing" hint="on your library’s computer" anchor={anchor}>
      {server.reach.state !== 'reachable' ? (
        <ServerAway
          reach={server.reach}
          need="settings"
          row
          last={named === null}
          testID="importing-server"
        />
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
          <Row
            label="Watch the library folder"
            hint="Picks up files the moment they change."
            last={named === null}
          >
            <Toggle
              value={settings.watchLibrary}
              onChange={value => set('watchLibrary', value)}
              label="Watch the library folder"
            />
          </Row>
        </>
      ) : (
        <SettingsWaiting failed={failed} onRetry={retry} last={named === null} />
      )}
      {named ? <TokenRow server={named} /> : null}
    </Panel>
  )
}

/**
 * The server this cloud library's snapshot names, with its token: null on a
 * device that talks to a server itself, or before a snapshot names one. The
 * same question `useServerDirect` asks, under the same key, so it is one read
 * of this device's copy.
 */
function useNamedServer(): { addresses: readonly string[]; token: string } | null {
  const { fromCloud } = useConnection()
  const said = useQuery({
    queryKey: queryKeys.cloudServer,
    queryFn: () => clientApi().cloudServer(),
    enabled: fromCloud,
  }).data?.server
  const token = said?.token ?? null
  const addresses = said?.addresses
  return useMemo(
    () => (token !== null && addresses ? { addresses, token } : null),
    [token, addresses],
  )
}

/**
 * What something that is not one of this library's devices needs to reach
 * its server: the iOS Shortcut, and the extension given an address by hand
 * (docs/features/share-to-import.md, browser-extension.md). The devices are
 * handed the token in the bucket; those are not, so it is copied from here.
 * It goes only to the clipboard: the row shows its last few characters.
 * The address is shown whole and can be copied too, more quietly: typing a
 * long ts.net address on a phone is where a Shortcut goes wrong. Offered only
 * when there is one worth giving out (`addressForElsewhere`).
 * Drawn whether or not the server answers just now, since copying either
 * needs nothing from the server.
 */
function TokenRow({
  server,
}: {
  server: { addresses: readonly string[]; token: string }
}): ReactNode {
  const address = addressForElsewhere(server.addresses)
  return (
    <Row label="Shortcut and extension" hint={serverTokenHint(server.addresses, server.token)} last>
      <Button
        label="Copy token"
        icon={<Copy tone="textPrimary" />}
        onPress={() => copy(server.token, 'token')}
        testID="importing-copy-token"
      />
      {address ? (
        <Button
          label="Copy address"
          variant="text"
          onPress={() => copy(address, 'address')}
          testID="importing-copy-address"
        />
      ) : null}
    </Row>
  )
}

/** To the clipboard, saying so either way. */
function copy(text: string, what: 'token' | 'address'): void {
  void copyText(text).then(done => {
    if (done) showToast(what === 'token' ? 'Token copied' : 'Address copied', 'good')
    else showToast(`Couldn’t copy the ${what}`, 'error')
  })
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
