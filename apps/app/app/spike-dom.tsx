/**
 * Spike route for check 5: the `'use dom'` song visual.
 *
 * On web the component renders inline; on iOS Expo puts it in a webview and
 * gives it the `dom` prop. Both go through this one route so the Maestro flow
 * and a browser look at the same thing.
 */
import { View } from 'react-native'

import SpikeSongVisual from '../src/dom/SpikeSongVisual'

export default function SpikeDom() {
  return (
    <View style={{ flex: 1, backgroundColor: '#0c0b13' }} testID="spike-dom-page">
      <SpikeSongVisual dom={{ matchContents: true }} />
    </View>
  )
}
