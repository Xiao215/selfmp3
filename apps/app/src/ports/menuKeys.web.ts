import { ALL_MENU_COMMANDS, type MenuCommand } from '@selfmp3/desktop-bridge'

import { desktop } from './desktop/bridge'

export type { MenuCommand }

/**
 * See `menuKeys.ts`. The installed app builds its menu from this same constant
 * (`packages/desktop-bridge/src/menu.ts`), so what Settings lists is what the
 * menu bar draws; a browser tab, with no bridge, has none.
 */
export const menuCommands: readonly MenuCommand[] | null = desktop ? ALL_MENU_COMMANDS : null
