import { ALL_MENU_COMMANDS, type MenuCommand } from '@selfmp3/desktop-bridge'

import type { useMenuCommands as SameShape } from './menuKeys'
import { desktop } from './desktop/bridge'

export type { MenuCommand }

/** The installed app's, or none in a browser tab; fixed for the life of the page. */
const items: readonly MenuCommand[] | null = desktop ? ALL_MENU_COMMANDS : null

/**
 * See `menuKeys.ts`. The installed app builds its menu from this same constant
 * (`packages/desktop-bridge/src/menu.ts`), so what Settings lists is what the
 * menu bar draws; a browser tab, with no bridge, has none.
 */
export const useMenuCommands: typeof SameShape = () => items
