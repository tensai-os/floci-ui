import {useMemo, useState} from 'react'
import {useQuery, useMutation, useQueryClient} from '@tanstack/react-query'
import {Activity, AreaChart, Bell, Info, RefreshCw, Search, Plus, Trash2, ArrowLeft, Loader2, ChevronDown} from 'lucide-react'
import {EmptyState} from '@/components/EmptyState'
import {
    listLogGroups,
    listLogStreams,
    getLogEvents,
    listAlarms,
    listMetrics,
    createLogGroup,
    deleteLogGroup,
    deleteLogStream,
} from '@/api/services'
import {timeAgo} from '@/lib/utils'
import type {CWLogEvent, CWLogStream} from '@/api/types'

// ─── Ingestor event parser ─────────────────────────────────────────────────────

interface IngestorEvent {
    method: string
    path: string
    action?: string
    statusCode: number
    latencyMs: number
}

function tryParseIngestor(message: string): IngestorEvent | null {
    if (!message.trimStart().startsWith('{')) return null
    try {
        const obj = JSON.parse(message) as Record<string, unknown>
        if (typeof obj.method === 'string' && typeof obj.statusCode === 'number') {
            return {
                method: obj.method,
                path: (obj.path as string | undefined) ?? '',
                action: obj.action as string | undefined,
                statusCode: obj.statusCode,
                latencyMs: (obj.latencyMs as number | undefined) ?? 0,
            }
        }
    } catch { /* not JSON */ }
    return null
}

// ─── Badge helpers ─────────────────────────────────────────────────────────────

const METHOD_STYLES: Record<string, { bg: string; color: string }> = {
    GET: {bg: 'rgba(34,197,94,0.15)', color: '#4ade80'},
    POST: {bg: 'rgba(59,130,246,0.15)', color: '#60a5fa'},
    PUT: {bg: 'rgba(249,115,22,0.15)', color: '#fb923c'},
    DELETE: {bg: 'rgba(239,68,68,0.15)', color: '#f87171'},
    PATCH: {bg: 'rgba(168,85,247,0.15)', color: '#c084fc'},
}

function methodStyle(method: string) {
    return METHOD_STYLES[method.toUpperCase()] ?? {bg: 'rgba(107,114,128,0.15)', color: '#9ca3af'}
}

function statusColor(code: number): string {
    if (code >= 500) return '#f87171'
    if (code >= 400) return '#fb923c'
    if (code >= 300) return '#60a5fa'
    return '#4ade80'
}

function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(Math.max(bytes, 1)) / Math.log(k))
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

function retentionLabel(days?: number): string {
    if (!days) return 'Never expire'
    if (days < 7) return `${days}d`
    if (days < 30) return `${Math.round(days / 7)}w`
    if (days < 365) return `${Math.round(days / 30)}mo`
    return `${Math.round(days / 365)}y`
}

// ─── Log event row ─────────────────────────────────────────────────────────────

