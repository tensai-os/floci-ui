import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ChevronDown,
  ChevronUp,
  Info,
  Loader2,
  Play,
  RefreshCw,
  Search,
  Trash2,
  X,
  Zap,
} from 'lucide-react'
import { EmptyState } from '@/components/EmptyState'
import {
  deleteLambdaFunction,
  getLambdaFunction,
  invokeLambdaFunction,
  listServiceResources,
} from '@/api/services'
import type { LambdaInvokeResult } from '@/api/services'
import { timeAgo } from '@/lib/utils'

// ─── Runtime badge ────────────────────────────────────────────────────────────

const RUNTIME_COLORS: Record<string, { bg: string; color: string }> = {
  python:   { bg: 'rgba(59,130,246,0.18)',  color: '#60a5fa' },
  nodejs:   { bg: 'rgba(34,197,94,0.18)',   color: '#4ade80' },
  node:     { bg: 'rgba(34,197,94,0.18)',   color: '#4ade80' },
  java:     { bg: 'rgba(239,68,68,0.18)',   color: '#f87171' },
  go:       { bg: 'rgba(6,182,212,0.18)',   color: '#22d3ee' },
  dotnet:   { bg: 'rgba(168,85,247,0.18)', color: '#c084fc' },
  provided: { bg: 'rgba(249,115,22,0.18)', color: '#fb923c' },
  ruby:     { bg: 'rgba(236,72,153,0.18)', color: '#f472b6' },
}

function runtimeStyle(runtime?: string) {
  if (!runtime) return { bg: 'rgba(107,114,128,0.18)', color: '#9ca3af' }
  const key = Object.keys(RUNTIME_COLORS).find((k) => runtime.toLowerCase().startsWith(k))
  return key ? RUNTIME_COLORS[key] : { bg: 'rgba(107,114,128,0.18)', color: '#9ca3af' }
}

function RuntimeBadge({ runtime }: { runtime?: string }) {
  if (!runtime) return null
  const { bg, color } = runtimeStyle(runtime)
  return <span className="badge" style={{ background: bg, color }}>{runtime}</span>
}

// ─── State badge ──────────────────────────────────────────────────────────────

const STATE_STYLES: Record<string, { bg: string; color: string; dot: string }> = {
  active:   { bg: 'rgba(34,197,94,0.14)',  color: '#4ade80', dot: '#22c55e' },
  pending:  { bg: 'rgba(245,158,11,0.14)', color: '#fbbf24', dot: '#f59e0b' },
  failed:   { bg: 'rgba(239,68,68,0.14)',  color: '#f87171', dot: '#ef4444' },
  inactive: { bg: 'rgba(107,114,128,0.14)', color: '#9ca3af', dot: '#6b7280' },
}

