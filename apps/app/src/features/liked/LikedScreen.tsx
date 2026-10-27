import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useRouter } from 'expo-router'
import { useLibrary } from '@selfmp3/client'
import { useArt } from '../../offline/useArt'
import { usePlayerCommands } from '../../player/PlayerProvider'
import { useLayoutFlags } from '../../shell/useLayout'
import { BackButton } from '../../ui/components/BackButton'
import { EmptyState } from '../../ui/components/EmptyState'
import { HeartOutline } from '../../ui/components/EmptyPictures'
import { Heart } from '../../ui/components/Icons'
import { ListHead, ListHeadName, listHeadText } from '../../ui/components/ListHead'
import { MoreMenu } from '../../ui/components/MoreMenu'
import { PlayShuffle } from '../../ui/components/PlayShuffle'
import { useListActions } from '../../ui/components/useListActions'
import { goBack } from '../../ui/useBackTo'
import { useHeroGrow } from '../../ui/useHeroGrow'
import { useSongColor } from '../../ui/useSongColor'
import { useSelection } from '../../selection/useSelection'
import { LIKED_SOURCE, likedSongs } from '../lists/lists.model'
import { PlaylistCover } from '../playlists/PlaylistCover'
import { PlaceSongs } from '../tag/PlacePage'
import { placeSummary } from '../tag/tag.model'

/**
 * Liked, `/playlists/liked` (docs/features/lists.md, A1): every song you like,
 * the newest like first. A list that keeps itself — a heart pressed anywhere
 * puts the song at its top — so it has no name to change and nothing to
 * delete, and Up next playing it is named "Liked".
 *
 * The page a tag has, with a heart where a tag has its dot: Play, Shuffle, the
 * ⋯ every list offers, and rows that play the list from themselves.
 */
export function LikedScreen(): ReactNode {
  const { theme } = useUnistyles()
  const { wide } = useLayoutFlags()
  const player = usePlayerCommands()
  const artFor = useArt()
  const { data: library } = useLibrary()
  const songs = useMemo(() => likedSongs(library?.songs ?? []), [library])
  const ids = useMemo(() => songs.map(song => song.id), [songs])
  const selection = useSelection(ids)
  const lead = useMemo(() => songs.find(song => song.hasArt) ?? songs[0] ?? null, [songs])
  const light = useSongColor(lead, lead ? artFor(lead) : null)
  // The head grows out of the tile that opened it, and back into it (`useHeroGrow`, I1).
  const hero = useHeroGrow(wide)
  const heroRef = hero.heroRef
  const router = useRouter()
  const listActions = useListActions(ids, {
    heroRef,
    selection,
    shareAs: 'Liked',
    togetherAs: 'Liked',
  })

  const head = (
    <ListHead
      wide={wide}
      light={light.color}
      art={null}
      topBar={
        <>
          <BackButton
            to="/playlists"
            onPress={() => hero.back(() => goBack(router, '/playlists'))}
          />
          <MoreMenu
            name="Liked"
            items={listActions}
            title="Liked"
            testID="liked-more"
            menuTestID="liked-menu"
          />
        </>
      }
      heroRef={heroRef}
      heroStyle={hero.heroStyle}
      onHeroLayout={hero.onHeroLayout}
      // Nothing liked yet: no blank square over the heart that says what goes here (J1).
      cover={ids.length > 0 ? <PlaylistCover songIds={ids} size={wide ? 176 : 196} /> : null}
      titles={
        <>
          <View style={listHeadText.nameRow}>
            <Heart size={wide ? 22 : 16} filled color={theme.colors.danger} />
            <View style={listHeadText.nameShrink}>
              <ListHeadName name="Liked" testID="liked-name" />
            </View>
          </View>
          <Text style={listHeadText.summary}>{placeSummary(songs)}</Text>
        </>
      }
      actions={
        <PlayShuffle
          name="Liked"
          songIds={ids}
          heroRef={heroRef}
          onPlay={() => player.playFrom(ids, 0, { source: LIKED_SOURCE })}
          onShuffle={() => player.playShuffled(ids, LIKED_SOURCE)}
          testPrefix="liked"
        />
      }
    />
  )

  return (
    <View style={styles.screen}>
      <PlaceSongs
        songs={songs}
        selection={selection}
        source={LIKED_SOURCE}
        byAlbum={false}
        head={head}
        label="Liked songs"
        scope="in Liked"
        empty={
          <EmptyState
            compact
            testID="liked-empty"
            picture={<HeartOutline />}
            title="Songs you like land here"
            line="Like a song from Now Playing, or from its ⋯ menu."
          />
        }
      />
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  screen: { flex: 1, backgroundColor: theme.colors.surface0 },
}))
