import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ScrollView, Text, TextInput, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useQueryClient } from '@tanstack/react-query'
import type { ImportRequestView } from '@selfmp3/cloud'
import { queryKeys, radius, useCloudImportActions, useCloudImports } from '@selfmp3/client'
import { useLayout } from '../../shell/useLayout'
import { useAccent } from '../../ui/accent'
import { Button } from '../../ui/components/Button'
import { CheckCircle, Clock, Download, X } from '../../ui/components/Icons'
import { SafeAreaView } from '../../ui/components/SafeAreaView'
import {
  canCancelCloudImport,
  describeCloudImport,
  finishedCloudImports,
} from './cloudImport.model'
import { sharedLinks } from './import.model'

/**
 * Importing into a cloud library: the web's `CloudImportView`.
 *
 * Nothing here can run yt-dlp, so a link sent from this screen is a request in
 * the bucket's change log. The Mac downloads it the next time it is on, and
 * every device sees how it went. A link shared to the app lands in the box,
 * ready to send, rather than being sent on arrival.
 */
export function CloudImportScreen(): ReactNode {
  const { theme } = useUnistyles()
  const { wide } = useLayout()
  const accent = useAccent()
  const router = useRouter()
  const queryClient = useQueryClient()
  const params = useLocalSearchParams<{ url?: string; text?: string; title?: string }>()
  const [url, setUrl] = useState('')
  /*
   * A share can arrive while this screen is already open, so the box follows
   * each new one rather than only the first. Only the first link of a share is
   * taken: a request is one link, as on the web.
   */
  const shared = sharedLinks(params)?.split('\n')[0] ?? null
  const [seenShare, setSeenShare] = useState<string | null>(null)
  if (shared !== seenShare) {
    setSeenShare(shared)
    if (shared) setUrl(shared)
  }
  const { data, error } = useCloudImports()
  const { request, cancel } = useCloudImportActions()
  const imports = data?.imports ?? []

  // The shared link is in the box now; the address need not keep it.
  useEffect(() => {
    if (shared) router.setParams({ url: undefined, text: undefined, title: undefined })
    // Only `shared` matters; clearing it is what ends this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shared])

  // A request that finishes brings songs: show them in the library too.
  const done = finishedCloudImports(imports)
  const seenDone = useRef(done)
  useEffect(() => {
    if (done > seenDone.current) void queryClient.invalidateQueries({ queryKey: queryKeys.library })
    seenDone.current = done
  }, [done, queryClient])

  const send = (): void => {
    const link = url.trim()
    if (!link) return
    request.mutate({ url: link, tagIds: [], playlistId: null }, { onSuccess: () => setUrl('') })
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView
        contentContainerStyle={[styles.content, wide ? styles.contentWide : styles.contentNarrow]}
        keyboardShouldPersistTaps="handled"
        testID="cloud-import-screen"
      >
        <Text style={[styles.heading, !wide && styles.headingNarrow]} accessibilityRole="header">
          Import
        </Text>
        <Text style={styles.sub}>
          Paste a YouTube or YouTube Music link — a song, or a whole playlist. Your Mac downloads it
          the next time it is on, and it appears on every device.
        </Text>

        <View style={[styles.form, !wide && styles.formNarrow]}>
          <TextInput
            style={[styles.input, wide && styles.inputWide]}
            value={url}
            onChangeText={setUrl}
            onSubmitEditing={send}
            placeholder="https://music.youtube.com/watch?v=…"
            placeholderTextColor={theme.colors.textMuted}
            inputMode="url"
            keyboardType="url"
            returnKeyType="send"
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect={false}
            spellCheck={false}
            accessibilityLabel="Link to import"
          />
          <Button
            label="Import"
            icon={<Download size={15} color={accent.onAccent} />}
            variant="primary"
            grow={!wide}
            busy={request.isPending}
            disabled={!url.trim()}
            onPress={send}
          />
        </View>

        {request.error ? (
          <View style={[styles.notice, styles.noticeError]} accessibilityRole="alert">
            <Text style={styles.noticeText}>{request.error.message}</Text>
          </View>
        ) : null}
        {error ? (
          <View style={[styles.notice, styles.noticeWarn]}>
            <Text style={styles.noticeText}>
              Couldn’t check on your imports just now: {error.message}
            </Text>
          </View>
        ) : null}

        {imports.length === 0 ? (
          <Text style={styles.lead}>Nothing asked for yet.</Text>
        ) : (
          <View style={styles.list} accessibilityRole="list" accessibilityLabel="Your imports">
            {imports.map(item => (
              <RequestRow
                key={item.uid}
                item={item}
                cancelling={cancel.isPending}
                onCancel={() => cancel.mutate(item.uid)}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

/** One link asked of the Mac: the web's `.cloud-import`. */
function RequestRow({
  item,
  cancelling,
  onCancel,
}: {
  item: ImportRequestView
  cancelling: boolean
  onCancel: () => void
}): ReactNode {
  const { theme } = useUnistyles()
  const accent = useAccent()
  const title = item.title ?? item.url
  const faded = item.state === 'done' || item.state === 'cancelled'
  const icon =
    item.state === 'done' ? (
      <CheckCircle size={16} color={theme.colors.good} />
    ) : item.state === 'failed' || item.state === 'cancelled' ? (
      <X size={16} color={item.state === 'failed' ? theme.colors.danger : theme.colors.textMuted} />
    ) : (
      <Clock size={16} color={item.state === 'working' ? accent.accent : theme.colors.warning} />
    )

  return (
    <View
      style={[
        styles.row,
        item.state === 'working' && { borderColor: accent.accentDim },
        item.state === 'failed' && { borderColor: theme.colors.danger },
      ]}
      testID={`cloud-import-${item.state}`}
    >
      <View style={styles.status}>{icon}</View>
      <View style={styles.meta}>
        <Text style={[styles.title, faded && styles.fadedText]} numberOfLines={1}>
          {title}
        </Text>
        <Text
          style={[styles.detail, item.state === 'failed' && { color: theme.colors.danger }]}
          numberOfLines={2}
        >
          {describeCloudImport(item)}
        </Text>
      </View>
      {canCancelCloudImport(item) ? (
        <Button
          label="Cancel"
          icon={<X size={13} color={theme.colors.textPrimary} />}
          disabled={cancelling}
          onPress={onCancel}
          accessibilityLabel={`Cancel ${title}`}
        />
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  screen: { flex: 1, backgroundColor: theme.colors.surface0 },
  content: { paddingBottom: 40 },
  contentWide: { paddingTop: 28, paddingHorizontal: 32, maxWidth: 820 },
  contentNarrow: { paddingTop: 18, paddingHorizontal: 16 },
  heading: { color: theme.colors.textPrimary, fontSize: 26, fontWeight: '700' },
  headingNarrow: { fontSize: 22 },
  sub: {
    color: theme.colors.textMuted,
    fontSize: 13,
    marginTop: 6,
    marginBottom: 20,
    lineHeight: 19,
  },
  form: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  formNarrow: { flexDirection: 'column', alignItems: 'stretch' },
  input: {
    minHeight: 38,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: theme.colors.textPrimary,
    fontSize: 14,
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: radius.sm,
  },
  inputWide: { flex: 1 },
  notice: {
    marginBottom: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: radius.sm,
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  noticeWarn: { borderColor: theme.colors.warning },
  noticeError: { borderColor: theme.colors.danger },
  noticeText: { color: theme.colors.textSecondary, fontSize: 13, lineHeight: 19 },
  lead: { color: theme.colors.textMuted, fontSize: 13, marginTop: 6 },
  list: { gap: 4, marginTop: 6 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 50,
    paddingVertical: 9,
    paddingLeft: 12,
    paddingRight: 10,
    borderRadius: radius.sm,
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  status: { width: 20, alignItems: 'center' },
  meta: { flex: 1, minWidth: 0 },
  title: { color: theme.colors.textPrimary, fontSize: 13, fontWeight: '500' },
  fadedText: { color: theme.colors.textMuted },
  detail: { color: theme.colors.textMuted, fontSize: 11, marginTop: 2, lineHeight: 15 },
}))
