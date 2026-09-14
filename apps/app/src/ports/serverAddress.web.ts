import { desktop } from './desktop/bridge'
import { installedApp } from './install.web'

/**
 * Whether this device can be pointed at a server by typing its address.
 *
 * True only in the installed desktop app, which is the one case where it earns
 * its keep: a computer may be sitting beside the server — it may *be* the
 * server — and the browser on that machine already talks to it directly with
 * nothing typed. Giving the installed app the same reach is what makes it
 * useful on the server the day it is built.
 *
 * False in an ordinary tab, which is served by whoever served it and has
 * nothing to point anywhere.
 */
export const canConnectByAddress = installedApp && desktop !== null
