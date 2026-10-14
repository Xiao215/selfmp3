import { z } from 'zod'
import { IdSchema } from './common.js'

/**
 * Devices, presence and handoff.
 *
 * Every open client is a "device": it announces itself with a heartbeat that
 * carries its playback state, and another device handing playback over can
 * send it a command. The server is only the switchboard — it stores the last
 * heartbeat per device (so the state survives a restart and can be resumed
 * tomorrow) and forwards commands over the event stream. Nothing plays on the
 * server.
 */

/** A stable id the client generates once and keeps in localStorage. */
export const DeviceIdSchema = z
  .string()
  .trim()
  .min(8)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, 'device id may only contain letters, digits, - and _')
export type DeviceId = z.infer<typeof DeviceIdSchema>

export const DeviceKindSchema = z.enum(['phone', 'desktop', 'other'])
export type DeviceKind = z.infer<typeof DeviceKindSchema>

export const DeviceNameSchema = z.string().trim().min(1).max(60)

/** What a device is doing right now, as far as its last heartbeat says. */
export const PlaybackStateSchema = z.object({
  songId: IdSchema.nullable(),
  /** Seconds into the current song. */
  position: z.number().min(0),
  playing: z.boolean(),
  queueIds: z.array(IdSchema).max(10_000),
  queueIndex: z.number().int().min(-1),
  shuffle: z.boolean(),
  repeat: z.enum(['off', 'all', 'one']),
  /**
   * The sending device's clock, ms since epoch, when it captured this state.
   * Comparable only with other states from that same device (how a seek is
   * told from ordinary progress); anything judged across devices uses the
   * server's `lastSeenAt` instead.
   */
  updatedAt: z.number().int().nonnegative(),
})
export type PlaybackState = z.infer<typeof PlaybackStateSchema>

export const DeviceHeartbeatSchema = z.object({
  deviceId: DeviceIdSchema,
  name: DeviceNameSchema,
  kind: DeviceKindSchema,
  state: PlaybackStateSchema,
})
export type DeviceHeartbeat = z.infer<typeof DeviceHeartbeatSchema>

export const DeviceSchema = z.object({
  id: DeviceIdSchema,
  name: DeviceNameSchema,
  kind: DeviceKindSchema,
  state: PlaybackStateSchema,
  /** Server clock, ms since epoch, of the last heartbeat. */
  lastSeenAt: z.number().int().nonnegative(),
  /** Seen within the presence window (see `DEVICE_ONLINE_MS`). */
  online: z.boolean(),
})
export type Device = z.infer<typeof DeviceSchema>

export const DeviceListSchema = z.object({
  devices: z.array(DeviceSchema),
  /** Server clock, so a client can judge staleness without trusting its own. */
  now: z.number().int().nonnegative(),
})
export type DeviceList = z.infer<typeof DeviceListSchema>

/**
 * A command for one device, sent by another during a handoff: `playSong` is
 * "Play there instead" pushing this device's queue over, and `pause` is "Play
 * here" stopping the device it took over from.
 *
 * A discriminated union rather than a bag of optionals, so the executor on the
 * receiving end is an exhaustive switch that stops compiling when a variant is
 * added without a handler.
 */
export const DeviceCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('pause') }),
  z.object({
    type: z.literal('playSong'),
    songId: IdSchema,
    queueIds: z.array(IdSchema).max(10_000).optional(),
    queueIndex: z.number().int().min(0).optional(),
    /** Start here rather than at 0 — what makes a handoff seamless. */
    position: z.number().min(0).optional(),
  }),
])
export type DeviceCommand = z.infer<typeof DeviceCommandSchema>

export const DeviceCommandResultSchema = z.object({
  ok: z.literal(true),
  /** How many live connections of the target device received it. */
  delivered: z.number().int().nonnegative(),
})
export type DeviceCommandResult = z.infer<typeof DeviceCommandResultSchema>

/**
 * Everything that travels over `GET /api/events`.
 *
 * `devices` is the whole list every time rather than a diff: it is tiny, and
 * a client that missed an event during a reconnect is then never wrong.
 */
export const ServerEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('devices'), devices: z.array(DeviceSchema), now: z.number() }),
  z.object({
    type: z.literal('command'),
    /** The device that should act on it. */
    deviceId: DeviceIdSchema,
    command: DeviceCommandSchema,
  }),
  z.object({ type: z.literal('library'), version: z.number().int().nonnegative() }),
])
export type ServerEvent = z.infer<typeof ServerEventSchema>
