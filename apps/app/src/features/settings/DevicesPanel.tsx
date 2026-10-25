import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { formatRelative, plural, type Device, DeviceNameSchema } from '@selfmp3/shared'
import {
  clientApi,
  deviceGroups,
  heardAt,
  queryKeys,
  radius,
  STALE,
  type,
  useDevices,
  type Api,
  iconSize,
  space,
} from '@selfmp3/client'
import { apiFor } from '../../api/client'
import { useConnection } from '../../connection/ConnectionProvider'
import { Button } from '../../ui/components/Button'
import { IconButton } from '../../ui/components/IconButton'
import { Trash } from '../../ui/components/Icons'
import { showFailure } from '../../ui/toast'
import { useDeviceContext } from '../devices/DevicesProvider'
import {
  knownAsDevices,
  LAST_KNOWN_DEVICES_KEY,
  parseKnownDevices,
  serializeKnownDevices,
} from '../devices/lastKnownDevices.model'
import { useServerDirect } from '../../connection/useServerDirect'
import { prefs } from '../../ports/prefs'
import { TextField } from '../../ui/components/TextField'
import { Panel, partStyles, Row } from './SettingsParts'
import { splitDevices } from './settings.model'
import { reachedConnection } from '../../connection/via'

/** Whether the device list came from a server just now, is being looked for, or cannot be had. */
type DevicesReach = 'reachable' | 'looking' | 'away'

/**
 * Settings › Devices, on every device and for either kind of library.
 *
 * The list is the server's. A device talking to the server asks it; a cloud
 * library finds the server the way Import does (`useServerDirect`) and asks it
 * directly. With no server in reach it shows the last list it was given, each
 * row marked offline, and says so in one line — there is nothing to press,
 * since the page keeps looking by itself.
 */
export function DevicesPanel({ anchor }: { anchor: (node: View | null) => void }): ReactNode {
  const { fromCloud } = useConnection()
  return fromCloud ? <CloudDevices anchor={anchor} /> : <ServerDevices anchor={anchor} />
}

/** A server library: the list the devices provider keeps, from the same query. */
function ServerDevices({ anchor }: { anchor: (node: View | null) => void }): ReactNode {
  const { devices, connected } = useDeviceContext()
  const client = useQueryClient()
  const query = useDevices(connected)
  const reach: DevicesReach = query.isError ? 'away' : query.data ? 'reachable' : 'looking'

  const forget = (ids: readonly string[]): void => {
    void forgetEach(clientApi(), ids).then(() =>
      client.invalidateQueries({ queryKey: queryKeys.devices }),
    )
  }

  return <DevicesList anchor={anchor} reach={reach} devices={devices} onForget={forget} />
}

/** A cloud library: the server found by its addresses, and asked directly. */
function CloudDevices({ anchor }: { anchor: (node: View | null) => void }): ReactNode {
  const server = useServerDirect()
  const client = useQueryClient()
  const connection = reachedConnection(server) ?? null
  const key = queryKeys.devicesThrough(connection?.baseUrl ?? null)
  const list = useQuery({
    queryKey: key,
    queryFn: () => {
      if (!connection) throw new Error('no server in reach')
      return apiFor(connection).devices()
    },
    enabled: connection !== null,
    retry: false,
    staleTime: STALE.tenSeconds,
  })
  const reach: DevicesReach =
    connection === null
      ? server.state === 'looking'
        ? 'looking'
        : 'away'
      : list.isError
        ? 'away'
        : list.data
          ? 'reachable'
          : 'looking'

  const forget = (ids: readonly string[]): void => {
    if (!connection) return
    void forgetEach(apiFor(connection), ids).then(() => client.invalidateQueries({ queryKey: key }))
  }

  return (
    <DevicesList
      anchor={anchor}
      reach={reach}
      devices={list.data?.devices ?? []}
      onForget={forget}
    />
  )
}

/**
 * Forgets each device, all of them tried even when one is refused, and says
 * so when any was: Remove is pressed, and a row that stays put is no answer.
 */
async function forgetEach(api: Pick<Api, 'forgetDevice'>, ids: readonly string[]): Promise<void> {
  const results = await Promise.allSettled(ids.map(id => api.forgetDevice(id)))
  const refused = results.find(result => result.status === 'rejected')
  if (refused) {
    const what = ids.length > 1 ? 'Couldn’t remove them all' : 'Couldn’t remove that device'
    showFailure(what, refused.reason)
  }
}

