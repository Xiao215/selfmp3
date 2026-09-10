import { NavLink } from 'react-router-dom'
import { BarChart, Download, ListMusic, Music, Settings } from './Icons.js'

/**
 * The phone tab bar.
 *
 * Five destinations, fixed to the bottom, sitting above the home indicator via
 * `env(safe-area-inset-bottom)`. Tags are reachable from the library header
 * rather than living here — on a phone a filter belongs next to the thing it
 * filters, not in global navigation.
 *
 * The current tab is marked by a filled pill behind its icon as well as by
 * the accent colour, because colour alone is a weak signal at this size and
 * no signal at all to anyone who cannot separate these two hues.
 */
const TABS = [
  { to: '/', end: true, label: 'Library', Icon: Music },
  { to: '/playlists', end: false, label: 'Playlists', Icon: ListMusic },
  { to: '/import', end: false, label: 'Import', Icon: Download },
  { to: '/stats', end: false, label: 'Stats', Icon: BarChart },
  { to: '/settings', end: false, label: 'Settings', Icon: Settings },
] as const

export function MobileNav() {
  return (
    <nav className="mobile-nav" aria-label="Main navigation">
      {TABS.map(({ to, end, label, Icon }) => (
        <NavLink key={to} to={to} end={end} className="mobile-nav-item">
          <span className="mobile-nav-icon">
            <Icon size={20} />
          </span>
          <span className="mobile-nav-label">{label}</span>
        </NavLink>
      ))}
    </nav>
  )
}
