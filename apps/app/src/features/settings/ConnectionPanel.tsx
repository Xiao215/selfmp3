import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { useLibrary } from '@selfmp3/client'
import { useConnection } from '../../connection/ConnectionProvider'
import { Button } from '../../ui/components/Button'
import { Refresh } from '../../ui/components/Icons'
import { ButtonRow, Details, Panel, partStyles, Row } from './SettingsParts'
import { type Confirming } from './settings.model'

/**
 * Which library this device answers from, and how to leave it.
 *
 * Google sign-in is the only way in on every device: the library is the
 * bucket's, and no server has to be awake or even exist. Connecting to a server
 * by typing its address was the older way, and is gone — the desktop app was
 * the last place it survived. The Import screen still reaches the server
 * directly when it can, and finds it by the addresses in the bucket's own
 * snapshot rather than by anything typed (`packages/client/src/connection/reach.ts`).
 *
 * The address row below is for a development build, where `/onboarding` can
 * still point the app at a server so the simulator flows have a library without
 * a Google account.
 */
export function ConnectionPanel({
  anchor,
  onConfirm,
}: {
  anchor: (node: View | null) => void
  onConfirm: (what: Confirming) => void
}): ReactNode {
  const { connection, fromCloud } = useConnection()
  const library = useLibrary()
  return (
    <Panel title="Connection" hint="on this device" anchor={anchor}>
      {fromCloud ? (
        <Row label="Signed in" hint="With Google — the library is the bucket’s.">
          <Button
            label="Sign out"
            variant="danger"
            onPress={() => onConfirm('sign-out')}
            testID="cloud-sign-out"
          />
        </Row>
      ) : (
        <Row label="Address">
          <Text style={partStyles.valueText} numberOfLines={1}>
            {connection?.baseUrl ?? 'Not set'}
          </Text>
        </Row>
      )}
      {/*
        Folded away: a token and a library version are for someone working out
        why something is wrong, and the line under Settings' title already says
        whether the library can be reached.
      */}
      <Details>
        {fromCloud ? null : (
          <Row label="Token">
            <Text style={partStyles.valueText}>
              {connection?.token ? 'Saved in the keychain' : 'None'}
            </Text>
          </Row>
        )}
        <Row label="Library" last>
          <Text style={partStyles.valueText}>
            {library.isError
              ? library.data
                ? `Unreachable — showing the cached copy, ${library.data.songs.length} songs`
                : 'Unreachable, and nothing is cached yet'
              : library.data
                ? `${library.data.songs.length} songs · version ${library.data.version}`
                : 'Loading…'}
          </Text>
        </Row>
      </Details>
      <ButtonRow>
        <Button
          label="Refresh"
          icon={<Refresh size={15} tone="textPrimary" />}
          onPress={() => void library.refetch()}
        />
      </ButtonRow>
    </Panel>
  )
}