/** The panel itself, whichever way its list arrived. */
function DevicesList({
  anchor,
  reach,
  devices,
  onForget,
}: {
  anchor: (node: View | null) => void
  reach: DevicesReach
  devices: readonly Device[]
  onForget: (ids: readonly string[]) => void
}): ReactNode {
  const { deviceId, name, rename, heard } = useDeviceContext()
  const [draft, setDraft] = useState<{ text: string; from: string } | null>(null)
  const shown = draft && draft.from === name ? draft.text : name
  const live = reach === 'reachable'

  // The last real answer, kept for the day there is none. Read once, as the
  // panel opens: the rows it draws do not change under the reader.
  const [known] = useState(() => parseKnownDevices(prefs.get(LAST_KNOWN_DEVICES_KEY)))
  // Last seen as the server stamped it, laid onto this device's clock, so "ago"
  // and the week below are right however far apart the two clocks are, and
  // what is kept for a day with no server is in this device's time already.
  const here = useMemo(
    () =>
      heard
        ? devices.map(device => ({ ...device, lastSeenAt: heardAt(device.lastSeenAt, heard) }))
        : devices,
    [devices, heard],
  )
  useEffect(() => {
    if (live && here.length > 0) {
      prefs.set(LAST_KNOWN_DEVICES_KEY, serializeKnownDevices(here, Date.now()))
    }
  }, [live, here])
  const listed = useMemo(
    () => (live ? here : knownAsDevices(known?.devices ?? [])),
    [live, here, known],
  )

  // This device, what is online and what was seen in the last week, a row
  // each; every stale session (a name's older copies among them) is one row.
  const [now] = useState(Date.now)
  const { recent: rows, olderIds } = useMemo(
    () => splitDevices(deviceGroups(listed, deviceId), deviceId, now),
    [listed, deviceId, now],
  )
  // A browser registers itself afresh whenever its storage is cleared, which
  // is where nearly all of these come from.
  const olderKinds = new Set(
    listed.filter(device => olderIds.includes(device.id)).map(device => device.kind),
  )
  const session = olderKinds.size === 1 && olderKinds.has('other') ? 'browser session' : 'session'
  const olderLine = plural(olderIds.length, `older ${session}`, `older ${session}s`)

  return (
    <Panel title="Devices" anchor={anchor}>
      <Row label="This device’s name" stack>
        <TextField
          size="small"
          style={partStyles.field}
          value={shown}
          limit={DeviceNameSchema}
          accessibilityLabel="This device’s name"
          onChangeText={text => setDraft({ text, from: name })}
          onEndEditing={() => {
            if (draft && draft.text.trim() && draft.text !== name) rename(draft.text.trim())
            setDraft(null)
          }}
        />
      </Row>
      <View style={styles.devices}>
        {rows.map(({ device, ids }) => (
          <View key={device.id} style={styles.device}>
            <View style={[styles.dot, live && device.online && styles.dotOnline]} />
            <View style={styles.deviceName}>
              <Text style={styles.deviceText} numberOfLines={1}>
                {device.name}
              </Text>
              {device.id === deviceId ? (
                <Text style={styles.deviceTag} numberOfLines={1}>
                  this device
                </Text>
              ) : null}
            </View>
            <Text style={styles.deviceWhen} numberOfLines={1}>
              {!live
                ? `offline · last seen ${formatRelative(device.lastSeenAt)}`
                : device.online
                  ? 'online'
                  : `last seen ${formatRelative(device.lastSeenAt)}`}
            </Text>
            {/* Forgetting is the server's to do, so only while it answers. */}
            {live ? (
              <IconButton onPress={() => onForget(ids)} label={`Remove ${device.name}`} size={28}>
                <Trash size={iconSize.field} tone="textMuted" />
              </IconButton>
            ) : null}
          </View>
        ))}
        {live && devices.length === 0 ? (
          <Text style={partStyles.hint}>No devices registered yet.</Text>
        ) : null}
        {!live ? (
          <Text style={[partStyles.hint, rows.length > 0 && styles.devicesNote]}>
            {listed.length === 0
              ? 'Devices show up when this device can reach your library’s computer.'
              : reach === 'looking'
                ? 'Looking for your library’s computer — showing the last list.'
                : 'Can’t reach your library’s computer — showing the last list.'}
          </Text>
        ) : null}
        {olderIds.length > 0 ? (
          <View style={styles.device} testID="settings-older-devices">
            <View style={styles.dot} />
            <Text style={[styles.deviceText, styles.olderText]} numberOfLines={1}>
              {olderLine}
            </Text>
            {live ? <Button label="Remove all" onPress={() => onForget(olderIds)} /> : null}
          </View>
        ) : null}
      </View>
    </Panel>
  )
}

const styles = StyleSheet.create(theme => ({
  devices: { marginTop: space.tight },
  device: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.snug,
    paddingVertical: 9,
  },
  devicesNote: { paddingTop: space.snug },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: theme.colors.borderStrong },
  dotOnline: { backgroundColor: theme.colors.good },
  // On a narrow phone the name keeps a readable width and "last seen …" gives
  // way first; the tags never break, where they read "× / 3 / 2" a glyph a line.
  deviceName: { flex: 1, minWidth: 120, flexDirection: 'row', alignItems: 'center', gap: 7 },
  deviceText: { color: theme.colors.textPrimary, fontSize: type.sub, flexShrink: 1 },
  deviceTag: {
    flexShrink: 0,
    color: theme.colors.textMuted,
    fontSize: type.tiny,
    paddingHorizontal: space.tight,
    paddingVertical: 1,
    borderRadius: radius.pill,
    backgroundColor: theme.colors.surface3,
    overflow: 'hidden',
  },
  deviceWhen: { flexShrink: 1, color: theme.colors.textMuted, fontSize: type.small },
  olderText: { flex: 1, color: theme.colors.textSecondary },
}))
