import { useRef, type ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import { WebView } from 'react-native-webview'
import { useValueStore } from '../state/useValueStore'
import { YOUTUBE_PAGE, youtubePage, youtubePageWanted } from './deviceDownloads'

/**
 * The phone's YouTube page (ports/deviceDownloads.ts): a WebView drawn as
 * nothing, held only once something has asked to download. Its page is at
 * YouTube's address and loads its script from the web app's; what it says
 * comes back through `onMessage`, and what it is asked goes in through
 * `injectJavaScript`.
 *
 * Its own browser: no cookies shared with the app, no way to the app's
 * JavaScript but the messages, and nowhere to go — a link it would follow is
 * not followed.
 */
export function YouTubePage(): ReactNode {
  const wanted = useValueStore(youtubePageWanted)
  const view = useRef<WebView>(null)
  if (!wanted) return null
  return (
    <View
      style={styles.hidden}
      pointerEvents="none"
      importantForAccessibility="no-hide-descendants"
    >
      <WebView
        ref={view}
        source={YOUTUBE_PAGE}
        originWhitelist={['https://*']}
        javaScriptEnabled
        domStorageEnabled
        sharedCookiesEnabled={false}
        thirdPartyCookiesEnabled={false}
        mediaPlaybackRequiresUserAction
        onLoadStart={() => {
          youtubePage.connect(script => view.current?.injectJavaScript(script))
        }}
        onMessage={event => youtubePage.receive(event.nativeEvent.data)}
        // The page itself, and what it loads in frames of its own; never somewhere else instead.
        onShouldStartLoadWithRequest={request =>
          !request.isTopFrame ||
          request.url === YOUTUBE_PAGE.baseUrl ||
          request.url.startsWith('about:') ||
          request.url.startsWith('data:')
        }
        onError={event =>
          youtubePage.lost(`the YouTube page did not load: ${event.nativeEvent.description}`)
        }
        onContentProcessDidTerminate={() => youtubePage.lost('the YouTube page was closed by iOS')}
        onRenderProcessGone={() => youtubePage.lost('the YouTube page was closed by Android')}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  // Drawn, so the system keeps its page running, but a pixel and out of sight.
  hidden: { position: 'absolute', width: 1, height: 1, opacity: 0, left: -10, top: -10 },
})
