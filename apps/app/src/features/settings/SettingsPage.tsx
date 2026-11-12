import type { ReactNode } from 'react'
import { View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { space } from '@selfmp3/client'
import { ChromeSpacer } from '../../shell/ChromeSpacer'
import { useLayoutFlags } from '../../shell/useLayout'
import type { BackProps } from '../../ui/components/BackButton'
import { PageHeader } from '../../ui/components/PageHeader'
import { SafeAreaView } from '../../ui/components/SafeAreaView'
import { ScrollView } from '../../ui/components/Scroll'
import { pageFrame } from '../../ui/surfaces'
import { StackedRows } from './SettingsParts'

/** How wide Settings' column grows on a computer: a phone's page, with room to breathe. */
const SETTINGS_WIDTH = 640

/**
 * A page of Settings: Settings itself and each page reached from it, the same
 * column of the same cards under the page's header.
 */
export function SettingsPage({
  title,
  back,
  subtitle,
  subtitleTestID,
  children,
}: {
  title: string
  back: BackProps
  subtitle?: ReactNode
  subtitleTestID?: string
  children: ReactNode
}): ReactNode {
  const { wide } = useLayoutFlags()
  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView contentContainerStyle={[styles.content, pageFrame(wide)]}>
        <StackedRows value={!wide}>
          <View style={styles.column}>
            <PageHeader
              title={title}
              back={back}
              subtitle={subtitle}
              subtitleTestID={subtitleTestID}
            />
            {children}
          </View>
        </StackedRows>
        <ChromeSpacer />
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create(theme => ({
  screen: { flex: 1, backgroundColor: theme.colors.surface0 },
  content: { paddingBottom: 40 },
  column: { width: '100%', maxWidth: SETTINGS_WIDTH, gap: space.xl },
}))
