import { DEFAULT_APP_URL, IDLE_PACING, type ImportEnqueue, type ImportQueue } from '@selfmp3/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { ask, type Choices } from '../bridge.js'
import { pageKind } from '../pageKind.js'
import { currentPage } from './page.js'
import {
  batchProgress,
  cleanedFrom,
  connectionOf,
  jobForLink,
  pageTitle,
  popupView,
  requestForLink,
  shouldLookUp,
  sinceLine,
  taggedLine,
  type Connection,
  type PreviewState,
} from './popup.model.js'
import {
  Added,
  Away,
  BucketFooter,
  Checking,
  Connect,
  Failed,
  Have,
  Header,
  Importing,
  ListReview,
  Looking,
  Paste,
  QueueFooter,
  RequestForm,
  Requested,
  SongForm,
  Waiting,
  type Tagging,
} from './views.js'

/** How often the queue is read while something for this popup is importing. */
const BUSY_POLL_MS = 1_000
const IDLE_POLL_MS = 5_000
/** A request in the bucket changes when the server next syncs, which is not soon. */
const BUCKET_POLL_MS = 15_000

const openOptions = (): void => {
  void chrome.runtime.openOptionsPage()
}

/**
 * The toolbar popup (A): the page's song — or the paste box — through to its
 * import. What it shows is `popupView`'s; this gathers what that needs.
 */