function StateBadge({ state }: { state?: string }) {
  const key = (state ?? 'active').toLowerCase()
  const style = STATE_STYLES[key] ?? STATE_STYLES.active
  return (
    <span className="badge" style={{ background: style.bg, color: style.color }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: style.dot, display: 'inline-block' }} />
      {state ?? 'Active'}
    </span>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatBytes(bytes?: number): string {
  if (!bytes) return '—'
  const k = 1024
  const sizes = ['B', 'KB', 'MB']
  const i = Math.floor(Math.log(Math.max(bytes, 1)) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

function tryFormatJson(raw: string): string {
  try { return JSON.stringify(JSON.parse(raw), null, 2) } catch { return raw }
}

function buildFn(r: {
  id: string
  name: string
  status?: string
  description?: string
  metadata?: Record<string, unknown>
}) {
  return {
    id: r.id,
    name: r.name,
    state: r.status,
    description:
      r.description?.includes('/') || r.description?.includes('::') ? undefined : r.description,
    runtime: r.metadata?.runtime as string | undefined,
    handler: r.metadata?.handler as string | undefined,
    memoryMb: r.metadata?.memoryMb as number | undefined,
    timeoutSec: r.metadata?.timeoutSec as number | undefined,
    codeSize: r.metadata?.codeSize as number | undefined,
    lastModified: r.metadata?.lastModified as string | undefined,
  }
}

// ─── Function card ────────────────────────────────────────────────────────────

function FnCard({
  fn,
  selected,
  onClick,
}: {
  fn: ReturnType<typeof buildFn>
  selected: boolean
  onClick: () => void
}) {
  return (
    <div
      className={`fn-card ${selected ? 'selected' : ''}`}
      style={{ cursor: 'pointer' }}
      onClick={onClick}
    >
      <div className="fn-card-name">
        <Zap size={14} color="#ff9900" style={{ flexShrink: 0, marginTop: 2 }} />
        <h3>{fn.name}</h3>
      </div>

      {fn.description && (
        <p style={{ margin: 0, fontSize: 11, color: '#5f7080', lineHeight: 1.4 }}>
          {fn.description}
        </p>
      )}

      <div className="fn-badges">
        <RuntimeBadge runtime={fn.runtime} />
        <StateBadge state={fn.state} />
      </div>

      <div className="fn-meta">
        <div className="fn-meta-item">
          <span className="fn-meta-label">Handler</span>
          <span className="fn-meta-value">{fn.handler ?? '—'}</span>
        </div>
        <div className="fn-meta-item">
          <span className="fn-meta-label">Memory</span>
          <span className="fn-meta-value">{fn.memoryMb ? `${fn.memoryMb} MB` : '—'}</span>
        </div>
        <div className="fn-meta-item">
          <span className="fn-meta-label">Timeout</span>
          <span className="fn-meta-value">{fn.timeoutSec ? `${fn.timeoutSec}s` : '—'}</span>
        </div>
        <div className="fn-meta-item">
          <span className="fn-meta-label">Code size</span>
          <span className="fn-meta-value">{formatBytes(fn.codeSize)}</span>
        </div>
        <div className="fn-meta-item" style={{ gridColumn: 'span 2' }}>
          <span className="fn-meta-label">Last modified</span>
          <span className="fn-meta-value" style={{ color: '#8d9cad' }}>{timeAgo(fn.lastModified)}</span>
        </div>
      </div>
    </div>
  )
}

// ─── Function detail drawer ───────────────────────────────────────────────────

function FunctionDrawer({
  functionName,
  onClose,
  onDeleted,
}: {
  functionName: string | null
  onClose: () => void
  onDeleted: () => void
}) {
  const qc = useQueryClient()
  const [tab, setTab] = useState<'details' | 'invoke'>('details')
  const [payload, setPayload] = useState('{\n  \n}')
  const [invokeResult, setInvokeResult] = useState<LambdaInvokeResult | null>(null)
  const [showLog, setShowLog] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)

  // Reset when function changes (via key prop)
  useEffect(() => {
    setTab('details')
    setPayload('{\n  \n}')
    setInvokeResult(null)
    setShowLog(false)
    setDeleteConfirm(false)
  }, [functionName])

  const configQuery = useQuery({
    queryKey: ['lambda-config', functionName],
    queryFn: ({ signal }) => getLambdaFunction(functionName!, signal),
    enabled: Boolean(functionName),
  })

  const invokeMutation = useMutation({
    mutationFn: () => invokeLambdaFunction(functionName!, payload),
    onSuccess: (result) => { setInvokeResult(result); setShowLog(false) },
  })

  const deleteMutation = useMutation({
    mutationFn: () => deleteLambdaFunction(functionName!),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['resources', 'lambda'] })
      onDeleted()
    },
    onError: (err) => alert(`Delete failed: ${err instanceof Error ? err.message : err}`),
  })

  const config = configQuery.data
  const envVars = config?.environment ? Object.entries(config.environment) : []
  const isInvokeError = Boolean(
    invokeResult?.functionError || (invokeResult && invokeResult.statusCode >= 400)
  )

  return (
    <div className={`tag-drawer ${functionName ? 'open' : ''}`} style={{ width: 400 }}>
      {/* Header */}
      <div className="tag-drawer-header">
        <Zap size={14} color="#ff9900" />
        <h3 title={functionName ?? ''}>{functionName}</h3>
        <button className="icon-btn" onClick={onClose}><X size={14} /></button>
      </div>

      {/* Tabs */}
      <div className="drawer-tabs">
        <button className={`drawer-tab ${tab === 'details' ? 'active' : ''}`} onClick={() => setTab('details')}>
          Details
        </button>
        <button className={`drawer-tab ${tab === 'invoke' ? 'active' : ''}`} onClick={() => setTab('invoke')}>
          Invoke
        </button>
      </div>

      {/* Body */}
      <div className="tag-drawer-body">

        {/* ── Details tab ── */}
        {tab === 'details' && (
          configQuery.isLoading ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#5f7080', fontSize: 13 }}>
              <Loader2 size={14} /> Loading configuration…
            </div>
          ) : configQuery.isError ? (
            <p style={{ color: '#f87171', fontSize: 13 }}>Failed to load configuration.</p>
          ) : config ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Badges */}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <RuntimeBadge runtime={config.runtime} />
                <StateBadge state={config.state} />
                {config.architectures?.map((arch) => (
                  <span key={arch} className="badge" style={{ background: 'rgba(107,114,128,0.14)', color: '#9ca3af' }}>
                    {arch}
                  </span>
                ))}
                {config.packageType && config.packageType !== 'Zip' && (
                  <span className="badge" style={{ background: 'rgba(107,114,128,0.14)', color: '#9ca3af' }}>
                    {config.packageType}
                  </span>
                )}
              </div>

              {/* State reason */}
              {config.stateReason && (
                <p style={{ fontSize: 12, color: '#8d9cad', margin: 0, lineHeight: 1.5 }}>
                  {config.stateReason}
                </p>
              )}

              {/* Config grid */}
              <div className="meta-grid">
                {config.functionArn && (
                  <div className="meta-row">
                    <span className="meta-label">ARN</span>
                    <span className="meta-value" style={{ fontSize: 11 }}>{config.functionArn}</span>
                  </div>
                )}
                {config.handler && (
                  <div className="meta-row">
                    <span className="meta-label">Handler</span>
                    <span className="meta-value">{config.handler}</span>
                  </div>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  {config.memorySize !== undefined && (
                    <div className="meta-row">
                      <span className="meta-label">Memory</span>
                      <span className="meta-value">{config.memorySize} MB</span>
                    </div>
                  )}
                  {config.timeout !== undefined && (
                    <div className="meta-row">
                      <span className="meta-label">Timeout</span>
                      <span className="meta-value">{config.timeout}s</span>
                    </div>
                  )}
                  {config.codeSize !== undefined && (
                    <div className="meta-row">
                      <span className="meta-label">Code size</span>
                      <span className="meta-value">{formatBytes(config.codeSize)}</span>
                    </div>
                  )}
                  {config.lastModified && (
                    <div className="meta-row">
                      <span className="meta-label">Last modified</span>
                      <span className="meta-value" style={{ color: '#8d9cad' }}>{timeAgo(config.lastModified)}</span>
                    </div>
                  )}
                </div>
                {config.role && (
                  <div className="meta-row">
                    <span className="meta-label">Execution role</span>
                    <span className="meta-value" style={{ fontSize: 11 }}>
                      {config.role.split('/').pop() ?? config.role}
                    </span>
                  </div>
                )}
                {config.description && (
                  <div className="meta-row">
                    <span className="meta-label">Description</span>
                    <span className="meta-value" style={{ fontFamily: 'inherit', color: '#8d9cad' }}>
                      {config.description}
                    </span>
                  </div>
                )}
              </div>

              {/* Environment variables */}
              {envVars.length > 0 && (
                <div>
                  <p style={{ fontSize: 11, color: '#5f7080', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 6px' }}>
                    Environment variables ({envVars.length})
                  </p>
                  <div style={{ border: '1px solid var(--border)', borderRadius: 4, overflow: 'hidden' }}>
                    {envVars.map(([key, value], i) => (
                      <div
                        key={key}
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '1fr 1fr',
                          gap: 0,
                          borderBottom: i < envVars.length - 1 ? '1px solid var(--border)' : undefined,
                        }}
                      >
                        <div style={{ padding: '6px 8px', borderRight: '1px solid var(--border)', fontSize: 12, fontFamily: 'monospace', color: '#fbbf24' }}>
                          {key}
                        </div>
                        <div
                          style={{ padding: '6px 8px', fontSize: 12, fontFamily: 'monospace', color: '#d1d1d1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                          title={value}
                        >
                          {value}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : null
        )}

        {/* ── Invoke tab ── */}
        {tab === 'invoke' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <p style={{ fontSize: 11, color: '#5f7080', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 5px' }}>
                Event payload (JSON)
              </p>
              <textarea
                className="json-editor"
                style={{ minHeight: 140 }}
                value={payload}
                onChange={(e) => setPayload(e.target.value)}
                spellCheck={false}
                placeholder="{}"
              />
            </div>

            <button
              className="button primary"
              disabled={invokeMutation.isPending}
              onClick={() => invokeMutation.mutate()}
              style={{ alignSelf: 'flex-start' }}
            >
              {invokeMutation.isPending ? <Loader2 size={13} /> : <Play size={13} />}
              {invokeMutation.isPending ? 'Invoking…' : 'Invoke'}
            </button>

            {invokeMutation.isError && (
              <p style={{ fontSize: 12, color: '#f87171', margin: 0 }}>
                {invokeMutation.error instanceof Error ? invokeMutation.error.message : 'Invocation failed'}
              </p>
            )}

            {invokeResult && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {/* Status row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: isInvokeError ? '#f87171' : '#4ade80',
                  }}>
                    HTTP {invokeResult.statusCode}
                  </span>
                  {invokeResult.functionError && (
                    <span style={{ fontSize: 12, color: '#f87171' }}>
                      {invokeResult.functionError}
                    </span>
                  )}
                  <span style={{ marginLeft: 'auto', fontSize: 11, color: '#5f7080' }}>
                    {invokeResult.executionDuration}ms
                  </span>
                </div>

                {/* Response payload */}
                <div>
                  <p style={{ fontSize: 11, color: '#5f7080', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 4px' }}>
                    Response
                  </p>
                  <pre className={`invoke-result ${isInvokeError ? 'error' : 'success'}`}>
                    {tryFormatJson(invokeResult.payload) || '(empty)'}
                  </pre>
                </div>

                {/* Log tail */}
                {invokeResult.logResult && (
                  <div>
                    <button
                      className="button"
                      style={{ width: '100%', justifyContent: 'space-between', marginBottom: 4 }}
                      onClick={() => setShowLog((v) => !v)}
                    >
                      <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        Log tail
                      </span>
                      {showLog ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                    </button>
                    {showLog && (
                      <div className="log-tail">{invokeResult.logResult}</div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="tag-drawer-footer">
        {deleteConfirm ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', width: '100%', padding: '6px 8px', background: 'rgba(239,68,68,0.08)', borderRadius: 4, border: '1px solid rgba(239,68,68,0.3)' }}>
            <span style={{ fontSize: 12, color: '#f87171', flex: 1 }}>Delete this function?</span>
            <button className="button danger" onClick={() => deleteMutation.mutate()} disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? <Loader2 size={12} /> : 'Yes, delete'}
            </button>
            <button className="button" onClick={() => setDeleteConfirm(false)}>Cancel</button>
          </div>
        ) : (
          <button
            className="button danger"
            onClick={() => setDeleteConfirm(true)}
          >
            <Trash2 size={13} />
            Delete function
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function LambdaPage() {
  const [search, setSearch] = useState('')
  const [selectedFn, setSelectedFn] = useState<string | null>(null)

  const query = useQuery({
    queryKey: ['resources', 'lambda'],
    queryFn: ({ signal }) => listServiceResources('lambda', signal),
  })

  const functions = useMemo(() => {
    const all = (query.data ?? []).map(buildFn)
    if (!search) return all
    const q = search.toLowerCase()
    return all.filter((fn) => fn.name.toLowerCase().includes(q) || fn.runtime?.toLowerCase().includes(q))
  }, [query.data, search])

  function handleDeleted() {
    setSelectedFn(null)
  }

  return (
    <>
      {/* Function detail drawer */}
      <FunctionDrawer
        key={selectedFn}
        functionName={selectedFn}
        onClose={() => setSelectedFn(null)}
        onDeleted={handleDeleted}
      />

      <div className="page-header">
        <div className="page-title">
          <h2>Lambda</h2>
          <span className="info-link">
            <Info size={11} />
            {query.data ? `${query.data.length} functions` : 'Serverless functions'}
          </span>
        </div>
        <button className="button" onClick={() => void query.refetch()}>
          <RefreshCw size={13} />
          Refresh
        </button>
      </div>

      <div className="input-row">
        <Search size={14} color="#8d9cad" />
        <input
          className="input"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or runtime…"
        />
        {selectedFn && (
          <span style={{ marginLeft: 'auto', fontSize: 12, color: '#539fe5', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Zap size={12} />
            {selectedFn}
            <button className="icon-btn" style={{ width: 20, height: 20 }} onClick={() => setSelectedFn(null)}>
              <X size={11} />
            </button>
          </span>
        )}
      </div>

      <div className="content">
        {query.isError ? (
          <EmptyState icon={Zap} title="Cannot load functions" description="Lambda did not respond from the Floci endpoint." />
        ) : query.isLoading ? (
          <div className="empty"><p>Loading functions…</p></div>
        ) : functions.length === 0 ? (
          <EmptyState
            icon={Zap}
            title={search ? 'No functions match your search' : 'No Lambda functions'}
            description={search ? 'Try a different name or runtime filter.' : 'Deploy a function with the AWS CLI to get started.'}
          />
        ) : (
          <div className="fn-grid">
            {functions.map((fn) => (
              <FnCard
                key={fn.id}
                fn={fn}
                selected={selectedFn === fn.name}
                onClick={() => setSelectedFn(selectedFn === fn.name ? null : fn.name)}
              />
            ))}
          </div>
        )}
      </div>
    </>
  )
}
