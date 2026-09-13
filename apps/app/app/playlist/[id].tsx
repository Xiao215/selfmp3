import type { ReactNode } from 'react'
import { Redirect, useLocalSearchParams } from 'expo-router'

/**
 * The old address of a playlist. The universal app now uses the web app's
 * `/playlists/:id`, so a link or bookmark made before keeps working.
 */
export default function OldPlaylistRoute(): ReactNode {
  const { id } = useLocalSearchParams<{ id: string }>()
  return <Redirect href={`/playlists/${id}`} />
}
