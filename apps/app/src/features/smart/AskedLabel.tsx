import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { iconSize } from '@selfmp3/client'
import { Sparkle } from '../../ui/components/Icons'
import { listHeadText } from '../../ui/components/ListHead'

/** The quiet line over an answer's title, after the sparkle: "Picked for you". */
export function AskedLabel({ label }: { label: string }): ReactNode {
  return (
    <View style={listHeadText.kind}>
      <Sparkle size={iconSize.tiny} />
      <Text style={listHeadText.kindText}>{label}</Text>
    </View>
  )
}
