import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  Info,
  Loader2,
  MessageSquare,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  X,
  XCircle,
} from 'lucide-react'
import { EmptyState } from '@/components/EmptyState'
import {
  createSqsQueue,
  deleteSqsMessage,
  deleteSqsQueue,
  getSqsQueueAttributes,
  listServiceResources,
  peekSqsMessages,
  purgeSqsQueue,
  sendSqsMessage,
} from '@/api/services'
import type { SqsQueueConfig } from '@/api/services'
import { timeAgo } from '@/lib/utils'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(Math.max(bytes, 1)) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

function formatSeconds(s: number): string {
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

// ─── Create queue modal ───────────────────────────────────────────────────────

function CreateQueueModal({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: (name: string, url: string) => void
}) {
  const [name, setName] = useState('')
  const [fifo, setFifo] = useState(false)
  const [visibilityTimeout, setVisibilityTimeout] = useState(30)
  const [retention, setRetention] = useState(345600)
  const [contentDedupe, setContentDedupe] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const effectiveName = fifo && !name.endsWith('.fifo') ? `${name}.fifo` : name

  const createMutation = useMutation({
    mutationFn: () => {
      const config: SqsQueueConfig = {
        fifo,
        visibilityTimeout,
        messageRetentionPeriod: retention,
        ...(fifo ? { contentBasedDeduplication: contentDedupe } : {}),
      }
      return createSqsQueue(effectiveName, config)
    },
    onSuccess: (url) => { onCreated(effectiveName, url || effectiveName); onClose() },
    onError: (e) => setErr(e instanceof Error ? e.message : 'Create failed'),
  })

  const valid = name.trim().length >= 1

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="create-table-modal">
        <h3>Create queue</h3>

        {/* Queue name */}
        <div className="modal-section">
          <p className="modal-section-title">Queue name</p>
          <input
            className="input"
            style={{ width: '100%', minWidth: 'unset' }}
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ''))}
            placeholder="my-queue"
            onKeyDown={(e) => e.key === 'Escape' && onClose()}
          />
          {fifo && name && (
            <p style={{ fontSize: 11, color: '#8d9cad', margin: '4px 0 0' }}>
              Full name: <span className="mono">{effectiveName}</span>
            </p>
          )}
        </div>

        {/* FIFO */}
        <div className="modal-section">
          <div className="field-row">
            <label className="toggle-switch" style={{ width: 32, height: 18, minWidth: 32 }}>
              <input type="checkbox" checked={fifo} onChange={(e) => setFifo(e.target.checked)} />
              <span className="toggle-track" />
            </label>
            <div>
              <p className="modal-section-title" style={{ margin: 0 }}>FIFO queue</p>
              <p style={{ fontSize: 11, color: '#5f7080', margin: '2px 0 0', lineHeight: 1.4 }}>
                Guarantees order and exactly-once processing
              </p>
            </div>
          </div>
          {fifo && (
            <div className="field-row" style={{ marginTop: 10 }}>
              <label className="toggle-switch" style={{ width: 32, height: 18, minWidth: 32 }}>
                <input type="checkbox" checked={contentDedupe} onChange={(e) => setContentDedupe(e.target.checked)} />
                <span className="toggle-track" />
              </label>
              <p className="modal-section-title" style={{ margin: 0 }}>Content-based deduplication</p>
            </div>
          )}
        </div>

        {/* Configuration */}
        <div className="modal-section">
          <p className="modal-section-title">Configuration</p>
          <div className="field-row">
            <label>Visibility timeout</label>
            <input
              className="input"
              type="number"
              min={0}
              max={43200}
              value={visibilityTimeout}
              onChange={(e) => setVisibilityTimeout(Number(e.target.value))}
            />
            <span style={{ fontSize: 11, color: '#5f7080', whiteSpace: 'nowrap' }}>seconds (0–43200)</span>
          </div>
          <div className="field-row">
            <label>Retention</label>
            <select
              className="input"
              value={retention}
              onChange={(e) => setRetention(Number(e.target.value))}
              style={{ flex: 1 }}
            >
              <option value={60}>1 minute</option>
              <option value={3600}>1 hour</option>
              <option value={86400}>1 day</option>
              <option value={345600}>4 days (default)</option>
              <option value={604800}>7 days</option>
              <option value={1209600}>14 days</option>
            </select>
          </div>
        </div>

        {err && <p style={{ fontSize: 12, color: '#f87171', margin: 0 }}>{err}</p>}

        <div className="modal-footer">
          <button className="button" onClick={onClose} disabled={createMutation.isPending}>Cancel</button>
          <button
            className="button primary"
            disabled={!valid || createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            {createMutation.isPending ? <Loader2 size={13} /> : <MessageSquare size={13} />}
            Create queue
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Send message panel ───────────────────────────────────────────────────────

function SendPanel({ queueUrl, onClose }: { queueUrl: string; onClose: () => void }) {
  const [body, setBody] = useState('')
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)

  const mutation = useMutation({
    mutationFn: () => sendSqsMessage(queueUrl, body),
    onSuccess: (messageId) => {
      setResult({ ok: true, text: `Sent · MessageId: ${messageId}` })
      setBody('')
    },
    onError: (err) => setResult({ ok: false, text: err instanceof Error ? err.message : 'Send failed' }),
  })

  return (
    <section className="widget send-panel">
      <div className="widget-header">
        <Send size={13} color="#8d9cad" />
        <h3>Send message</h3>
        <button
          className="icon-btn"
          style={{ marginLeft: 'auto' }}
          onClick={onClose}
        >
          <X size={13} />
        </button>
      </div>
      <div className="widget-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <textarea
          value={body}
          onChange={(e) => { setBody(e.target.value); setResult(null) }}
          placeholder='Message body — plain text or JSON, e.g. {"event":"test"}'
        />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            className="button primary"
            disabled={!body.trim() || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            <Send size={13} />
            {mutation.isPending ? 'Sending…' : 'Send'}
          </button>
          {result && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: result.ok ? '#4ade80' : '#f87171' }}>
              {result.ok ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
              {result.text}
            </span>
          )}
        </div>
      </div>
    </section>
  )
}

