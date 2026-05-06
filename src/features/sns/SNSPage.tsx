import {useQuery, useMutation, useQueryClient} from '@tanstack/react-query'
import {useState, useEffect} from 'react'
import {Bell, Plus, RefreshCw, Send, Loader2, Trash2, ChevronDown, ChevronUp} from 'lucide-react'
import {
    listSnsTopicsDetail,
    createSnsTopic,
    deleteSnsTopic,
    listSubscriptionsByTopic,
    subscribeToTopic,
    unsubscribeFromTopic,
    publishSnsMessage,
    type SnsTopic,
    type SnsSubscription,
} from '@/api/services'

// ─── Create Topic Modal ───────────────────────────────────────────────────────

function CreateTopicModal({onClose, onCreate}: { onClose: () => void; onCreate: (name: string, fifo: boolean) => void }) {
    const [name, setName] = useState('')
    const [fifo, setFifo] = useState(false)
    const [busy, setBusy] = useState(false)
    const [err, setErr] = useState('')

    const effectiveName = fifo && !name.endsWith('.fifo') ? `${name}.fifo` : name

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        const trimmed = effectiveName.trim()
        if (!trimmed) return setErr('Topic name is required')
        if (!/^[A-Za-z0-9_-]+(?:\.fifo)?$/.test(trimmed)) return setErr('Name may only contain letters, digits, - and _')
        setBusy(true)
        setErr('')
        try {
            await onCreate(trimmed, fifo)
            onClose()
        } catch (ex) {
            setErr(ex instanceof Error ? ex.message : 'Failed to create topic')
        } finally {
            setBusy(false)
        }
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="create-topic-modal" onClick={(e) => e.stopPropagation()}>
                <h3>Create SNS Topic</h3>

                <form onSubmit={handleSubmit} style={{display: 'flex', flexDirection: 'column', gap: 14}}>
                    <div className="field-row">
                        <label>Name</label>
                        <input
                            className="input"
                            placeholder="my-topic"
                            value={name}
                            onChange={(e) => {
                                setName(e.target.value)
                                setErr('')
                            }}
                            autoFocus
                        />
                    </div>

                    {fifo && (
                        <div style={{fontSize: 11, color: 'var(--text-2)', paddingLeft: 84}}>
                            Full name: <span style={{fontFamily: 'monospace', color: 'var(--accent)'}}>{effectiveName || '…'}</span>
                        </div>
                    )}

                    <div className="field-row">
                        <label>FIFO Topic</label>
                        <label className="versioning-toggle">
                            <input type="checkbox" checked={fifo} onChange={(e) => setFifo(e.target.checked)}/>
                            <span className="toggle-track"/>
                        </label>
                    </div>

                    {err && <div style={{fontSize: 12, color: '#f87171', paddingLeft: 84}}>{err}</div>}

                    <div className="modal-footer">
                        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
                        <button type="submit" className="btn btn-primary" disabled={busy}>
                            {busy ? <Loader2 size={14} className="spin"/> : <Plus size={14}/>}
                            Create
                        </button>
                    </div>
                </form>
            </div>
        </div>
    )
}

// ─── Subscribe Form ───────────────────────────────────────────────────────────

const PROTOCOLS = ['sqs', 'lambda', 'http', 'https', 'email', 'email-json', 'sms']

