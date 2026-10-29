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
  STALE,
  type,
  useDevices,
  space,
} from '@selfmp3/client'
import { apiFor } from '../../api/client'
import { useConnection } from '../../connection/ConnectionProvider'
import { Button } from '../../ui/components/Button'
import { forgetEach } from './forgetDevices'
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
import { Card, partStyles } from './SettingsParts'
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
export function DevicesPanel(): ReactNode {
  const { fromCloud } = useConnection()
  return fromCloud ? <CloudDevices /> : <ServerDevices />
}

/** A server library: the list the devices provider keeps, from the same query. */
function ServerDevices(): ReactNode {
  const { devices, connected } = useDeviceContext()
  const client = useQueryClient()
  const query = useDevices(connected)
  const reach: DevicesReach = query.isError ? 'away' : query.data ? 'reachable' : 'looking'

  const forget = (ids: readonly string[]): void => {
    void forgetEach(clientApi(), ids).then(() =>
      client.invalidateQueries({ queryKey: queryKeys.devices }),
    )
  }

  return <DevicesList reach={reach} devices={devices} onForget={forget} />
}

/** A cloud library: the server found by its addresses, and asked directly. */
function CloudDevices(): ReactNode {
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

  return <DevicesList reach={reach} devices={list.data?.devices ?? []} onForget={forget} />
}

/** The panel itself, whichever way its list arrived. */
function DevicesList({
  reach,
  devices,
  onForget,
}: {
  reach: DevicesReach
  devices: readonly Device[]
  onForget: (ids: readonly string[]) => void
}): ReactNode {
  const { deviceId, name, rename, heard } = useDeviceContext()
  const [draft, setDraft] = useState<{ text: string; from: string } | null>(null)
  const [editing, setEditing] = useState(false)
  const shown = draft && draft.from === name ? draft.text : name
  const save = (): void => {
    if (draft && draft.text.trim() && draft.text.trim() !== name) rename(draft.text.trim())
    setDraft(null)
  }
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
  // is where nearly all of these come from: each was a sign-in once.
  const olderLine = plural(olderIds.length, 'old sign-in', 'old sign-ins')

  const others = rows.filter(row => row.device.id !== deviceId)
  const finish = (): void => {
    save()
    setEditing(false)
  }

  return (
    <Card title="Devices">
      {/*
        This device first, always, whether or not the list has come: its name
        is this device's own to change, as words at the row's end (C1a) that
        turn the name into a field.
      */}
      <View style={styles.device}>
        <View style={[styles.dot, styles.dotOnline]} />
        {editing ? (
          <TextField
            size="small"
            style={styles.nameField}
            value={shown}
            limit={DeviceNameSchema}
            autoFocus
            accessibilityLabel="This device’s name"
            onChangeText={text => setDraft({ text, from: name })}
            // Blur and Return, not `onEndEditing`: a browser's text field never
            // sends that, and a new name typed on a computer was never kept.
            onBlur={finish}
            onSubmitEditing={finish}
          />
        ) : (
          <View style={styles.deviceName}>
            <Text style={styles.deviceText} numberOfLines={1}>
              {name}
            </Text>
            <Text style={styles.deviceWhen} numberOfLines={1}>
              This device
            </Text>
          </View>
        )}
        <Button
          label={editing ? 'Done' : 'Rename'}
          variant="text"
          onPress={editing ? finish : () => setEditing(true)}
          testID="settings-rename-device"
        />
      </View>
      {others.map(({ device, ids }) => (
        <View key={device.id} style={styles.device}>
          <View style={[styles.dot, live && device.online && styles.dotOnline]} />
          <View style={styles.deviceName}>
            <Text style={styles.deviceText} numberOfLines={1}>
              {device.name}
            </Text>
            <Text style={styles.deviceWhen} numberOfLines={1}>
              {!live
                ? `Offline · last seen ${formatRelative(device.lastSeenAt)}`
                : device.online
                  ? 'Online'
                  : `Last seen ${formatRelative(device.lastSeenAt)}`}
            </Text>
          </View>
          {/*
            Forgetting is the server's to do, so only while it answers — and
            never this device, which its next heartbeat would bring back.
          */}
          {live ? (
            <Button
              label="Remove"
              variant="text"
              accessibilityLabel={
                ids.length > 1 ? `Remove ${device.name} (${ids.length})` : `Remove ${device.name}`
              }
              onPress={() => onForget(ids)}
            />
          ) : null}
        </View>
      ))}
      {olderIds.length > 0 ? (
        <View style={styles.device} testID="settings-older-devices">
          <View style={styles.dot} />
          <View style={styles.deviceName}>
            <Text style={[styles.deviceText, styles.olderText]} numberOfLines={1}>
              {olderLine}
            </Text>
          </View>
          {live ? (
            <Button
              label="Clear"
              variant="text"
              accessibilityLabel={`Clear ${olderLine}`}
              onPress={() => onForget(olderIds)}
            />
          ) : null}
        </View>
      ) : null}
      {!live ? (
        <Text style={[partStyles.hint, styles.devicesNote]}>
          {listed.length === 0
            ? 'Other devices show up when this device can reach your library’s computer.'
            : reach === 'looking'
              ? 'Looking for your library’s computer — showing the last list.'
              : 'Can’t reach your library’s computer — showing the last list.'}
        </Text>
      ) : null}
    </Card>
  )
}

const styles = StyleSheet.create(theme => ({
  device: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 56,
    paddingTop: space.sm,
  },
  devicesNote: { paddingTop: space.md },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: theme.colors.borderStrong },
  dotOnline: { backgroundColor: theme.colors.good },
  deviceName: { flex: 1, minWidth: 0, gap: 2 },
  nameField: { flex: 1, minWidth: 0 },
  deviceText: { color: theme.colors.textPrimary, fontSize: type.body },
  deviceWhen: { color: theme.colors.textMuted, fontSize: type.small },
  olderText: { color: theme.colors.textSecondary },
}))
