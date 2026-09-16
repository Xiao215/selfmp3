import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Text, TextInput, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { type Device } from '@selfmp3/shared'
import { clientApi, deviceListView, queryKeys, relativeTime, useDevices } from '@selfmp3/client'
import { apiFor } from '../../api/client'
import { useConnection } from '../../connection/ConnectionProvider'
import { Button } from '../../ui/components/Button'
import { IconButton } from '../../ui/components/IconButton'
import { Trash } from '../../ui/components/Icons'
import { useDeviceContext } from '../devices/DevicesProvider'
import {
  knownAsDevices,
  LAST_KNOWN_DEVICES_KEY,
  parseKnownDevices,
  serializeKnownDevices,
} from '../devices/lastKnownDevices.model'
import { useServerDirect } from '../../connection/useServerDirect'
import { prefs } from '../../ports/prefs'
import { Lead, Panel, partStyles, Row } from './SettingsParts'
import { splitDevices } from './settings.model'

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
    void Promise.all(
      ids.map(id =>
        clientApi()
          .forgetDevice(id)
          .catch(() => undefined),
      ),
    ).then(() => client.invalidateQueries({ queryKey: queryKeys.devices }))
  }

  return (
    <DevicesList
      anchor={anchor}
      hint={reach === 'reachable' ? (connected ? 'live updates' : 'polling') : undefined}
      reach={reach}
      devices={devices}
      onForget={forget}
    />
  )
}

/** A cloud library: the server found by its addresses, and asked directly. */
function CloudDevices({ anchor }: { anchor: (node: View | null) => void }): ReactNode {
  const server = useServerDirect()
  const client = useQueryClient()
  const connection = server.state === 'reachable' ? server.connection : null
  const key = [...queryKeys.devices, 'through', connection?.baseUrl ?? null] as const
  const list = useQuery({
    queryKey: key,
    queryFn: () => {
      if (!connection) throw new Error('no server in reach')
      return apiFor(connection).devices()
    },
    enabled: connection !== null,
    retry: false,
    staleTime: 10_000,
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
    void Promise.all(
      ids.map(id =>
        apiFor(connection)
          .forgetDevice(id)
          .catch(() => undefined),
      ),
    ).then(() => client.invalidateQueries({ queryKey: key }))
  }

  return (
    <DevicesList
      anchor={anchor}
      hint={reach === 'reachable' ? 'through your server' : undefined}
      reach={reach}
      devices={list.data?.devices ?? []}
      onForget={forget}
    />
  )
}

/** The panel itself, whichever way its list arrived. */
function DevicesList({
  anchor,
  hint,
  reach,
  devices,
  onForget,
}: {
  anchor: (node: View | null) => void
  hint: string | undefined
  reach: DevicesReach
  devices: readonly Device[]
  onForget: (ids: readonly string[]) => void
}): ReactNode {
  const { theme } = useUnistyles()
  const { deviceId, name, rename } = useDeviceContext()
  const [draft, setDraft] = useState<{ text: string; from: string } | null>(null)
  const [showOlder, setShowOlder] = useState(false)
  const shown = draft && draft.from === name ? draft.text : name
  const live = reach === 'reachable'

  // The last real answer, kept for the day there is none. Read once, as the
  // panel opens: the rows it draws do not change under the reader.
  const [known] = useState(() => parseKnownDevices(prefs.get(LAST_KNOWN_DEVICES_KEY)))
  useEffect(() => {
    if (live && devices.length > 0) {
      prefs.set(LAST_KNOWN_DEVICES_KEY, serializeKnownDevices(devices, Date.now()))
    }
  }, [live, devices])
  const listed = useMemo(
    () => (live ? devices : knownAsDevices(known?.devices ?? [])),
    [live, devices, known],
  )

  // Offline devices that share a name folded into one row; this device, what
  // is online and what was seen in the last week first; the rest behind a button.
  const [now] = useState(Date.now)
  const view = useMemo(() => {
    const folded = deviceListView(listed, deviceId, now)
    return splitDevices([...folded.recent, ...folded.older], deviceId, now)
  }, [listed, deviceId, now])
  const rows = showOlder ? [...view.recent, ...view.older] : view.recent
  const olderIds = view.older.flatMap(row => row.ids)

  return (
    <Panel title="Devices" hint={hint} anchor={anchor}>
      <Lead>
        Every device you open self.mp3 on shows up here and can hand playback to any of the others.
        Nothing is stored beyond a name and what was last playing.
      </Lead>
      <Row label="This device’s name" hint="Shown on your other devices when handing off.">
        <TextInput
          style={partStyles.input}
          value={shown}
          maxLength={60}
          accessibilityLabel="This device’s name"
          onChangeText={text => setDraft({ text, from: name })}
          onEndEditing={() => {
            if (draft && draft.text.trim() && draft.text !== name) rename(draft.text.trim())
            setDraft(null)
          }}
        />
      </Row>
      <View style={styles.devices}>
        {rows.map(({ device, ids }, position) => (
          <View
            key={device.id}
            style={[styles.device, position === rows.length - 1 && styles.deviceLast]}
          >
            <View
              style={[styles.dot, live && device.online && { backgroundColor: theme.colors.good }]}
            />
            <View style={styles.deviceName}>
              <Text style={styles.deviceText} numberOfLines={1}>
                {device.name}
              </Text>
              {device.id === deviceId ? <Text style={styles.deviceTag}>this device</Text> : null}
              {ids.length > 1 ? <Text style={styles.deviceTag}>{`×${ids.length}`}</Text> : null}
            </View>
            <Text style={styles.deviceWhen}>
              {!live
                ? `offline · last seen ${relativeTime(device.lastSeenAt)}`
                : device.online
                  ? 'online'
                  : `last seen ${relativeTime(device.lastSeenAt)}`}
            </Text>
            {/* Forgetting is the server's to do, so only while it answers. */}
            {live ? (
              <IconButton
                onPress={() => onForget(ids)}
                label={
                  ids.length > 1 ? `Forget ${device.name} (${ids.length})` : `Forget ${device.name}`
                }
                size={28}
              >
                <Trash size={14} color={theme.colors.textMuted} />
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
              ? 'Devices show up when this device can reach your server.'
              : reach === 'looking'
                ? 'Looking for your server — showing the last list.'
                : 'Can’t reach your server — showing the last list.'}
          </Text>
        ) : null}
        {view.older.length > 0 ? (
          <View style={styles.devicesMore}>
            <Button
              label={showOlder ? 'Show fewer' : `Show ${view.older.length} older`}
              onPress={() => setShowOlder(open => !open)}
            />
            {live ? <Button label="Forget all older" onPress={() => onForget(olderIds)} /> : null}
          </View>
        ) : null}
      </View>
    </Panel>
  )
}

// -------------------------------------------------------------- shortcuts

const styles = StyleSheet.create(theme => ({
  devices: { marginTop: 6 },
  device: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  deviceLast: { borderBottomWidth: 0 },
  devicesMore: { paddingTop: 10, flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  devicesNote: { paddingTop: 10 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: theme.colors.borderStrong },
  deviceName: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 7 },
  deviceText: { color: theme.colors.textPrimary, fontSize: 13, flexShrink: 1 },
  deviceTag: {
    color: theme.colors.textMuted,
    fontSize: 10,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 999,
    backgroundColor: theme.colors.surface3,
    overflow: 'hidden',
  },
  deviceWhen: { color: theme.colors.textMuted, fontSize: 12 },
}))
