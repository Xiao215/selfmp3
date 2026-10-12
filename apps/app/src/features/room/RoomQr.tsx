import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { View } from 'react-native'
import Svg, { Path } from 'react-native-svg'
import { StyleSheet } from 'react-native-unistyles'
import { radius } from '@selfmp3/client'
import { qrDrawing } from './qr.model'

/**
 * The invite as a QR code: black on white in either theme, since that is what
 * every camera reads best (mock R2).
 */
export function RoomQr({ text, size = 168 }: { text: string; size?: number }): ReactNode {
  const drawing = useMemo(() => qrDrawing(text), [text])
  return (
    <View
      style={[styles.paper, { width: size, height: size }]}
      role="img"
      accessibilityLabel="QR code for the invite link"
      testID="room-qr"
    >
      <Svg width={size} height={size} viewBox={`0 0 ${drawing.size} ${drawing.size}`}>
        <Path d={drawing.path} fill="#000000" />
      </Svg>
    </View>
  )
}

const styles = StyleSheet.create({
  // A QR code is read off white, whatever the theme: dark-on-light is what readers expect.
  paper: { backgroundColor: '#ffffff', borderRadius: radius.coverSm, overflow: 'hidden' },
})