// ─── Peek + delete messages panel ────────────────────────────────────────────

function PeekPanel({ queueUrl }: { queueUrl: string }) {
  const [deletingHandles, setDeletingHandles] = useState<Set<string>>(new Set())

  const query = useQuery({
    queryKey: ['sqs-peek', queueUrl],
    queryFn: ({ signal }) => peekSqsMessages(queueUrl, 10, signal),
    enabled: false,
  })

  async function handleDeleteMessage(receiptHandle: string) {
    setDeletingHandles((prev) => new Set(prev).add(receiptHandle))
    try {
      await deleteSqsMessage(queueUrl, receiptHandle)
      void query.refetch()
    } catch (err) {
      alert(`Delete message failed: ${err instanceof Error ? err.message : err}`)
    } finally {
      setDeletingHandles((prev) => { const s = new Set(prev); s.delete(receiptHandle); return s })
    }
  }

  return (
    <section className="widget">
      <div className="widget-header">
        <Eye size={13} color="#8d9cad" />
        <h3>Messages</h3>
        {query.data && (
          <span style={{ fontSize: 11, color: '#5f7080', marginLeft: 4 }}>
            {query.data.length} peeked
          </span>
        )}
        <button
          className="button"
          style={{ marginLeft: 'auto' }}
          onClick={() => void query.refetch()}
          disabled={query.isFetching}
        >
          <Eye size={12} />
          {query.isFetching ? 'Peeking…' : 'Peek (up to 10)'}
        </button>
      </div>

      {query.isFetching ? (
        <div className="empty compact"><p>Fetching messages…</p></div>
      ) : query.isError ? (
        <div className="empty compact">
          <p style={{ color: '#f87171' }}>
            Failed to peek: {query.error instanceof Error ? query.error.message : 'Unknown error'}
          </p>
        </div>
      ) : !query.data ? (
        <div className="empty compact">
          <p>Click <strong>Peek</strong> to inspect queued messages without consuming them.</p>
        </div>
      ) : query.data.length === 0 ? (
        <div className="empty compact"><p>Queue is empty.</p></div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 180 }}>Message ID</th>
              <th>Body</th>
              <th style={{ width: 100 }}>Sent</th>
              <th style={{ width: 60 }}>Rcv #</th>
              <th style={{ width: 48 }} />
            </tr>
          </thead>
          <tbody>
            {query.data.map((msg) => {
              const isDeleting = deletingHandles.has(msg.receiptHandle)
              return (
                <tr key={msg.messageId} style={{ opacity: isDeleting ? 0.4 : 1 }}>
                  <td className="mono" style={{ fontSize: 11, color: '#5f7080' }}>
                    {msg.messageId.slice(0, 8)}…
                  </td>
                  <td
                    className="mono"
                    style={{ fontSize: 12, maxWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    title={msg.body}
                  >
                    {msg.body}
                  </td>
                  <td style={{ color: '#8d9cad' }}>{timeAgo(msg.sentTimestamp)}</td>
                  <td style={{ textAlign: 'right' }}>{msg.receiveCount ?? '—'}</td>
                  <td>
                    <button
                      className="icon-btn danger"
                      title="Delete message"
                      disabled={isDeleting}
                      onClick={() => void handleDeleteMessage(msg.receiptHandle)}
                    >
                      {isDeleting ? <Loader2 size={12} /> : <Trash2 size={12} />}
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </section>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function SQSPage() {
  const qc = useQueryClient()

  const [selected, setSelected] = useState<{ name: string; url: string } | null>(null)
  const [showSend, setShowSend] = useState(false)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [purgeConfirm, setPurgeConfirm] = useState(false)

  const queuesQuery = useQuery({
    queryKey: ['resources', 'sqs'],
    queryFn: ({ signal }) => listServiceResources('sqs', signal),
  })

  const attrQuery = useQuery({
    queryKey: ['sqs-attrs', selected?.url],
    queryFn: ({ signal }) => getSqsQueueAttributes(selected!.url, signal),
    enabled: Boolean(selected?.url),
  })

  // ── Mutations ──
  const deleteQueueMutation = useMutation({
    mutationFn: (url: string) => deleteSqsQueue(url),
    onSuccess: (_, url) => {
      if (selected?.url === url) setSelected(null)
      void qc.invalidateQueries({ queryKey: ['resources', 'sqs'] })
    },
    onError: (err) => alert(`Delete queue failed: ${err instanceof Error ? err.message : err}`),
  })

  const purgeQueueMutation = useMutation({
    mutationFn: (url: string) => purgeSqsQueue(url),
    onSuccess: () => {
      setPurgeConfirm(false)
      void qc.invalidateQueries({ queryKey: ['sqs-peek', selected?.url] })
      void attrQuery.refetch()
    },
    onError: (err) => alert(`Purge failed: ${err instanceof Error ? err.message : err}`),
  })

  function selectQueue(name: string, url: string) {
    setSelected({ name, url })
    setShowSend(false)
    setPurgeConfirm(false)
  }

  function handleDeleteQueue() {
    if (!selected) return
    if (!window.confirm(`Delete queue "${selected.name}"?\n\nAll messages will be permanently lost.`)) return
    deleteQueueMutation.mutate(selected.url)
  }

  return (
    <>
      {showCreateModal && (
        <CreateQueueModal
          onClose={() => setShowCreateModal(false)}
          onCreated={(name, url) => {
            void qc.invalidateQueries({ queryKey: ['resources', 'sqs'] })
            selectQueue(name, url)
          }}
        />
      )}

      <div className="page-header">
        <div className="page-title">
          <h2>SQS</h2>
          <span className="info-link">
            <Info size={11} />
            Simple Queue Service
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {selected && (
            <>
              <button className="button primary" onClick={() => setShowSend((v) => !v)}>
                <Send size={13} />
                {showSend ? 'Hide send' : 'Send message'}
              </button>
              <button
                className="button"
                style={{ color: '#f59e0b', borderColor: 'rgba(245,158,11,0.4)' }}
                onClick={() => setPurgeConfirm(true)}
                disabled={purgeQueueMutation.isPending}
                title="Delete all messages in the queue"
              >
                {purgeQueueMutation.isPending ? <Loader2 size={13} /> : <AlertTriangle size={13} />}
                Purge
              </button>
              <button
                className="button danger"
                onClick={handleDeleteQueue}
                disabled={deleteQueueMutation.isPending}
              >
                {deleteQueueMutation.isPending ? <Loader2 size={13} /> : <Trash2 size={13} />}
                Delete queue
              </button>
            </>
          )}
          <button className="button" onClick={() => void queuesQuery.refetch()}>
            <RefreshCw size={13} />
            Refresh
          </button>
        </div>
      </div>

      <div className="split">
        {/* ── Left: queue list ── */}
        <aside className="list-pane">
          <div className="widget-header">
            <MessageSquare size={13} color="#8d9cad" />
            <h3>Queues ({queuesQuery.data?.length ?? 0})</h3>
            <button
              className="icon-btn"
              style={{ marginLeft: 'auto' }}
              title="Create queue"
              onClick={() => setShowCreateModal(true)}
            >
              <Plus size={13} />
            </button>
          </div>

          {queuesQuery.isLoading ? (
            <div className="empty"><p>Loading queues…</p></div>
          ) : queuesQuery.isError ? (
            <EmptyState icon={MessageSquare} title="Cannot load queues" description="SQS did not respond from the Floci endpoint." />
          ) : (queuesQuery.data ?? []).length === 0 ? (
            <EmptyState icon={MessageSquare} title="No queues" description="Click + above to create a queue." />
          ) : (
            (queuesQuery.data ?? []).map((queue) => {
              const queueUrl = (queue.metadata?.queueUrl as string | undefined) ?? queue.id
              return (
                <div
                  key={queue.id}
                  className={`list-item ${selected?.name === queue.name ? 'active' : ''}`}
                  style={{ cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                  onClick={() => selectQueue(queue.name, queueUrl)}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <strong>{queue.name}</strong>
                    <span style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}>
                      {queueUrl}
                    </span>
                  </div>
                  <button
                    className="icon-btn danger bucket-action-btn"
                    title="Delete queue"
                    onClick={(e) => {
                      e.stopPropagation()
                      if (!window.confirm(`Delete queue "${queue.name}"?`)) return
                      deleteQueueMutation.mutate(queueUrl)
                    }}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              )
            })
          )}
        </aside>

        {/* ── Right: queue detail ── */}
        <section className="detail-pane">
          {!selected ? (
            <div className="empty" style={{ minHeight: 400 }}>
              <div className="empty-icon"><MessageSquare size={24} /></div>
              <h3>Select a queue</h3>
              <p>Choose a queue from the list, or click + to create one.</p>
            </div>
          ) : (
            <>
              {/* Queue name header */}
              <div className="page-header" style={{ borderBottom: 'none' }}>
                <div className="page-title">
                  <h2 style={{ fontSize: 16 }}>{selected.name}</h2>
                  {attrQuery.data?.fifoQueue && (
                    <span style={{ fontSize: 11, padding: '2px 6px', border: '1px solid #2d3f57', borderRadius: 4, color: '#539fe5' }}>
                      FIFO
                    </span>
                  )}
                </div>
                <button className="button" onClick={() => void attrQuery.refetch()}>
                  <RefreshCw size={13} />
                  Refresh
                </button>
              </div>

              {/* Purge confirm banner */}
              {purgeConfirm && (
                <div style={{ margin: '0 20px', padding: '12px 14px', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.35)', borderRadius: 6, display: 'flex', gap: 12, alignItems: 'center' }}>
                  <AlertTriangle size={14} color="#f59e0b" />
                  <span style={{ fontSize: 13, color: '#fcd34d', flex: 1 }}>
                    Purge will permanently delete <strong>all messages</strong> in <strong>{selected.name}</strong>.
                  </span>
                  <button
                    className="button"
                    style={{ color: '#f59e0b', borderColor: 'rgba(245,158,11,0.4)' }}
                    disabled={purgeQueueMutation.isPending}
                    onClick={() => purgeQueueMutation.mutate(selected.url)}
                  >
                    {purgeQueueMutation.isPending ? <Loader2 size={13} /> : null}
                    Yes, purge
                  </button>
                  <button className="button" onClick={() => setPurgeConfirm(false)}>Cancel</button>
                </div>
              )}

              <div className="content" style={{ paddingTop: 12 }}>
                <div className="grid" style={{ gap: 14 }}>

                  {/* Send panel */}
                  {showSend && <SendPanel queueUrl={selected.url} onClose={() => setShowSend(false)} />}

                  {/* Attributes */}
                  {attrQuery.isLoading ? (
                    <div className="empty"><p>Loading attributes…</p></div>
                  ) : attrQuery.isError ? (
                    <EmptyState icon={MessageSquare} title="Cannot load attributes" description="Failed to fetch queue attributes." />
                  ) : (
                    <div className="grid two">
                      <section className="widget">
                        <div className="widget-header"><h3>Message counts</h3></div>
                        <div className="widget-body">
                          <div className="metric-grid">
                            <div>
                              <p className="metric-label">Available</p>
                              <p className="metric-value" style={{ color: (attrQuery.data?.approximateNumberOfMessages ?? 0) > 0 ? '#4ade80' : undefined }}>
                                {attrQuery.data?.approximateNumberOfMessages ?? 0}
                              </p>
                            </div>
                            <div>
                              <p className="metric-label">In-flight</p>
                              <p className="metric-value">{attrQuery.data?.approximateNumberOfMessagesNotVisible ?? 0}</p>
                            </div>
                            <div>
                              <p className="metric-label">Delayed</p>
                              <p className="metric-value">{attrQuery.data?.approximateNumberOfMessagesDelayed ?? 0}</p>
                            </div>
                            <div>
                              <p className="metric-label">Deduplication</p>
                              <p className="metric-value">{attrQuery.data?.contentBasedDeduplication ? 'Content-based' : 'Off'}</p>
                            </div>
                          </div>
                        </div>
                      </section>

                      <section className="widget">
                        <div className="widget-header"><h3>Configuration</h3></div>
                        <div className="widget-body">
                          <div className="metric-grid">
                            <div>
                              <p className="metric-label">Visibility timeout</p>
                              <p className="metric-value">
                                {attrQuery.data?.visibilityTimeout !== undefined ? formatSeconds(attrQuery.data.visibilityTimeout) : '—'}
                              </p>
                            </div>
                            <div>
                              <p className="metric-label">Max msg size</p>
                              <p className="metric-value">
                                {attrQuery.data?.maximumMessageSize !== undefined ? formatBytes(attrQuery.data.maximumMessageSize) : '—'}
                              </p>
                            </div>
                            <div>
                              <p className="metric-label">Retention</p>
                              <p className="metric-value">
                                {attrQuery.data?.messageRetentionPeriod !== undefined ? formatSeconds(attrQuery.data.messageRetentionPeriod) : '—'}
                              </p>
                            </div>
                            <div>
                              <p className="metric-label">Receive wait</p>
                              <p className="metric-value">
                                {attrQuery.data?.receiveMessageWaitTimeSeconds !== undefined ? `${attrQuery.data.receiveMessageWaitTimeSeconds}s` : '—'}
                              </p>
                            </div>
                          </div>
                        </div>
                      </section>

                      <section className="widget span-two">
                        <div className="widget-header"><h3>Queue URL</h3></div>
                        <div className="widget-body">
                          <code className="mono" style={{ wordBreak: 'break-all', color: '#539fe5', fontSize: 12 }}>
                            {selected.url}
                          </code>
                        </div>
                      </section>
                    </div>
                  )}

                  {/* Peek messages */}
                  <PeekPanel key={selected.url} queueUrl={selected.url} />
                </div>
              </div>
            </>
          )}
        </section>
      </div>
    </>
  )
}