function SubscribeForm({topicArn, onDone}: { topicArn: string; onDone: () => void }) {
    const [protocol, setProtocol] = useState('sqs')
    const [endpoint, setEndpoint] = useState('')
    const [busy, setBusy] = useState(false)
    const [err, setErr] = useState('')

    const placeholder: Record<string, string> = {
        sqs: 'arn:aws:sqs:us-east-1:000000000000:my-queue',
        lambda: 'arn:aws:lambda:us-east-1:000000000000:function:my-fn',
        http: 'http://example.com/notify',
        https: 'https://example.com/notify',
        email: 'user@example.com',
        'email-json': 'user@example.com',
        sms: '+1555000000',
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        if (!endpoint.trim()) return setErr('Endpoint is required')
        setBusy(true)
        setErr('')
        try {
            await subscribeToTopic(topicArn, protocol, endpoint.trim())
            setEndpoint('')
            onDone()
        } catch (ex) {
            setErr(ex instanceof Error ? ex.message : 'Subscribe failed')
        } finally {
            setBusy(false)
        }
    }

    return (
        <form className="subscribe-form" onSubmit={handleSubmit}>
            <div className="subscribe-form-title">Add Subscription</div>
            <div className="subscribe-form-row">
                <select
                    className="input"
                    style={{width: 'auto', flexShrink: 0}}
                    value={protocol}
                    onChange={(e) => {
                        setProtocol(e.target.value)
                        setEndpoint('')
                        setErr('')
                    }}
                >
                    {PROTOCOLS.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
                <input
                    className="input"
                    style={{flex: 1}}
                    placeholder={placeholder[protocol] ?? 'Endpoint'}
                    value={endpoint}
                    onChange={(e) => {
                        setEndpoint(e.target.value)
                        setErr('')
                    }}
                />
                <button type="submit" className="btn btn-primary" disabled={busy} style={{flexShrink: 0}}>
                    {busy ? <Loader2 size={14} className="spin"/> : <Plus size={14}/>}
                    Subscribe
                </button>
            </div>
            {err && <div style={{fontSize: 12, color: '#f87171'}}>{err}</div>}
        </form>
    )
}

// ─── Subscriptions Tab ────────────────────────────────────────────────────────

function SubscriptionsTab({topic}: { topic: SnsTopic }) {
    const qc = useQueryClient()

    const {data: subs = [], isLoading, refetch} = useQuery({
        queryKey: ['sns-subs', topic.arn],
        queryFn: ({signal}) => listSubscriptionsByTopic(topic.arn, signal),
        staleTime: 15_000,
    })

    const unsubMut = useMutation({
        mutationFn: (arn: string) => unsubscribeFromTopic(arn),
        onSuccess: () => qc.invalidateQueries({queryKey: ['sns-subs', topic.arn]}),
    })

    const [unsubConfirm, setUnsubConfirm] = useState<string | null>(null)

    function renderSubRow(sub: SnsSubscription) {
        const isConfirming = unsubConfirm === sub.subscriptionArn
        return (
            <div key={sub.subscriptionArn} className="sns-sub-row">
                <span className="sns-sub-protocol">{sub.protocol}</span>
                <span className="sns-sub-endpoint" title={sub.endpoint}>{sub.endpoint || '—'}</span>
                {isConfirming ? (
                    <>
                        <span style={{fontSize: 11, color: '#f87171', flexShrink: 0}}>Remove?</span>
                        <button
                            className="btn btn-danger"
                            style={{padding: '2px 8px', fontSize: 11}}
                            disabled={unsubMut.isPending}
                            onClick={() => unsubMut.mutate(sub.subscriptionArn)}
                        >
                            {unsubMut.isPending ? <Loader2 size={12} className="spin"/> : 'Yes'}
                        </button>
                        <button className="btn btn-ghost" style={{padding: '2px 8px', fontSize: 11}} onClick={() => setUnsubConfirm(null)}>No</button>
                    </>
                ) : (
                    <button className="sns-sub-del" onClick={() => setUnsubConfirm(sub.subscriptionArn)} title="Unsubscribe">
                        <Trash2 size={13}/>
                    </button>
                )}
            </div>
        )
    }

    if (isLoading) {
        return (
            <div className="sns-tab-content" style={{alignItems: 'center', justifyContent: 'center'}}>
                <Loader2 size={20} className="spin" style={{color: 'var(--text-3)'}}/>
            </div>
        )
    }

    return (
        <div className="sns-tab-content">
            <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between'}}>
                <span style={{fontSize: 12, color: 'var(--text-2)'}}>
                    {subs.length === 0 ? 'No subscriptions' : `${subs.length} subscription${subs.length !== 1 ? 's' : ''}`}
                </span>
                <button className="btn btn-ghost" style={{padding: '3px 8px', fontSize: 11}} onClick={() => refetch()}>
                    <RefreshCw size={12}/>
                </button>
            </div>

            {subs.map(renderSubRow)}

            <SubscribeForm
                topicArn={topic.arn}
                onDone={() => qc.invalidateQueries({queryKey: ['sns-subs', topic.arn]})}
            />
        </div>
    )
}

// ─── Publish Tab ──────────────────────────────────────────────────────────────

function PublishTab({topic}: { topic: SnsTopic }) {
    const [message, setMessage] = useState('')
    const [subject, setSubject] = useState('')
    const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
    const [busy, setBusy] = useState(false)
    const [logOpen, setLogOpen] = useState(false)

    async function handlePublish(e: React.FormEvent) {
        e.preventDefault()
        if (!message.trim()) return
        setBusy(true)
        setResult(null)
        try {
            const msgId = await publishSnsMessage(topic.arn, message.trim(), subject.trim() || undefined)
            setResult({ok: true, text: `Published ✓  MessageId: ${msgId}`})
            setMessage('')
            setSubject('')
        } catch (ex) {
            setResult({ok: false, text: ex instanceof Error ? ex.message : 'Publish failed'})
        } finally {
            setBusy(false)
        }
    }

    return (
        <div className="sns-tab-content">
            <form className="publish-form" onSubmit={handlePublish}>
                <div style={{display: 'flex', flexDirection: 'column', gap: 6}}>
                    <label style={{fontSize: 11, color: 'var(--text-2)', fontWeight: 500}}>Subject <span style={{color: 'var(--text-3)'}}>(optional)</span></label>
                    <input
                        className="input"
                        placeholder="Notification subject"
                        value={subject}
                        onChange={(e) => setSubject(e.target.value)}
                    />
                </div>

                <div style={{display: 'flex', flexDirection: 'column', gap: 6}}>
                    <label style={{fontSize: 11, color: 'var(--text-2)', fontWeight: 500}}>Message</label>
                    <textarea
                        className="input json-editor"
                        rows={6}
                        placeholder='{"key": "value"}'
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        style={{resize: 'vertical', minHeight: 100}}
                    />
                </div>

                <div style={{display: 'flex', justifyContent: 'flex-end'}}>
                    <button type="submit" className="btn btn-primary" disabled={busy || !message.trim()}>
                        {busy ? <Loader2 size={14} className="spin"/> : <Send size={14}/>}
                        Publish
                    </button>
                </div>
            </form>

            {result && (
                <div className={`publish-result ${result.ok ? 'success' : 'error'}`}>
                    {result.text}
                </div>
            )}

            {/* SNS fanout info */}
            <div
                style={{
                    padding: '10px 14px',
                    background: 'var(--raised)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    cursor: 'pointer',
                }}
                onClick={() => setLogOpen((o) => !o)}
            >
                <div style={{display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-2)'}}>
                    {logOpen ? <ChevronUp size={13}/> : <ChevronDown size={13}/>}
                    <span>How SNS fanout works</span>
                </div>
                {logOpen && (
                    <div style={{marginTop: 8, fontSize: 12, color: 'var(--text-2)', lineHeight: 1.6}}>
                        When you publish a message, SNS delivers it to <em>all active subscriptions</em> on this topic in parallel. Each subscriber receives
                        the message independently — SQS queues receive it as a new message, Lambda functions are invoked synchronously, HTTP/HTTPS endpoints
                        receive a POST request, and email addresses receive an email (after confirming the subscription).
                    </div>
                )}
            </div>
        </div>
    )
}

// ─── Topic Detail ─────────────────────────────────────────────────────────────

function TopicDetail({topic}: { topic: SnsTopic }) {
    const [tab, setTab] = useState<'subscriptions' | 'publish'>('subscriptions')

    return (
        <div className="sns-main">
            <div className="sns-main-header">
                <Bell size={16} style={{color: 'var(--accent)', flexShrink: 0}}/>
                <h3 title={topic.name}>{topic.name}</h3>
                <span className="sns-arn-chip" title={topic.arn}>{topic.arn}</span>
            </div>

            <div className="sns-tabs">
                <button className={`sns-tab${tab === 'subscriptions' ? ' active' : ''}`} onClick={() => setTab('subscriptions')}>
                    Subscriptions
                </button>
                <button className={`sns-tab${tab === 'publish' ? ' active' : ''}`} onClick={() => setTab('publish')}>
                    Publish
                </button>
            </div>

            {tab === 'subscriptions' && <SubscriptionsTab key={topic.arn} topic={topic}/>}
            {tab === 'publish' && <PublishTab key={topic.arn} topic={topic}/>}
        </div>
    )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function SNSPage() {
    const qc = useQueryClient()
    const [selected, setSelected] = useState<SnsTopic | null>(null)
    const [showCreate, setShowCreate] = useState(false)
    const [delConfirm, setDelConfirm] = useState<string | null>(null)
    const [search, setSearch] = useState('')

    const {data: topics = [], isLoading, refetch} = useQuery({
        queryKey: ['sns-topics'],
        queryFn: ({signal}) => listSnsTopicsDetail(signal),
        staleTime: 20_000,
    })

    const createMut = useMutation({
        mutationFn: ({name, fifo}: { name: string; fifo: boolean }) => createSnsTopic(name, fifo),
        onSuccess: () => qc.invalidateQueries({queryKey: ['sns-topics']}),
    })

    const deleteMut = useMutation({
        mutationFn: (arn: string) => deleteSnsTopic(arn),
        onSuccess: (_, arn) => {
            if (selected?.arn === arn) setSelected(null)
            setDelConfirm(null)
            qc.invalidateQueries({queryKey: ['sns-topics']})
        },
    })

    // Keep selected in sync if topics reload
    useEffect(() => {
        if (selected && topics.length > 0) {
            const updated = topics.find((t) => t.arn === selected.arn)
            if (!updated) setSelected(null)
        }
    }, [topics])

    const filtered = topics.filter((t) => !search || t.name.toLowerCase().includes(search.toLowerCase()))

    return (
        <div className="sns-layout">
            {/* Sidebar */}
            <div className="sns-sidebar">
                <div className="sns-sidebar-header">
                    <h2>
                        <span>Topics <span style={{color: 'var(--text-3)', fontWeight: 400, fontSize: 11}}>({topics.length})</span></span>
                        <div style={{display: 'flex', gap: 6}}>
                            <button className="btn btn-ghost" style={{padding: '3px 6px'}} onClick={() => refetch()} title="Refresh">
                                <RefreshCw size={13}/>
                            </button>
                            <button className="btn btn-primary" style={{padding: '3px 8px', fontSize: 12}} onClick={() => setShowCreate(true)}>
                                <Plus size={13}/>
                                Create
                            </button>
                        </div>
                    </h2>
                    <input
                        className="input"
                        placeholder="Filter topics…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>

                <div className="sns-topic-list">
                    {isLoading && (
                        <div style={{display: 'flex', justifyContent: 'center', padding: 24}}>
                            <Loader2 size={18} className="spin" style={{color: 'var(--text-3)'}}/>
                        </div>
                    )}

                    {!isLoading && filtered.length === 0 && (
                        <div style={{textAlign: 'center', padding: '24px 12px', fontSize: 12, color: 'var(--text-3)'}}>
                            {search ? 'No matching topics' : 'No topics yet'}
                        </div>
                    )}

                    {filtered.map((topic) => {
                        const isConfirming = delConfirm === topic.arn
                        return (
                            <div
                                key={topic.arn}
                                className={`sns-topic-item${selected?.arn === topic.arn ? ' selected' : ''}`}
                                onClick={() => {
                                    setSelected(selected?.arn === topic.arn ? null : topic)
                                    setDelConfirm(null)
                                }}
                            >
                                <Bell size={13} style={{color: 'var(--accent)', flexShrink: 0, opacity: 0.8}}/>
                                <span className="sns-topic-item-name" title={topic.name}>{topic.name}</span>
                                {isConfirming ? (
                                    <>
                                        <button
                                            className="btn btn-danger"
                                            style={{padding: '1px 6px', fontSize: 11, flexShrink: 0}}
                                            disabled={deleteMut.isPending}
                                            onClick={(e) => {
                                                e.stopPropagation()
                                                deleteMut.mutate(topic.arn)
                                            }}
                                        >
                                            {deleteMut.isPending ? <Loader2 size={11} className="spin"/> : 'Delete'}
                                        </button>
                                        <button
                                            className="btn btn-ghost"
                                            style={{padding: '1px 6px', fontSize: 11, flexShrink: 0}}
                                            onClick={(e) => {
                                                e.stopPropagation()
                                                setDelConfirm(null)
                                            }}
                                        >
                                            Cancel
                                        </button>
                                    </>
                                ) : (
                                    <button
                                        className="sns-topic-item-del"
                                        title="Delete topic"
                                        onClick={(e) => {
                                            e.stopPropagation()
                                            setDelConfirm(topic.arn)
                                        }}
                                    >
                                        <Trash2 size={13}/>
                                    </button>
                                )}
                            </div>
                        )
                    })}
                </div>
            </div>

            {/* Main panel */}
            {selected ? (
                <TopicDetail key={selected.arn} topic={selected}/>
            ) : (
                <div className="sns-empty">
                    <Bell size={40}/>
                    <span>Select a topic to manage subscriptions and publish messages</span>
                </div>
            )}

            {/* Create modal */}
            {showCreate && (
                <CreateTopicModal
                    onClose={() => setShowCreate(false)}
                    onCreate={async (name, fifo) => {
                        await createMut.mutateAsync({name, fifo})
                    }}
                />
            )}
        </div>
    )
}
