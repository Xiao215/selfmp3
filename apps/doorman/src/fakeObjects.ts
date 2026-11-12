import { ChangesObject } from './changes.js'
import type { Clock } from './fakes.js'
import { Room, type RoomSocket } from './room.js'
import { Share } from './share.js'
import { Shared } from './shared.js'
import { TallyObject } from './tally.js'

/**
 * The doorman's Durable Objects for its tests (fakes.ts wires them in): the
 * real objects' own code, each with storage in a map, and only the runtime
 * stood in for.
 */

/** What a fake Durable Object is reached by: its name, and a fetch to it. */
type FakeStub = (id: { name: string }) => {
  fetch(input: string | Request, init?: RequestInit): Promise<Response>
}

/** A Durable Object namespace that finds each object by the name it was asked for. */
function fakeNamespace(get: FakeStub): DurableObjectNamespace {
  // The runtime's namespace has far more than the doorman asks of it.
  return { idFromName: (name: string) => ({ name }), get } as unknown as DurableObjectNamespace
}

/** What a fake Durable Object keeps: its storage, and when its alarm is set for. */
interface Kept {
  readonly values: Map<string, unknown>
  alarm: number | null
}

/**
 * A Durable Object's storage in a map, copied in and out as the runtime's is,
 * and its alarm, which forgetting everything clears.
 */
function mapStorage(kept: Kept) {
  const { values } = kept
  return {
    get: <T>(key: string) => Promise.resolve(structuredClone(values.get(key)) as T | undefined),
    put: <T>(key: string, value: T) => {
      values.set(key, structuredClone(value))
      return Promise.resolve()
    },
    deleteAll: () => {
      values.clear()
      kept.alarm = null
      return Promise.resolve()
    },
    setAlarm: (when: number) => {
      kept.alarm = when
      return Promise.resolve()
    },
  }
}

/**
 * A Durable Object namespace holding real `ChangesObject`s, each with storage
 * in a map: the counter's own code runs, and only the runtime is stood in for.
 * `failing` makes every request to one fail, as an unreachable object would.
 */
export class FakeChanges {
  readonly objects = new Map<string, ChangesObject>()
  failing = false

  namespace(): DurableObjectNamespace {
    return fakeNamespace(id => ({
      fetch: async (input, init) => {
        if (this.failing) throw new Error('Durable Object unreachable')
        let object = this.objects.get(id.name)
        if (!object) {
          object = new ChangesObject({ storage: mapStorage({ values: new Map(), alarm: null }) })
          this.objects.set(id.name, object)
        }
        return object.fetch(new Request(input, init))
      },
    }))
  }
}

/**
 * The doorman's one tally (tally.ts), a real `TallyObject` with storage in a
 * map: its own code runs, and only the runtime is stood in for. `failing`
 * makes every request to it fail, as an unreachable object would.
 */
export class FakeTally {
  readonly values = new Map<string, unknown>()
  failing = false
  #object: TallyObject | null = null

  namespace(): DurableObjectNamespace {
    const values = this.values
    return fakeNamespace(() => ({
      fetch: (input, init) => {
        if (this.failing) return Promise.reject(new Error('Durable Object unreachable'))
        this.#object ??= new TallyObject({
          storage: {
            ...mapStorage({ values, alarm: null }),
            delete: (key: string) => Promise.resolve(values.delete(key)),
            list: <T>({ prefix }: { prefix: string }) =>
              Promise.resolve(
                new Map(
                  [...values]
                    .filter(([key]) => key.startsWith(prefix))
                    .sort(([a], [b]) => a.localeCompare(b)) as Array<[string, T]>,
                ),
              ),
          },
        })
        return this.#object.fetch(new Request(input, init))
      },
    }))
  }

  /** A day's counts, as stored. */
  day(day: string): Record<string, number> {
    return (this.values.get(`day:${day}`) as Record<string, number> | undefined) ?? {}
  }
}

/** A member's socket in a fake room: what it was sent, and whether it was closed. */
class FakeSocket implements RoomSocket {
  readonly sent: unknown[] = []
  closed: { code: number; reason: string } | null = null

  constructor(readonly member: string) {}

  send(text: string): void {
    if (this.closed) throw new Error('the socket is closed')
    this.sent.push(JSON.parse(text))
  }

  close(code: number, reason: string): void {
    this.closed = { code, reason }
  }

