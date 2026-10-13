import { useState, type ReactNode } from 'react'
import { StyleSheet } from 'react-native-unistyles'
import { space, useAccess, useUpdateAccess } from '@selfmp3/client'
import { Button } from '../../ui/components/Button'
import { Toggle } from '../../ui/components/Toggle'
import { anyoneHint, withEmail, withoutEmail } from './access.model'
import { TextField } from '../../ui/components/TextField'
import { Panel, Row } from './SettingsParts'
import { StatusLine } from '../../ui/components/StatusLine'

/**
 * Who can sign in: the doorman's allow list, for its owner
 * (apps/doorman/src/access.ts, docs/features/shared-server.md).
 *
 * Drawn only for an owner. The doorman refuses anyone else the list, so a
 * refusal — or no answer yet — draws nothing at all: a panel nobody but the
 * owner could use is not one to show greyed out to everyone else.
 *
 * Every change sends the whole list and holds at once: someone removed is
 * refused from their next request, their sessions and any server's grant for
 * them included, and comes back with everything if added again.
 */
export function AccessPanel(): ReactNode {
  const access = useAccess()
  const update = useUpdateAccess()
  const [typed, setTyped] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const list = access.data
  if (!list) return null

  const add = (): void => {
    const next = withEmail(list, typed)
    if ('problem' in next) {
      setProblem(next.problem)
      return
    }
    setProblem(null)
    update.mutate(next.update, { onSuccess: () => setTyped('') })
  }
  const said = problem ?? update.error?.message ?? null

  return (
    <Panel title="Who can sign in" hint="you own this self.mp3" anchor={() => undefined}>
      <Row label="Anyone with a Google account" hint={anyoneHint(list)}>
        <Toggle
          value={list.anyone}
          disabled={update.isPending}
          onChange={anyone => update.mutate({ anyone, emails: list.emails })}
          label="Anyone with a Google account"
          testID="access-anyone"
        />
      </Row>
      {list.owners.map(owner => (
        <Row key={owner} label={owner} hint="Owner · always let in" />
      ))}
      {list.emails.map(email => (
        <Row key={email} label={email}>
          <Button
            label="Remove"
            variant="danger"
            disabled={update.isPending}
            onPress={() => update.mutate(withoutEmail(list, email))}
            testID="access-remove"
          />
        </Row>
      ))}
      <Row
        label="Add someone"
        hint="Their Google address. While Google sign-in is in Testing, add them as a test user there too."
        last
      >
        <TextField
          size="small"
          value={typed}
          placeholder="name@gmail.com"
          autoCapitalize="none"
          keyboardType="email-address"
          accessibilityLabel="Google address to let in"
          onChangeText={text => {
            setTyped(text)
            setProblem(null)
          }}
          onSubmitEditing={add}
          testID="access-email"
          action={
            <Button
              label="Add"
              disabled={update.isPending || typed.trim() === ''}
              onPress={add}
              testID="access-add"
            />
          }
        />
      </Row>
      {said ? <StatusLine style={styles.problem}>{said}</StatusLine> : null}
    </Panel>
  )
}

const styles = StyleSheet.create(() => ({
  problem: { marginTop: space.sm },
}))