function LogEventRow({event}: { event: CWLogEvent }) {
    const parsed = tryParseIngestor(event.message)
    const ts = new Date(event.timestamp).toISOString()

    if (parsed) {
        const ms = methodStyle(parsed.method)
        return (
            <div className="log-line" style={{display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap'}}>
                <span style={{color: '#5f7080', fontSize: 11, flexShrink: 0}}>{ts}</span>
                <span className="badge" style={{background: ms.bg, color: ms.color, fontFamily: '"JetBrains Mono", monospace', fontSize: 10}}>
                    {parsed.method}
                </span>
                <span className="mono" style={{fontSize: 12, color: '#d1d1d1', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>
                    {parsed.path}
                </span>
                {parsed.action && (
                    <span style={{fontSize: 11, color: '#8d9cad', flexShrink: 0}}>{parsed.action}</span>
                )}
                <span className="badge" style={{background: `${statusColor(parsed.statusCode)}22`, color: statusColor(parsed.statusCode), fontSize: 10, flexShrink: 0}}>
                    {parsed.statusCode}
                </span>
                <span style={{fontSize: 11, color: '#5f7080', flexShrink: 0}}>{parsed.latencyMs}ms</span>
            </div>
        )
    }

    return (
        <div className="log-line">
            <span style={{color: '#5f7080', fontSize: 11}}>{ts}</span>
            {'  '}
            <span style={{color: '#d1d1d1'}}>{event.message}</span>
        </div>
    )
}

// ─── Live indicator ────────────────────────────────────────────────────────────

function LiveDot() {
    return (
        <span title="Auto-refreshing every 10s" style={{display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#4ade80'}}>
            <span style={{width: 7, height: 7, borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 5px #22c55e', display: 'inline-block'}}/>
            Live
        </span>
    )
}

// ─── Create Log Group bar ──────────────────────────────────────────────────────

function CreateGroupBar({onCreated}: { onCreated: () => void }) {
    const [open, setOpen] = useState(false)
    const [name, setName] = useState('')
    const [retention, setRetention] = useState('')
    const [busy, setBusy] = useState(false)
    const [err, setErr] = useState('')

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        const trimmed = name.trim()
        if (!trimmed) return setErr('Name required')
        setBusy(true)
        setErr('')
        try {
            await createLogGroup(trimmed, retention ? Number(retention) : undefined)
            setName('')
            setRetention('')
            setOpen(false)
            onCreated()
        } catch (ex) {
            setErr(ex instanceof Error ? ex.message : 'Create failed')
        } finally {
            setBusy(false)
        }
    }

    if (!open) {
        return (
            <button className="button" style={{padding: '4px 10px', fontSize: 12}} onClick={() => setOpen(true)}>
                <Plus size={13}/>
                New group
            </button>
        )
    }

    return (
        <form onSubmit={handleSubmit} style={{display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 12px', background: 'var(--raised)', border: '1px solid var(--border)', borderRadius: 8, margin: '6px 12px'}}>
            <div style={{display: 'flex', gap: 6, alignItems: 'center'}}>
                <input
                    className="input"
                    style={{flex: 1}}
                    placeholder="Log group name (e.g. /app/my-service)"
                    value={name}
                    onChange={(e) => { setName(e.target.value); setErr('') }}
                    autoFocus
                />
                <select className="input" style={{width: 'auto'}} value={retention} onChange={(e) => setRetention(e.target.value)}>
                    <option value="">Never expire</option>
                    <option value="1">1 day</option>
                    <option value="3">3 days</option>
                    <option value="7">1 week</option>
                    <option value="14">2 weeks</option>
                    <option value="30">1 month</option>
                    <option value="90">3 months</option>
                    <option value="365">1 year</option>
                </select>
            </div>
            {err && <span style={{fontSize: 11, color: '#f87171'}}>{err}</span>}
            <div style={{display: 'flex', gap: 6, justifyContent: 'flex-end'}}>
                <button type="button" className="button" onClick={() => { setOpen(false); setErr('') }}>Cancel</button>
                <button type="submit" className="button primary" disabled={busy}>
                    {busy ? <Loader2 size={13} className="spin"/> : <Plus size={13}/>}
                    Create
                </button>
            </div>
        </form>
    )
}

// ─── Stream row (with delete) ──────────────────────────────────────────────────

function StreamRow({
    stream,
    selectedGroup,
    selectedStream,
    onSelect,
    onDeleted,
}: {
    stream: CWLogStream
    selectedGroup: string
    selectedStream: string | null
    onSelect: () => void
    onDeleted: () => void
}) {
    const [confirmDel, setConfirmDel] = useState(false)
    const delMut = useMutation({
        mutationFn: () => deleteLogStream(selectedGroup, stream.name),
        onSuccess: onDeleted,
    })

    return (
        <tr
            style={{cursor: 'pointer', background: selectedStream === stream.name ? '#243447' : undefined}}
            onClick={onSelect}
        >
            <td>
                <span style={{display: 'flex', alignItems: 'center', gap: 8}}>
                    {selectedStream === stream.name && (
                        <span style={{width: 3, height: 14, background: '#ff9900', borderRadius: 2, display: 'inline-block', flexShrink: 0}}/>
                    )}
                    <span className="mono" style={{color: '#539fe5', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>{stream.name}</span>
                </span>
            </td>
            <td style={{color: '#8d9cad'}}>{timeAgo(stream.lastEventAt)}</td>
            <td style={{color: '#8d9cad'}}>{formatBytes(stream.storedBytes)}</td>
            <td style={{width: 90}} onClick={(e) => e.stopPropagation()}>
                {confirmDel ? (
                    <span style={{display: 'flex', gap: 4, alignItems: 'center'}}>
                        <button
                            className="button danger"
                            style={{padding: '1px 6px', fontSize: 11}}
                            disabled={delMut.isPending}
                            onClick={() => delMut.mutate()}
                        >
                            {delMut.isPending ? <Loader2 size={11} className="spin"/> : 'Delete'}
                        </button>
                        <button className="button" style={{padding: '1px 6px', fontSize: 11}} onClick={() => setConfirmDel(false)}>No</button>
                    </span>
                ) : (
                    <button
                        className="bucket-action-btn"
                        style={{opacity: 0}}
                        title="Delete stream"
                        onClick={() => setConfirmDel(true)}
                    >
                        <Trash2 size={12}/>
                    </button>
                )}
            </td>
        </tr>
    )
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export function CloudWatchPage() {
    const qc = useQueryClient()
    const [prefix, setPrefix] = useState('')
    const [selectedGroup, setSelectedGroup] = useState<string | null>(null)
    const [selectedStream, setSelectedStream] = useState<string | null>(null)
    const [eventSearch, setEventSearch] = useState('')
    const [delGroupConfirm, setDelGroupConfirm] = useState<string | null>(null)
    const [showMoreAlarms, setShowMoreAlarms] = useState(false)

    const groupsQuery = useQuery({
        queryKey: ['cloudwatch', 'groups', prefix],
        queryFn: ({signal}) => listLogGroups(prefix || undefined, signal),
        refetchInterval: 10_000,
    })
    const alarmsQuery = useQuery({
        queryKey: ['cloudwatch', 'alarms'],
        queryFn: ({signal}) => listAlarms(signal),
        refetchInterval: 30_000,
    })
    const metricsQuery = useQuery({
        queryKey: ['cloudwatch', 'metrics'],
        queryFn: ({signal}) => listMetrics(signal),
        refetchInterval: 30_000,
    })
    const streamsQuery = useQuery({
        queryKey: ['cloudwatch', 'streams', selectedGroup],
        queryFn: ({signal}) => listLogStreams(selectedGroup!, signal),
        enabled: Boolean(selectedGroup),
        refetchInterval: 10_000,
    })
    const eventsQuery = useQuery({
        queryKey: ['cloudwatch', 'events', selectedGroup, selectedStream],
        queryFn: ({signal}) => getLogEvents(selectedGroup!, selectedStream!, signal),
        enabled: Boolean(selectedGroup && selectedStream),
        refetchInterval: 10_000,
    })

    const delGroupMut = useMutation({
        mutationFn: (name: string) => deleteLogGroup(name),
        onSuccess: (_, name) => {
            if (selectedGroup === name) {
                setSelectedGroup(null)
                setSelectedStream(null)
            }
            setDelGroupConfirm(null)
            void qc.invalidateQueries({queryKey: ['cloudwatch', 'groups']})
        },
    })

    const filteredEvents = useMemo(() => {
        const events = (eventsQuery.data ?? []).slice().reverse() // newest first
        if (!eventSearch) return events
        const q = eventSearch.toLowerCase()
        return events.filter((e) => e.message.toLowerCase().includes(q))
    }, [eventsQuery.data, eventSearch])

    const sortedStreams = useMemo(() =>
        (streamsQuery.data ?? []).slice().sort((a, b) => (b.lastEventAt ?? 0) - (a.lastEventAt ?? 0)),
    [streamsQuery.data])

    function handleRefresh() {
        void groupsQuery.refetch()
        void alarmsQuery.refetch()
        void metricsQuery.refetch()
        if (selectedGroup) void streamsQuery.refetch()
        if (selectedGroup && selectedStream) void eventsQuery.refetch()
    }

    function selectGroup(name: string) {
        setSelectedGroup(name)
        setSelectedStream(null)
        setEventSearch('')
        setDelGroupConfirm(null)
    }

    function deselectGroup() {
        setSelectedGroup(null)
        setSelectedStream(null)
        setEventSearch('')
        setDelGroupConfirm(null)
    }

    const isFlociGroup = selectedGroup?.startsWith('/floci/')
    const alarms = alarmsQuery.data ?? []
    const visibleAlarms = showMoreAlarms ? alarms : alarms.slice(0, 5)

    return (
        <>
            <div className="page-header">
                <div className="page-title">
                    {selectedGroup ? (
                        <>
                            <button
                                className="button"
                                style={{padding: '3px 8px'}}
                                onClick={deselectGroup}
                                title="Back to overview"
                            >
                                <ArrowLeft size={13}/>
                            </button>
                            <h2 style={{fontSize: 14, maxWidth: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}} title={selectedGroup}>
                                {selectedGroup}
                            </h2>
                            {isFlociGroup && (
                                <span style={{fontSize: 11, padding: '2px 7px', borderRadius: 3, background: 'rgba(255,153,0,0.14)', color: '#ff9900'}}>
                                    ingestor
                                </span>
                            )}
                        </>
                    ) : (
                        <>
                            <h2>CloudWatch</h2>
                            <span className="info-link">
                                <Info size={11}/>
                                Logs · Metrics · Alarms
                            </span>
                        </>
                    )}
                </div>
                <div style={{display: 'flex', gap: 10, alignItems: 'center'}}>
                    <LiveDot/>
                    <button className="button" onClick={handleRefresh}>
                        <RefreshCw size={13}/>
                        Refresh
                    </button>
                </div>
            </div>

            {/* Search bar */}
            <div className="input-row" style={{flexDirection: 'column', alignItems: 'stretch', gap: 8}}>
                <div style={{display: 'flex', gap: 10, alignItems: 'center'}}>
                    <Search size={14} color="#8d9cad"/>
                    <input
                        className="input"
                        style={{flex: 1}}
                        value={prefix}
                        onChange={(e) => setPrefix(e.target.value)}
                        placeholder="Filter log groups by prefix…  (try /floci/)"
                    />
                    <span style={{fontSize: 11, color: '#5f7080', whiteSpace: 'nowrap'}}>
                        {groupsQuery.data?.length ?? 0} group{groupsQuery.data?.length !== 1 ? 's' : ''}
                    </span>
                </div>
            </div>

            <div className="split">
                {/* ── Left: log group list ── */}
                <aside className="list-pane">
                    <div className="widget-header" style={{justifyContent: 'space-between'}}>
                        <div style={{display: 'flex', alignItems: 'center', gap: 6}}>
                            <Activity size={13} color="#8d9cad"/>
                            <h3>Log groups</h3>
                        </div>
                        <CreateGroupBar onCreated={() => void groupsQuery.refetch()}/>
                    </div>

                    {groupsQuery.isLoading ? (
                        <div className="empty"><p>Loading log groups…</p></div>
                    ) : groupsQuery.isError ? (
                        <EmptyState icon={AreaChart} title="Cannot load log groups" description="CloudWatch Logs did not respond from the Floci endpoint."/>
                    ) : (groupsQuery.data ?? []).length === 0 ? (
                        <EmptyState
                            icon={Activity}
                            title="No log groups yet"
                            description="Navigate to S3, SQS, Lambda or any other service — the CloudWatch ingestor will create /floci/* log groups automatically within 5 seconds."
                        />
                    ) : (
                        (groupsQuery.data ?? []).map((group) => {
                            const isFloci = group.name.startsWith('/floci/')
                            const service = isFloci ? group.name.replace('/floci/', '') : null
                            const isConfirming = delGroupConfirm === group.name
                            return (
                                <button
                                    key={group.name}
                                    className={`list-item ${selectedGroup === group.name ? 'active' : ''}`}
                                    onClick={() => selectGroup(group.name)}
                                    style={{position: 'relative'}}
                                >
                                    <strong style={{display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0}}>
                                        {isFloci && (
                                            <span style={{fontSize: 10, padding: '1px 5px', borderRadius: 3, background: 'rgba(255,153,0,0.15)', color: '#ff9900', fontWeight: 600, flexShrink: 0}}>
                                                {service}
                                            </span>
                                        )}
                                        <span style={{overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>{group.name}</span>
                                    </strong>
                                    <span style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6}}>
                                        <span>{formatBytes(group.storedBytes)} · {timeAgo(group.createdAt)}</span>
                                        {group.retentionInDays && (
                                            <span style={{fontSize: 10, color: 'var(--accent)', background: 'var(--accent-tint)', padding: '1px 5px', borderRadius: 3, flexShrink: 0}}>
                                                {retentionLabel(group.retentionInDays)}
                                            </span>
                                        )}
                                    </span>
                                    {/* Delete button */}
                                    {isConfirming ? (
                                        <span style={{display: 'flex', gap: 4}} onClick={(e) => e.stopPropagation()}>
                                            <button
                                                className="button danger"
                                                style={{padding: '1px 8px', fontSize: 11}}
                                                disabled={delGroupMut.isPending}
                                                onClick={() => delGroupMut.mutate(group.name)}
                                            >
                                                {delGroupMut.isPending ? <Loader2 size={11} className="spin"/> : 'Delete'}
                                            </button>
                                            <button className="button" style={{padding: '1px 8px', fontSize: 11}} onClick={() => setDelGroupConfirm(null)}>No</button>
                                        </span>
                                    ) : (
                                        <span
                                            className="bucket-action-btn"
                                            style={{position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)'}}
                                            onClick={(e) => { e.stopPropagation(); setDelGroupConfirm(group.name) }}
                                            title="Delete log group"
                                        >
                                            <Trash2 size={12}/>
                                        </span>
                                    )}
                                </button>
                            )
                        })
                    )}
                </aside>

                {/* ── Right: detail ── */}
                <section className="detail-pane">
                    {!selectedGroup ? (
                        <div className="content">
                            {/* Overview: metrics + alarms */}
                            <div className="grid two">
                                <section className="table-panel">
                                    <div className="widget-header"><h3>Metrics</h3></div>
                                    {metricsQuery.isLoading ? (
                                        <div className="empty"><p>Loading metrics…</p></div>
                                    ) : (metricsQuery.data ?? []).length === 0 ? (
                                        <EmptyState icon={AreaChart} title="No metrics" description="No CloudWatch metrics were returned by Floci."/>
                                    ) : (
                                        <table className="table">
                                            <thead>
                                            <tr>
                                                <th>Namespace</th>
                                                <th>Metric</th>
                                                <th>Dimensions</th>
                                            </tr>
                                            </thead>
                                            <tbody>
                                            {metricsQuery.data?.map((metric) => (
                                                <tr key={metric.id}>
                                                    <td>{metric.namespace}</td>
                                                    <td>{metric.metricName}</td>
                                                    <td className="mono">{metric.dimensions.map((d) => `${d.name}=${d.value}`).join(', ') || '—'}</td>
                                                </tr>
                                            ))}
                                            </tbody>
                                        </table>
                                    )}
                                </section>

                                <section className="table-panel">
                                    <div className="widget-header"><h3>Alarms</h3></div>
                                    {(alarmsQuery.data ?? []).length === 0 ? (
                                        <EmptyState icon={Bell} title="No alarms" description="No CloudWatch alarms were returned by Floci."/>
                                    ) : (
                                        <>
                                            <table className="table">
                                                <thead>
                                                <tr>
                                                    <th>Name</th>
                                                    <th>State</th>
                                                    <th>Metric</th>
                                                </tr>
                                                </thead>
                                                <tbody>
                                                {visibleAlarms.map((alarm) => (
                                                    <tr key={alarm.alarmName}>
                                                        <td>{alarm.alarmName}</td>
                                                        <td style={{color: alarm.stateValue === 'OK' ? '#4ade80' : alarm.stateValue === 'ALARM' ? '#f87171' : '#f59e0b'}}>
                                                            {alarm.stateValue}
                                                        </td>
                                                        <td>{alarm.metricName ?? '—'}</td>
                                                    </tr>
                                                ))}
                                                </tbody>
                                            </table>
                                            {alarms.length > 5 && (
                                                <button
                                                    className="button"
                                                    style={{width: '100%', justifyContent: 'center', borderRadius: 0, borderTop: '1px solid var(--border)', fontSize: 12}}
                                                    onClick={() => setShowMoreAlarms((v) => !v)}
                                                >
                                                    <ChevronDown size={13} style={{transform: showMoreAlarms ? 'rotate(180deg)' : undefined, transition: 'transform 0.2s'}}/>
                                                    {showMoreAlarms ? 'Show less' : `Show ${alarms.length - 5} more`}
                                                </button>
                                            )}
                                        </>
                                    )}
                                </section>
                            </div>

                            <div className="section-space">
                                <EmptyState
                                    icon={Activity}
                                    title="Select a log group"
                                    description="Streams and events will appear here. /floci/* groups are created automatically by the CloudWatch ingestor as you use other services."
                                />
                            </div>
                        </div>
                    ) : (
                        <div className="content" style={{paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 14}}>
                            {/* Streams list */}
                            <section className="table-panel">
                                <div className="widget-header">
                                    <h3>Streams</h3>
                                    {streamsQuery.data && (
                                        <span style={{marginLeft: 'auto', fontSize: 11, color: '#5f7080'}}>
                                            {streamsQuery.data.length} stream{streamsQuery.data.length !== 1 ? 's' : ''}
                                        </span>
                                    )}
                                    <button className="button" style={{padding: '2px 6px'}} onClick={() => void streamsQuery.refetch()}>
                                        <RefreshCw size={12}/>
                                    </button>
                                </div>
                                {streamsQuery.isLoading ? (
                                    <div className="empty compact"><p>Loading streams…</p></div>
                                ) : sortedStreams.length === 0 ? (
                                    <EmptyState icon={AreaChart} title="No streams" description="No log streams were found for this log group." compact/>
                                ) : (
                                    <table className="table">
                                        <thead>
                                        <tr>
                                            <th>Stream name</th>
                                            <th style={{width: 130}}>Last event</th>
                                            <th style={{width: 90}}>Stored</th>
                                            <th style={{width: 90}}/>
                                        </tr>
                                        </thead>
                                        <tbody>
                                        {sortedStreams.map((stream) => (
                                            <StreamRow
                                                key={stream.name}
                                                stream={stream}
                                                selectedGroup={selectedGroup}
                                                selectedStream={selectedStream}
                                                onSelect={() => { setSelectedStream(stream.name); setEventSearch('') }}
                                                onDeleted={() => {
                                                    if (selectedStream === stream.name) setSelectedStream(null)
                                                    void streamsQuery.refetch()
                                                }}
                                            />
                                        ))}
                                        </tbody>
                                    </table>
                                )}
                            </section>

                            {/* Events */}
                            <section className="table-panel">
                                <div className="widget-header" style={{gap: 12}}>
                                    <h3>Events</h3>
                                    {selectedStream && eventsQuery.data && (
                                        <span style={{fontSize: 11, color: '#5f7080'}}>
                                            {filteredEvents.length} event{filteredEvents.length !== 1 ? 's' : ''}
                                            {eventSearch ? ` matching "${eventSearch}"` : ''}
                                        </span>
                                    )}
                                    {selectedStream && (
                                        <div style={{marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8}}>
                                            <Search size={12} color="#5f7080"/>
                                            <input
                                                className="input"
                                                style={{height: 24, minWidth: 180}}
                                                value={eventSearch}
                                                onChange={(e) => setEventSearch(e.target.value)}
                                                placeholder="Filter events…"
                                            />
                                        </div>
                                    )}
                                </div>

                                {!selectedStream ? (
                                    <EmptyState icon={Activity} title="Select a stream" description="Click a stream above to view its log events." compact/>
                                ) : eventsQuery.isLoading ? (
                                    <div className="empty compact"><p>Loading events…</p></div>
                                ) : filteredEvents.length === 0 ? (
                                    <EmptyState
                                        icon={Activity}
                                        title={eventSearch ? 'No matching events' : 'No events'}
                                        description={eventSearch ? `No events contain "${eventSearch}".` : 'This stream has no events yet.'}
                                        compact
                                    />
                                ) : (
                                    <div>
                                        {filteredEvents.map((event) => (
                                            <LogEventRow key={event.id} event={event}/>
                                        ))}
                                    </div>
                                )}
                            </section>
                        </div>
                    )}
                </section>
            </div>
        </>
    )
}
