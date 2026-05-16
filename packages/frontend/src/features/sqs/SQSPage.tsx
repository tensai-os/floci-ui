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
  getSqsQueueTags,
  listSqsDeadLetterSources,
  listSqsMoveTasks,
  setSqsQueueAttributes,
  setSqsQueueTags,
  removeSqsQueueTags,
  listServiceResources,
  peekSqsMessages,
  purgeSqsQueue,
  sendSqsMessage,
  sendSqsMessageBatch,
  startSqsRedrive,
} from '@/api/services'
import type { SqsQueueAttributes, SqsQueueConfig, SqsTag } from '@/api/services'
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

function SendPanel({ queueUrl, fifo, contentBasedDedup, onClose }: {
  queueUrl: string
  fifo: boolean
  contentBasedDedup: boolean
  onClose: () => void
}) {
  const [body, setBody] = useState('')
  const [batch, setBatch] = useState(false)
  const [groupId, setGroupId] = useState('')
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)

  const batchLines = body.split('\n').map((l) => l.trim()).filter(Boolean)
  const overLimit = batch && batchLines.length > 10

  const mutation = useMutation({
    mutationFn: async (): Promise<{ ok: boolean; text: string }> => {
      const options = fifo
        ? { messageGroupId: groupId.trim() || 'default', contentBasedDedup }
        : {}
      if (batch) {
        const messages = batchLines.slice(0, 10)
        if (messages.length === 0) throw new Error('Enter at least one non-empty line')
        const res = await sendSqsMessageBatch(queueUrl, messages, options)
        if (res.failed.length > 0) {
          return { ok: false, text: `${res.successful.length} sent, ${res.failed.length} failed` }
        }
        return { ok: true, text: `Batch sent · ${res.successful.length} message(s)` }
      }
      const messageId = await sendSqsMessage(queueUrl, body, options)
      return { ok: true, text: `Sent · MessageId: ${messageId}` }
    },
    onSuccess: (r) => { setResult(r); if (r.ok) setBody('') },
    onError: (err) => setResult({ ok: false, text: err instanceof Error ? err.message : 'Send failed' }),
  })

  return (
    <section className="widget send-panel">
      <div className="widget-header">
        <Send size={13} color="#8d9cad" />
        <h3>Send message{batch ? 's (batch)' : ''}</h3>
        <label style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#8d9cad' }}>
          <input type="checkbox" checked={batch} onChange={(e) => { setBatch(e.target.checked); setResult(null) }} />
          Batch mode
        </label>
        <button className="icon-btn" onClick={onClose}>
          <X size={13} />
        </button>
      </div>
      <div className="widget-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <textarea
          value={body}
          onChange={(e) => { setBody(e.target.value); setResult(null) }}
          placeholder={batch
            ? 'One message per line — up to 10 messages sent as a batch'
            : 'Message body — plain text or JSON, e.g. {"event":"test"}'}
        />
        {fifo && (
          <input
            className="input"
            value={groupId}
            onChange={(e) => setGroupId(e.target.value)}
            placeholder="Message group ID (FIFO) — defaults to 'default'"
          />
        )}
        {overLimit && (
          <p style={{ fontSize: 12, color: '#f59e0b', margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
            <AlertTriangle size={13} />
            {batchLines.length} lines — SQS caps a batch at 10; only the first 10 will be sent.
          </p>
        )}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            className="button primary"
            disabled={!body.trim() || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            <Send size={13} />
            {mutation.isPending
              ? 'Sending…'
              : batch
                ? `Send batch${batchLines.length ? ` (${Math.min(batchLines.length, 10)})` : ''}`
                : 'Send'}
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

// ─── Queue tags panel ─────────────────────────────────────────────────────────

function QueueTagsPanel({ queueUrl }: { queueUrl: string }) {
  const qc = useQueryClient()
  const [editKey, setEditKey] = useState('')
  const [editVal, setEditVal] = useState('')
  const [err, setErr] = useState('')

  const tagsQuery = useQuery({
    queryKey: ['sqs-tags', queueUrl],
    queryFn: ({ signal }) => getSqsQueueTags(queueUrl, signal),
    staleTime: 30_000,
  })

  const saveMut = useMutation({
    mutationFn: (tags: SqsTag[]) => setSqsQueueTags(queueUrl, tags),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sqs-tags', queueUrl] }),
    onError: (e) => setErr(e instanceof Error ? e.message : 'Save failed'),
  })

  const removeMut = useMutation({
    mutationFn: (key: string) => removeSqsQueueTags(queueUrl, [key]),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sqs-tags', queueUrl] }),
    onError: (e) => setErr(e instanceof Error ? e.message : 'Remove failed'),
  })

  function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    const k = editKey.trim()
    const v = editVal.trim()
    if (!k) return setErr('Key is required')
    saveMut.mutate([...(tagsQuery.data ?? []).filter((t) => t.key !== k), { key: k, value: v }])
    setEditKey('')
    setEditVal('')
    setErr('')
  }

  const tags = tagsQuery.data ?? []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {tagsQuery.isLoading ? (
        <div className="empty compact"><p>Loading tags…</p></div>
      ) : tags.length === 0 ? (
        <p style={{ fontSize: 12, color: 'var(--text-3)', margin: 0 }}>No tags on this queue.</p>
      ) : (
        <table className="table">
          <thead><tr><th>Key</th><th>Value</th><th style={{ width: 40 }} /></tr></thead>
          <tbody>
            {tags.map((tag) => (
              <tr key={tag.key}>
                <td className="mono" style={{ color: '#fbbf24' }}>{tag.key}</td>
                <td className="mono">{tag.value}</td>
                <td>
                  <button
                    className="icon-btn danger"
                    disabled={removeMut.isPending}
                    onClick={() => removeMut.mutate(tag.key)}
                  >
                    {removeMut.isPending ? <Loader2 size={12} className="spin" /> : <Trash2 size={12} />}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <form onSubmit={handleAdd} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input className="input" style={{ flex: 1 }} placeholder="Key" value={editKey} onChange={(e) => { setEditKey(e.target.value); setErr('') }} />
        <input className="input" style={{ flex: 1 }} placeholder="Value" value={editVal} onChange={(e) => setEditVal(e.target.value)} />
        <button type="submit" className="button primary" disabled={saveMut.isPending}>
          {saveMut.isPending ? <Loader2 size={13} className="spin" /> : <Plus size={13} />}
          Add
        </button>
      </form>
      {err && <p style={{ fontSize: 12, color: '#f87171', margin: 0 }}>{err}</p>}
    </div>
  )
}

// ─── Dead-letter queue panel ──────────────────────────────────────────────────

function DLQPanel({ queueUrl, queues }: { queueUrl: string; queues: Array<{ name: string; url: string }> }) {
  const qc = useQueryClient()
  const [targetUrl, setTargetUrl] = useState('')
  const [maxReceive, setMaxReceive] = useState(3)
  const [err, setErr] = useState('')

  const attrQuery = useQuery({
    queryKey: ['sqs-attrs', queueUrl],
    queryFn: ({ signal }) => getSqsQueueAttributes(queueUrl, signal),
  })

  const saveMut = useMutation({
    mutationFn: async () => {
      const target = queues.find((q) => q.url === targetUrl)
      if (!target) throw new Error('Select a dead-letter target queue')
      const targetAttrs = await getSqsQueueAttributes(target.url)
      if (!targetAttrs.queueArn) throw new Error('Could not resolve the target queue ARN')
      await setSqsQueueAttributes(queueUrl, {
        RedrivePolicy: JSON.stringify({
          deadLetterTargetArn: targetAttrs.queueArn,
          maxReceiveCount: maxReceive,
        }),
      })
    },
    onSuccess: () => { setErr(''); void qc.invalidateQueries({ queryKey: ['sqs-attrs', queueUrl] }) },
    onError: (e) => setErr(e instanceof Error ? e.message : 'Save failed'),
  })

  const removeMut = useMutation({
    mutationFn: () => setSqsQueueAttributes(queueUrl, { RedrivePolicy: '' }),
    onSuccess: () => { setErr(''); void qc.invalidateQueries({ queryKey: ['sqs-attrs', queueUrl] }) },
    onError: (e) => setErr(e instanceof Error ? e.message : 'Remove failed'),
  })

  const redriveTasks = useQuery({
    queryKey: ['sqs-move-tasks', queueUrl],
    queryFn: ({ signal }) => {
      const arn = attrQuery.data?.queueArn
      return arn ? listSqsMoveTasks(arn, signal) : Promise.resolve([])
    },
    enabled: Boolean(attrQuery.data?.queueArn),
  })

  const redriveMut = useMutation({
    mutationFn: () => {
      const arn = attrQuery.data?.queueArn
      if (!arn) throw new Error('Queue ARN is not available yet')
      return startSqsRedrive(arn)
    },
    onSuccess: () => { setErr(''); void qc.invalidateQueries({ queryKey: ['sqs-move-tasks', queueUrl] }) },
    onError: (e) => setErr(e instanceof Error ? e.message : 'Redrive failed'),
  })

  const sourcesQuery = useQuery({
    queryKey: ['sqs-dlq-sources', queueUrl],
    queryFn: ({ signal }) => listSqsDeadLetterSources(queueUrl, signal),
  })

  const current = attrQuery.data?.redrivePolicy
  const others = queues.filter((q) => q.url !== queueUrl)
  const sourceQueues = sourcesQuery.data ?? []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <section className="widget">
        <div className="widget-header"><h3>Dead-letter queue</h3></div>
        <div className="widget-body">
          {attrQuery.isLoading ? (
            <p style={{ fontSize: 12, color: 'var(--text-3)', margin: 0 }}>Loading…</p>
          ) : current ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 13, margin: 0 }}>
                  Failed messages move to{' '}
                  <span className="mono" style={{ color: '#539fe5' }}>
                    {current.deadLetterTargetArn.split(':').pop()}
                  </span>
                </p>
                <p style={{ fontSize: 11, color: '#5f7080', margin: '2px 0 0' }}>
                  After {current.maxReceiveCount} failed receive(s)
                </p>
              </div>
              <button className="button danger" disabled={removeMut.isPending} onClick={() => removeMut.mutate()}>
                {removeMut.isPending ? <Loader2 size={13} /> : <Trash2 size={13} />}
                Remove
              </button>
            </div>
          ) : (
            <p style={{ fontSize: 12, color: 'var(--text-3)', margin: 0 }}>
              No dead-letter queue configured for this queue.
            </p>
          )}
        </div>
      </section>

      <section className="widget">
        <div className="widget-header"><h3>{current ? 'Update' : 'Configure'} dead-letter queue</h3></div>
        <div className="widget-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="field-row">
            <label>Target queue</label>
            <select className="input" style={{ flex: 1 }} value={targetUrl} onChange={(e) => setTargetUrl(e.target.value)}>
              <option value="">Select a queue…</option>
              {others.map((q) => <option key={q.url} value={q.url}>{q.name}</option>)}
            </select>
          </div>
          <div className="field-row">
            <label>Max receive count</label>
            <input
              className="input"
              type="number"
              min={1}
              max={1000}
              value={maxReceive}
              onChange={(e) => setMaxReceive(Number(e.target.value))}
            />
            <span style={{ fontSize: 11, color: '#5f7080', whiteSpace: 'nowrap' }}>receives before redrive</span>
          </div>
          <div>
            <button
              className="button primary"
              disabled={!targetUrl || maxReceive < 1 || saveMut.isPending}
              onClick={() => saveMut.mutate()}
            >
              {saveMut.isPending ? <Loader2 size={13} /> : <CheckCircle2 size={13} />}
              Save dead-letter queue
            </button>
          </div>
          {err && <p style={{ fontSize: 12, color: '#f87171', margin: 0 }}>{err}</p>}
          {others.length === 0 && (
            <p style={{ fontSize: 12, color: 'var(--text-3)', margin: 0 }}>
              Create another queue to use as the dead-letter target.
            </p>
          )}
        </div>
      </section>

      <section className="widget">
        <div className="widget-header">
          <h3>Redrive messages</h3>
          <button
            className="button"
            style={{ marginLeft: 'auto' }}
            disabled={redriveMut.isPending || !attrQuery.data?.queueArn || sourceQueues.length === 0}
            onClick={() => redriveMut.mutate()}
          >
            {redriveMut.isPending ? <Loader2 size={13} /> : <RefreshCw size={13} />}
            Start redrive
          </button>
        </div>
        <div className="widget-body">
          {sourcesQuery.isLoading ? (
            <p style={{ fontSize: 12, color: 'var(--text-3)', margin: 0 }}>Loading…</p>
          ) : sourceQueues.length === 0 ? (
            <p style={{ fontSize: 12, color: 'var(--text-3)', margin: 0 }}>
              No queues use this queue as their dead-letter queue, so there is nothing to redrive.
            </p>
          ) : (
            <>
              <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '0 0 8px' }}>
                Dead-letter queue for {sourceQueues.length} source queue(s) — redrive moves messages back to them.
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                {sourceQueues.map((q) => (
                  <span
                    key={q.url}
                    className="mono"
                    style={{ fontSize: 11, padding: '2px 8px', border: '1px solid #2d3f57', borderRadius: 4, color: '#539fe5' }}
                  >
                    {q.name}
                  </span>
                ))}
              </div>
              {(redriveTasks.data ?? []).length === 0 ? (
                <p style={{ fontSize: 12, color: 'var(--text-3)', margin: 0 }}>No redrive tasks yet.</p>
              ) : (
                <table className="table">
                  <thead>
                    <tr><th>Status</th><th>Moved</th><th>To move</th><th>Started</th></tr>
                  </thead>
                  <tbody>
                    {(redriveTasks.data ?? []).map((t, i) => (
                      <tr key={i}>
                        <td>{t.status ?? '—'}</td>
                        <td>{t.approximateNumberOfMessagesMoved ?? 0}</td>
                        <td>{t.approximateNumberOfMessagesToMove ?? '—'}</td>
                        <td style={{ color: '#8d9cad' }}>{timeAgo(t.startedTimestamp)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  )
}

// ─── Queue settings panel ─────────────────────────────────────────────────────

function QueueSettingsPanel({ queueUrl }: { queueUrl: string }) {
  const attrQuery = useQuery({
    queryKey: ['sqs-attrs', queueUrl],
    queryFn: ({ signal }) => getSqsQueueAttributes(queueUrl, signal),
  })

  if (attrQuery.isLoading) return <div className="empty compact"><p>Loading settings…</p></div>
  if (!attrQuery.data) {
    return <EmptyState icon={MessageSquare} title="Cannot load settings" description="Failed to fetch queue attributes." />
  }
  return <SettingsForm key={queueUrl} queueUrl={queueUrl} attrs={attrQuery.data} />
}

function SettingsForm({ queueUrl, attrs }: { queueUrl: string; attrs: SqsQueueAttributes }) {
  const qc = useQueryClient()
  const [visibilityTimeout, setVisibilityTimeout] = useState(attrs.visibilityTimeout ?? 30)
  const [retention, setRetention] = useState(attrs.messageRetentionPeriod ?? 345600)
  const [delay, setDelay] = useState(attrs.delaySeconds ?? 0)
  const [maxSize, setMaxSize] = useState(attrs.maximumMessageSize ?? 262144)
  const [waitTime, setWaitTime] = useState(attrs.receiveMessageWaitTimeSeconds ?? 0)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)

  const saveMut = useMutation({
    mutationFn: () => setSqsQueueAttributes(queueUrl, {
      VisibilityTimeout: String(visibilityTimeout),
      MessageRetentionPeriod: String(retention),
      DelaySeconds: String(delay),
      MaximumMessageSize: String(maxSize),
      ReceiveMessageWaitTimeSeconds: String(waitTime),
    }),
    onSuccess: () => {
      setResult({ ok: true, text: 'Settings saved' })
      void qc.invalidateQueries({ queryKey: ['sqs-attrs', queueUrl] })
    },
    onError: (e) => setResult({ ok: false, text: e instanceof Error ? e.message : 'Save failed' }),
  })

  return (
    <section className="widget">
      <div className="widget-header"><h3>Queue configuration</h3></div>
      <div className="widget-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="field-row">
          <label>Visibility timeout</label>
          <input className="input" type="number" min={0} max={43200} value={visibilityTimeout}
            onChange={(e) => { setVisibilityTimeout(Number(e.target.value)); setResult(null) }} />
          <span style={{ fontSize: 11, color: '#5f7080', whiteSpace: 'nowrap' }}>seconds (0–43200)</span>
        </div>
        <div className="field-row">
          <label>Delivery delay</label>
          <input className="input" type="number" min={0} max={900} value={delay}
            onChange={(e) => { setDelay(Number(e.target.value)); setResult(null) }} />
          <span style={{ fontSize: 11, color: '#5f7080', whiteSpace: 'nowrap' }}>seconds (0–900)</span>
        </div>
        <div className="field-row">
          <label>Receive wait time</label>
          <input className="input" type="number" min={0} max={20} value={waitTime}
            onChange={(e) => { setWaitTime(Number(e.target.value)); setResult(null) }} />
          <span style={{ fontSize: 11, color: '#5f7080', whiteSpace: 'nowrap' }}>seconds (0–20, long polling)</span>
        </div>
        <div className="field-row">
          <label>Max message size</label>
          <input className="input" type="number" min={1024} max={262144} step={1024} value={maxSize}
            onChange={(e) => { setMaxSize(Number(e.target.value)); setResult(null) }} />
          <span style={{ fontSize: 11, color: '#5f7080', whiteSpace: 'nowrap' }}>bytes (1024–262144)</span>
        </div>
        <div className="field-row">
          <label>Retention</label>
          <input className="input" type="number" min={60} max={1209600} value={retention}
            onChange={(e) => { setRetention(Number(e.target.value)); setResult(null) }} />
          <span style={{ fontSize: 11, color: '#5f7080', whiteSpace: 'nowrap' }}>seconds (60–1209600)</span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="button primary" disabled={saveMut.isPending} onClick={() => saveMut.mutate()}>
            {saveMut.isPending ? <Loader2 size={13} /> : <CheckCircle2 size={13} />}
            Save settings
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

// ─── Page ─────────────────────────────────────────────────────────────────────

export function SQSPage() {
  const qc = useQueryClient()

  const [selected, setSelected] = useState<{ name: string; url: string } | null>(null)
  const [showSend, setShowSend] = useState(false)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [purgeConfirm, setPurgeConfirm] = useState(false)
  const [detailTab, setDetailTab] = useState<'overview' | 'tags' | 'dlq' | 'settings'>('overview')

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
    setDetailTab('overview')
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

              {/* Tabs */}
              <div className="sns-tabs" style={{ paddingLeft: 20 }}>
                <button className={`sns-tab${detailTab === 'overview' ? ' active' : ''}`} onClick={() => setDetailTab('overview')}>Overview</button>
                <button className={`sns-tab${detailTab === 'tags' ? ' active' : ''}`} onClick={() => setDetailTab('tags')}>Tags</button>
                <button className={`sns-tab${detailTab === 'dlq' ? ' active' : ''}`} onClick={() => setDetailTab('dlq')}>Dead-letter queue</button>
                <button className={`sns-tab${detailTab === 'settings' ? ' active' : ''}`} onClick={() => setDetailTab('settings')}>Settings</button>
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

              {detailTab === 'tags' && (
                <div className="content" style={{ paddingTop: 12 }}>
                  <QueueTagsPanel key={selected.url} queueUrl={selected.url} />
                </div>
              )}

              {detailTab === 'dlq' && (
                <div className="content" style={{ paddingTop: 12 }}>
                  <DLQPanel
                    key={selected.url}
                    queueUrl={selected.url}
                    queues={(queuesQuery.data ?? []).map((q) => ({
                      name: q.name,
                      url: (q.metadata?.queueUrl as string | undefined) ?? q.id,
                    }))}
                  />
                </div>
              )}

              {detailTab === 'settings' && (
                <div className="content" style={{ paddingTop: 12 }}>
                  <QueueSettingsPanel key={selected.url} queueUrl={selected.url} />
                </div>
              )}

              {detailTab === 'overview' && <div className="content" style={{ paddingTop: 12 }}>
                <div className="grid" style={{ gap: 14 }}>

                  {/* Send panel */}
                  {showSend && (
                    <SendPanel
                      queueUrl={selected.url}
                      fifo={attrQuery.data?.fifoQueue ?? false}
                      contentBasedDedup={attrQuery.data?.contentBasedDeduplication ?? false}
                      onClose={() => setShowSend(false)}
                    />
                  )}

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
              </div>}
            </>
          )}
        </section>
      </div>
    </>
  )
}
