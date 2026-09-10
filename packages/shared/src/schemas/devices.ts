import { z } from 'zod'
import { IdSchema } from './common.js'

/**
 * Devices, presence and remote control.
 *
 * Every open client is a "device": it announces itself with a heartbeat that
 * carries its playback state, and it can be sent a command by any other
 * device. The server is only the switchboard — it stores the last heartbeat
 * per device (so the state survives a restart and can be resumed tomorrow)
 * and forwards commands over the event stream. Nothing plays on the server.
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
  volume: z.number().min(0).max(1).optional(),
  /** Client clock, ms since epoch. Used to pick the freshest state to resume. */
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
 * A command for one device, sent by another.
 *
 * A discriminated union rather than a bag of optionals, so the executor on the
 * receiving end is an exhaustive switch that stops compiling when a variant is
 * added without a handler.
 */
export const DeviceCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.enum(['play', 'pause', 'toggle', 'next', 'prev']) }),
  z.object({ type: z.literal('seek'), position: z.number().min(0) }),
  z.object({
    type: z.literal('playSong'),
    songId: IdSchema,
    queueIds: z.array(IdSchema).max(10_000).optional(),
    queueIndex: z.number().int().min(0).optional(),
    /** Start here rather than at 0 — what makes a handoff seamless. */
    position: z.number().min(0).optional(),
    /** Load paused when false. Defaults to playing. */
    play: z.boolean().optional(),
  }),
  z.object({ type: z.literal('setVolume'), volume: z.number().min(0).max(1) }),
  /** "Take over from that device": pull its state, start here, pause it there. */
  z.object({ type: z.literal('transfer'), fromDeviceId: DeviceIdSchema }),
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
    /** Who sent it, when the sender is a device. */
    fromDeviceId: DeviceIdSchema.optional(),
  }),
  z.object({ type: z.literal('library'), version: z.number().int().nonnegative() }),
])
export type ServerEvent = z.infer<typeof ServerEventSchema>
