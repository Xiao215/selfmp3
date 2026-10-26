import { BarChart, Download, Home, ListMusic, Music, SoundMap } from '../ui/components/Icons'
import type { NavId } from './nav.model'

/** Each place's icon, on the tab bar and the rail alike. */
export const NAV_ICON: Record<NavId, typeof Music> = {
  home: Home,
  library: Music,
  playlists: ListMusic,
  import: Download,
  stats: BarChart,
  soundMap: SoundMap,
}
