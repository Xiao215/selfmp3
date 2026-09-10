import { NavLink } from 'react-router-dom'
import { BarChart, Download, ListMusic, Music, Settings } from './Icons.js'

/**
 * The phone tab bar.
 *
 * Five destinations, fixed to the bottom, sitting above the home indicator via
 * `env(safe-area-inset-bottom)`. Tags are reachable from the library header
 * rather than living here — on a phone a filter belongs next to the thing it
 * filters, not in global navigation.
 */
export function MobileNav() {
  return (
    <nav className="mobile-nav" aria-label="Main navigation">
      <NavLink to="/" end className="mobile-nav-item">
        <Music size={20} />
        <span>Library</span>
      </NavLink>
      <NavLink to="/playlists" className="mobile-nav-item">
        <ListMusic size={20} />
        <span>Playlists</span>
      </NavLink>
      <NavLink to="/import" className="mobile-nav-item">
        <Download size={20} />
        <span>Import</span>
      </NavLink>
      <NavLink to="/stats" className="mobile-nav-item">
        <BarChart size={20} />
        <span>Stats</span>
      </NavLink>
      <NavLink to="/settings" className="mobile-nav-item">
        <Settings size={20} />
        <span>Settings</span>
      </NavLink>
    </nav>
  )
}
