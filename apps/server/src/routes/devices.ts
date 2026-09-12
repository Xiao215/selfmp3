import { Router } from 'express'
import { z } from 'zod'
import {
  DeviceCommandSchema,
  DeviceHeartbeatSchema,
  DeviceIdSchema,
  type DeviceCommandResult,
  type DeviceList,
} from '@selfmp3/shared'
import type { Container } from '../container.js'
import { route } from '../http/route.js'
import { HttpError } from '../http/errors.js'

const ParamsWithDevice = z.object({ id: DeviceIdSchema })

/**
 * Devices, presence, remote commands and the event stream.
 *
 * `/events` is the one route in the server that never finishes: it sets the
 * SSE headers, hands the response to the hub and returns nothing, so the
 * route helper leaves it alone.
 */
export function deviceRoutes(container: Container): Router {
  const router = Router()

  router.get(
    '/devices',
    route({}, (): DeviceList => container.devices.list()),
  )

  router.post(
    '/devices/heartbeat',
    route({ body: DeviceHeartbeatSchema }, ({ body }): DeviceList =>
      container.devices.heartbeat(body),
    ),
  )

  router.post(
    '/devices/:id/command',
    route(
      {
        params: ParamsWithDevice,
        query: z.object({ from: DeviceIdSchema.optional() }),
        body: DeviceCommandSchema,
      },
      ({ params, query, body }): DeviceCommandResult => {
        if (body.type === 'transfer' && body.fromDeviceId === params.id) {
          throw HttpError.badRequest('a device cannot transfer from itself')
        }
        const delivered = container.devices.command(params.id, body, query.from)
        if (delivered === null) throw HttpError.notFound(`no device with id ${params.id}`)
        if (delivered === 0) {
          throw new HttpError(409, 'that device is not connected right now', 'device_offline')
        }
        return { ok: true, delivered }
      },
    ),
  )

  router.delete(
    '/devices/:id',
    route({ params: ParamsWithDevice }, ({ params }) => {
      if (!container.devices.forget(params.id)) {
        throw HttpError.notFound(`no device with id ${params.id}`)
      }
      return { ok: true as const }
    }),
  )

  router.get(
    '/events',
    route({ query: z.object({ deviceId: DeviceIdSchema.optional() }) }, ({ query, req, res }) => {
      res.status(200)
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
      res.setHeader('Cache-Control', 'no-cache, no-transform')
      res.setHeader('Connection', 'keep-alive')
      // Belt and braces with the compression filter: a buffered stream is no stream.
      res.setHeader('X-Accel-Buffering', 'no')
      res.flushHeaders()

      const unsubscribe = container.devices.connect(res, query.deviceId ?? null)
      req.on('close', unsubscribe)
      // Headers are sent, so the route helper will not try to respond.
    }),
  )

  return router
}