export function Popup(): ReactNode {
  const queryClient = useQueryClient()
  const [typed, setTyped] = useState<string | null>(null)
  const [importAnyway, setImportAnyway] = useState(false)
  const [started, setStarted] = useState<ReadonlySet<string>>(() => new Set())

  const page = useQuery({ queryKey: ['page'], queryFn: currentPage, staleTime: Infinity })
  const status = useQuery({
    queryKey: ['status'],
    queryFn: () => ask({ type: 'status' }),
    retry: false,
  })

  const connection: Connection =
    page.isPending || status.isPending
      ? 'checking'
      : status.isError
        ? 'away'
        : connectionOf(status.data)
  const ready = connection === 'ready'
  /** Through the bucket: everything still offered, and nothing that needs the server (I3). */
  const viaBucket = connection === 'bucket'
  const server = status.data?.server ?? null

  const link = typed ?? page.data?.url ?? null
  const kind = pageKind(link)
  const lookUp = link !== null && shouldLookUp(kind, typed !== null)

  const hitWanted = (ready || viaBucket) && lookUp && kind.kind === 'song'
  const hit = useQuery({
    queryKey: ['songFor', link],
    queryFn: () => ask({ type: 'songFor', url: link ?? '' }),
    enabled: hitWanted,
    retry: false,
  })
  const hitValue = !hitWanted ? null : hit.isPending ? 'loading' : (hit.data ?? null)

  const previewWanted = ready && lookUp && hitValue !== 'loading' && (!hitValue || importAnyway)
  const preview = useQuery({
    queryKey: ['preview', link],
    queryFn: () => ask({ type: 'preview', url: link ?? '' }),
    enabled: previewWanted,
    retry: false,
    staleTime: Infinity,
  })
  const previewState: PreviewState = !previewWanted
    ? { status: 'idle' }
    : preview.isPending
      ? { status: 'loading' }
      : preview.isError
        ? { status: 'error', message: preview.error.message }
        : { status: 'done', value: preview.data }

  /*
   * The links left in the bucket. Read while the popup is open rather than
   * followed by the watcher: the server answers a request by writing it into
   * its next snapshot, which is minutes away, not seconds.
   */
  const requests = useQuery({
    queryKey: ['requests'],
    queryFn: () => ask({ type: 'requests' }),
    enabled: viaBucket,
    refetchInterval: BUCKET_POLL_MS,
  })
  const request = requestForLink(requests.data?.imports ?? [], link)

  const queue = useQuery({
    queryKey: ['queue'],
    queryFn: () => ask({ type: 'queue' }),
    enabled: ready,
    refetchInterval: query => {
      const data = query.state.data
      return data && data.active + data.queued > 0 ? BUSY_POLL_MS : IDLE_POLL_MS
    },
  })
  const linkJob = jobForLink(queue.data?.jobs ?? [], link, started, new Date())
  // A playlist's tracks are queued under their own links, so what was started
  // from the list is followed as a batch instead.
  const batch = linkJob ? null : batchProgress(queue.data?.jobs ?? [], started)
  const job = linkJob ?? batch?.job ?? null

  const view = popupView({
    connection,
    link,
    typed: typed !== null,
    page: kind,
    hit: hitValue,
    preview: previewState,
    job,
    request,
    importAnyway,
  })

  const choices = useQuery({
    queryKey: ['choices'],
    queryFn: () => ask({ type: 'choices' }),
    enabled:
      view.name === 'song' ||
      view.name === 'list' ||
      view.name === 'request' ||
      view.name === 'added',
  })

  /*
   * "+ new": the tag is made first, through whichever side answers, and the
   * form picks it once it exists — an import can only name tags by their ids.
   */
  const createTag = useMutation({
    mutationFn: (name: string) => ask({ type: 'createTag', name }),
    onSuccess: tag => {
      queryClient.setQueryData<Choices>(['choices'], previous =>
        previous ? { ...previous, tags: [...previous.tags, tag] } : previous,
      )
      void queryClient.invalidateQueries({ queryKey: ['choices'] })
    },
  })
  const tagging: Tagging = {
    choices: choices.data,
    creating: createTag.isPending,
    error: createTag.error?.message ?? null,
    create: name => createTag.mutateAsync(name),
  }

  const enqueue = useMutation({
    mutationFn: ({ request, label }: { request: ImportEnqueue; label: string | null }) =>
      ask({ type: 'enqueue', request, label }),
    onSuccess: result => {
      setStarted(previous => new Set([...previous, ...result.jobs.map(each => each.id)]))
      setImportAnyway(false)
      // Show the new job at once rather than after the next read of the queue.
      queryClient.setQueryData<ImportQueue>(['queue'], previous => ({
        jobs: [...result.jobs, ...(previous?.jobs ?? [])],
        active: previous?.active ?? 0,
        queued: (previous?.queued ?? 0) + result.jobs.length,
        done: previous?.done ?? 0,
        pacing: previous?.pacing ?? IDLE_PACING,
      }))
      void queryClient.invalidateQueries({ queryKey: ['queue'] })
    },
  })

  const leave = useMutation({
    mutationFn: (input: { tagIds: number[] }) =>
      ask({ type: 'requestImport', url: link ?? '', ...input }),
    onSuccess: () => {
      setImportAnyway(false)
      void queryClient.invalidateQueries({ queryKey: ['requests'] })
    },
  })

  const callOff = useMutation({
    mutationFn: (uid: string) => ask({ type: 'cancelRequest', uid }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['requests'] }),
  })

  const jobAction = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'cancel' | 'retry' }) =>
      ask({ type: action, id }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['queue'] }),
  })

  /**
   * Open the app, which is not the server.
   *
   * These used to be the same address: the server served the app at its own
   * origin, so the queue was one path away from the address in Options. The
   * server serves only its own setup page now, so this goes to the published
   * app instead — and it does not need the server to be reachable to do it.
   */
  const openApp = (path: string): void => {
    void chrome.tabs.create({ url: `${DEFAULT_APP_URL}${path}` })
  }

  const tabTitle = typed === null ? pageTitle(page.data?.title) : null

  const body = ((): ReactNode => {
    switch (view.name) {
      case 'checking':
        return <Checking />
      case 'connect':
        return <Connect onOptions={openOptions} />
      case 'away':
        return <Away onRetry={() => void status.refetch()} onOptions={openOptions} />
      case 'paste':
        return (
          <Paste
            recent={(queue.data?.jobs ?? []).filter(each => each.status === 'done').slice(0, 5)}
            onLookUp={setTyped}
          />
        )
      case 'looking':
        return <Looking title={tabTitle} />
      case 'song':
        return (
          <SongForm
            key={view.item.url}
            item={view.item}
            cleanedFrom={cleanedFrom(tabTitle, view.item.title)}
            tagging={tagging}
            pending={enqueue.isPending}
            error={enqueue.error?.message ?? null}
            onImport={(request, label) => enqueue.mutate({ request, label })}
          />
        )
      case 'importing':
        return (
          <Importing
            job={view.job}
            cancelling={jobAction.isPending}
            onCancel={() => jobAction.mutate({ id: view.job.id, action: 'cancel' })}
          />
        )
      case 'added':
        return (
          <Added
            job={view.job}
            {...(batch && batch.total > 1 ? { count: batch.added } : {})}
            tagged={taggedLine(view.job.tagIds, choices.data?.tags ?? [])}
            onOpen={() => openApp('/import')}
          />
        )
      case 'failed': {
        const { jobId } = view
        return (
          <Failed
            message={view.message}
            canRetry={jobId !== null}
            retrying={jobAction.isPending || preview.isFetching}
            onRetry={() =>
              jobId ? jobAction.mutate({ id: jobId, action: 'retry' }) : void preview.refetch()
            }
          />
        )
      }
      case 'have':
        return (
          <Have
            title={view.title}
            artist={view.artist}
            cover={view.cover}
            line={view.hit ? sinceLine(view.hit, new Date()) : 'Already in your library'}
            onOpen={() => openApp('/')}
            onImportAnyway={() => setImportAnyway(true)}
          />
        )
      case 'request':
        return (
          <RequestForm
            key={view.link}
            link={view.link}
            list={view.list}
            title={tabTitle}
            tagging={tagging}
            pending={leave.isPending}
            error={leave.error?.message ?? null}
            onRequest={input => leave.mutate(input)}
          />
        )
      case 'waiting':
        return (
          <Waiting
            request={view.request}
            title={tabTitle}
            cancelling={callOff.isPending}
            onCancel={() => callOff.mutate(view.request.uid)}
          />
        )
      case 'requested':
        return <Requested request={view.request} onOpen={() => openApp('/import')} />
      case 'list':
        return (
          <ListReview
            key={link}
            preview={view.preview}
            tagging={tagging}
            pending={enqueue.isPending}
            error={enqueue.error?.message ?? null}
            onImport={(request, label) => enqueue.mutate({ request, label })}
            onOpenFull={() => openApp(`/import?url=${encodeURIComponent(link ?? '')}`)}
          />
        )
    }
  })()

  return (
    <div className="popup">
      <Header baseUrl={server?.baseUrl ?? null} connection={connection} onOptions={openOptions} />
      <main className="body">{body}</main>
      {ready && <QueueFooter queue={queue.data} onOpen={() => openApp('/import')} />}
      {viaBucket && (
        <BucketFooter
          waiting={
            (requests.data?.imports ?? []).filter(
              each => each.state === 'waiting' || each.state === 'working',
            ).length
          }
          onOpen={() => openApp('/import')}
        />
      )}
    </div>
  )
}