  /** The last message of a kind it was sent. */
  last(type: string): Record<string, unknown> | undefined {
    return [...this.sent]
      .reverse()
      .find(message => (message as { type?: string }).type === type) as
      Record<string, unknown> | undefined
  }
}

/**
 * A Durable Object namespace of real `Room`s, each with storage in a map, an
 * alarm the test can ring, and sockets the test can read. An upgrade cannot be
 * answered with a 101 outside the Workers runtime, so a fake room answers it
 * with a 200 (JSON, as the doorman passes any answer but a 101 on) and keeps
 * a `FakeSocket` for the member instead.
 */
export class FakeRooms {
  readonly rooms = new Map<string, Kept & { room: Room; sockets: FakeSocket[] }>()

  constructor(readonly clock: Clock) {}

  namespace(): DurableObjectNamespace {
    return fakeNamespace(id => ({
      fetch: (input, init) => this.#room(id.name).room.fetch(new Request(input, init)),
    }))
  }

  /** The sockets open in a room, by member. */
  sockets(code: string): FakeSocket[] {
    return this.#room(code).sockets.filter(socket => !socket.closed)
  }

  alarmOf(code: string): number | null {
    return this.#room(code).alarm
  }

  /** Ring the room's alarm, as the runtime would once its time came. */
  ring(code: string): Promise<void> {
    return this.#room(code).room.alarm()
  }

  stored(code: string): Map<string, unknown> {
    return this.#room(code).values
  }

  #room(name: string) {
    let held = this.rooms.get(name)
    if (!held) {
      const sockets: FakeSocket[] = []
      const kept: Kept = { values: new Map(), alarm: null }
      const entry = Object.assign(kept, { sockets, room: null as unknown as Room })
      entry.room = new Room({
        storage: mapStorage(kept),
        accept: (_request, member) => {
          sockets.push(new FakeSocket(member))
          return Response.json({ socket: member })
        },
        sockets: () => sockets.filter(socket => !socket.closed),
        now: () => this.clock.now,
      })
      held = entry
      this.rooms.set(name, held)
    }
    return held
  }
}

/** A Durable Object namespace of real `Shared` playlists, each with storage in a map. */
export class FakeShared {
  readonly playlists = new Map<string, { shared: Shared; values: Map<string, unknown> }>()

  constructor(readonly clock: Clock) {}

  namespace(): DurableObjectNamespace {
    return fakeNamespace(id => ({
      fetch: (input, init) => this.#playlist(id.name).shared.fetch(new Request(input, init)),
    }))
  }

  stored(id: string): Map<string, unknown> {
    return this.#playlist(id).values
  }

  #playlist(name: string) {
    let held = this.playlists.get(name)
    if (!held) {
      const kept: Kept = { values: new Map(), alarm: null }
      held = {
        values: kept.values,
        shared: new Shared({ storage: mapStorage(kept), now: () => this.clock.now }),
      }
      this.playlists.set(name, held)
    }
    return held
  }
}

/**
 * A Durable Object namespace of real share links, each with storage in a map
 * and an alarm a test runs when it likes (`runAlarms`).
 */
export class FakeShares {
  readonly links = new Map<string, Kept & { share: Share }>()

  constructor(readonly clock: Clock) {}

  namespace(): DurableObjectNamespace {
    return fakeNamespace(id => ({
      fetch: (input, init) => this.#link(id.name).share.fetch(new Request(input, init)),
    }))
  }

  stored(id: string): Map<string, unknown> {
    return this.#link(id).values
  }

  /**
   * The link's object started again, as after a deploy or a quiet spell: what
   * it held in memory is gone, and it reads its storage afresh.
   */
  restart(id: string): void {
    const held = this.#link(id)
    held.share = this.#share(held)
  }

  /** Every alarm that is due by the clock, as the runtime would ring them. */
  async runAlarms(): Promise<void> {
    for (const held of this.links.values()) {
      if (held.alarm !== null && held.alarm <= this.clock.now) {
        held.alarm = null
        await held.share.alarm()
      }
    }
  }

  #link(name: string) {
    let held = this.links.get(name)
    if (!held) {
      const kept: Kept = { values: new Map(), alarm: null }
      const entry = Object.assign(kept, { share: this.#share(kept) })
      held = entry
      this.links.set(name, held)
    }
    return held
  }

  #share(kept: Kept): Share {
    return new Share({ storage: mapStorage(kept), now: () => this.clock.now })
  }
}
