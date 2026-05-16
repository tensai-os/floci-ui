import {useEffect, useRef, useState} from 'react'
import {useQueryClient} from '@tanstack/react-query'
import {
    ChevronRight,
    Copy,
    Database,
    File,
    FileText,
    Folder,
    FolderPlus,
    Image,
    Info,
    Loader2,
    Plus,
    RefreshCw,
    Search,
    Settings,
    Tag,
    Trash2,
    Upload,
    X,
} from 'lucide-react'
import {EmptyState} from '@/components/EmptyState'
import {
    type CreateS3BucketInput,
    s3ObjectDownloadUrl,
    type S3ObjectMetadata,
    type S3Tag,
} from '@/api/aws/s3.api'
import {
    s3QueryKeys,
    useBucketTagsQuery,
    useBucketVersioningQuery,
    useS3BucketsQuery,
    useS3ObjectMetadataQuery,
    useS3ObjectsQuery,
    useS3ObjectTagsQuery,
} from '@/api/aws/s3.queries'
import {
    useCopyS3ObjectMutation,
    useCreateS3BucketMutation,
    useDeleteS3BucketMutation,
    useDeleteS3ObjectMutation,
    useDeleteS3ObjectsMutation,
    usePutBucketTagsMutation,
    usePutBucketVersioningMutation,
    usePutS3ObjectTagsMutation,
    useUploadS3ObjectMutation,
} from '@/api/aws/s3.mutations'
import {timeAgo} from '@/lib/utils'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(Math.max(bytes, 1)) / Math.log(k))
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

function basename(key: string, prefix: string) {
    return key.startsWith(prefix) ? key.slice(prefix.length) : key
}

function fileIcon(key: string) {
    const ext = key.split('.').pop()?.toLowerCase()
    if (!ext) return <File size={13} color="#8d9cad"/>
    if (['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'ico'].includes(ext))
        return <Image size={13} color="#60a5fa"/>
    if (['json', 'xml', 'yaml', 'yml', 'toml', 'csv', 'txt', 'log', 'md'].includes(ext))
        return <FileText size={13} color="#a78bfa"/>
    return <File size={13} color="#8d9cad"/>
}

function downloadUrl(bucket: string, key: string) {
    return s3ObjectDownloadUrl(bucket, key)
}

// ─── Breadcrumb ───────────────────────────────────────────────────────────────

function Breadcrumb({
                        bucket,
                        prefix,
                        onRoot,
                        onNavigate,
                    }: {
    bucket: string
    prefix: string
    onRoot: () => void
    onNavigate: (p: string) => void
}) {
    const segments = prefix
        ? prefix.replace(/\/$/, '').split('/').map((part, idx, arr) => ({
            label: part,
            path: arr.slice(0, idx + 1).join('/') + '/',
        }))
        : []

    return (
        <div className="breadcrumb">
            <button className="breadcrumb-btn" onClick={onRoot}>Root</button>
            <span className="breadcrumb-sep"><ChevronRight size={11}/></span>
            {segments.length === 0 ? (
                <span className="breadcrumb-current">{bucket}</span>
            ) : (
                <>
                    <button className="breadcrumb-btn" onClick={() => onNavigate('')}>{bucket}</button>
                    {segments.map((seg, i) => (
                        <span key={seg.path} style={{display: 'contents'}}>
              <span className="breadcrumb-sep"><ChevronRight size={11}/></span>
                            {i === segments.length - 1 ? (
                                <span className="breadcrumb-current">{seg.label}</span>
                            ) : (
                                <button className="breadcrumb-btn" onClick={() => onNavigate(seg.path)}>
                                    {seg.label}
                                </button>
                            )}
            </span>
                    ))}
                </>
            )}
        </div>
    )
}

// ─── MetaGrid ─────────────────────────────────────────────────────────────────

function MetaGrid({meta}: { meta: S3ObjectMetadata }) {
    const rows: Array<{ label: string; value: string }> = [
        {label: 'Content-Type', value: meta.contentType ?? ''},
        {label: 'Size', value: meta.contentLength !== undefined ? formatBytes(meta.contentLength) : ''},
        {label: 'ETag', value: meta.etag ?? ''},
        {label: 'Last Modified', value: meta.lastModified ?? ''},
        {label: 'Version ID', value: meta.versionId ?? ''},
        {label: 'Cache-Control', value: meta.cacheControl ?? ''},
        {label: 'Encoding', value: meta.contentEncoding ?? ''},
        {label: 'Disposition', value: meta.contentDisposition ?? ''},
    ].filter((r) => r.value !== '')

    if (rows.length === 0) {
        return <p style={{fontSize: 12, color: '#5f7080', margin: 0}}>No metadata available.</p>
    }

    return (
        <div className="meta-grid">
            {rows.map((row) => (
                <div key={row.label} className="meta-row">
                    <span className="meta-label">{row.label}</span>
                    <span className="meta-value">{row.value}</span>
                </div>
            ))}
        </div>
    )
}

// ─── Tag editor (shared between ObjectInfoDrawer + BucketSettingsDrawer) ──────

function TagEditor({
                       tags,
                       setTags,
                       dirty,
                       setDirty,
                       saveMsg,
                       onSave,
                       isPending,
                       emptyText = 'No tags. Click + to add one.',
                       showSave = true,
                   }: {
    tags: S3Tag[]
    setTags: React.Dispatch<React.SetStateAction<S3Tag[]>>
    dirty: boolean
    setDirty: React.Dispatch<React.SetStateAction<boolean>>
    saveMsg: string | null
    onSave: () => void
    isPending: boolean
    emptyText?: string
    showSave?: boolean
}) {
    function updateTag(idx: number, field: 'key' | 'value', val: string) {
        setTags((prev) => prev.map((t, i) => (i === idx ? {...t, [field]: val} : t)))
        setDirty(true)
    }

    function removeTag(idx: number) {
        setTags((prev) => prev.filter((_, i) => i !== idx))
        setDirty(true)
    }

    function addTag() {
        setTags((prev) => [...prev, {key: '', value: ''}])
        setDirty(true)
    }

    return (
        <>
            <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr 26px', gap: '4px 6px', marginBottom: 4}}>
                <span style={{
                    fontSize: 10,
                    color: '#5f7080',
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    padding: '0 2px'
                }}>Key</span>
                <span style={{
                    fontSize: 10,
                    color: '#5f7080',
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    padding: '0 2px'
                }}>Value</span>
                <span/>
            </div>
            {tags.length === 0 ? (
                <p style={{fontSize: 12, color: '#5f7080', margin: '4px 0 8px'}}>{emptyText}</p>
            ) : (
                tags.map((tag, i) => (
                    <div key={i} className="tag-row">
                        <input className="tag-input" value={tag.key} placeholder="Key"
                               onChange={(e) => updateTag(i, 'key', e.target.value)}/>
                        <input className="tag-input" value={tag.value} placeholder="Value"
                               onChange={(e) => updateTag(i, 'value', e.target.value)}/>
                        <button className="icon-btn danger" onClick={() => removeTag(i)}><X size={12}/></button>
                    </div>
                ))
            )}
            <button className="button" style={{alignSelf: 'flex-start', marginTop: 4}} onClick={addTag}>
                <Plus size={13}/> Add tag
            </button>
            {showSave && <div style={{
                marginTop: 8,
                display: 'flex',
                gap: 8,
                alignItems: 'center',
                borderTop: '1px solid #2d3f57',
                paddingTop: 10
            }}>
                <button className="button primary" disabled={!dirty || isPending} onClick={onSave}>
                    {isPending ? <Loader2 size={13}/> : null}
                    Save tags
                </button>
                {saveMsg && (
                    <span style={{
                        fontSize: 12,
                        color: saveMsg.startsWith('Saved') ? '#4ade80' : '#f87171'
                    }}>{saveMsg}</span>
                )}
            </div>}
        </>
    )
}

// ─── Object info + tags drawer ────────────────────────────────────────────────

function ObjectInfoDrawer({
                              bucket,
                              objectKey,
                              onClose,
                          }: {
    bucket: string
    objectKey: string | null
    onClose: () => void
}) {
    const [tab, setTab] = useState<'info' | 'tags'>('info')
    const [tags, setTags] = useState<S3Tag[]>([])
    const [dirty, setDirty] = useState(false)
    const [saveMsg, setSaveMsg] = useState<string | null>(null)

    const metaQuery = useS3ObjectMetadataQuery(bucket, objectKey)

    const tagsQuery = useS3ObjectTagsQuery(bucket, objectKey)

    useEffect(() => {
        if (tagsQuery.data && !dirty) setTags(tagsQuery.data)
    }, [tagsQuery.data, dirty])

    const saveMutation = usePutS3ObjectTagsMutation({
        onSuccess: () => {
            setDirty(false)
            setSaveMsg('Saved ✓')
            setTimeout(() => setSaveMsg(null), 2500)
        },
        onError: (err) => setSaveMsg(err instanceof Error ? err.message : 'Error'),
    })

    const filename = objectKey?.split('/').pop() ?? objectKey ?? ''

    return (
        <div className={`tag-drawer ${objectKey ? 'open' : ''}`}>
            <div className="tag-drawer-header">
                <Info size={14} color="#8d9cad"/>
                <h3 title={objectKey ?? ''}>{filename}</h3>
                <button className="icon-btn" onClick={onClose}><X size={14}/></button>
            </div>

            <div className="drawer-tabs">
                <button className={`drawer-tab ${tab === 'info' ? 'active' : ''}`} onClick={() => setTab('info')}>
                    Info
                </button>
                <button className={`drawer-tab ${tab === 'tags' ? 'active' : ''}`} onClick={() => setTab('tags')}>
                    Tags
                </button>
            </div>

            <div className="tag-drawer-body">
                {tab === 'info' ? (
                    metaQuery.isLoading ? (
                        <div style={{display: 'flex', alignItems: 'center', gap: 8, color: '#5f7080', fontSize: 13}}>
                            <Loader2 size={14}/> Loading metadata…
                        </div>
                    ) : metaQuery.isError ? (
                        <p style={{color: '#f87171', fontSize: 13}}>Failed to load metadata.</p>
                    ) : metaQuery.data ? (
                        <MetaGrid meta={metaQuery.data}/>
                    ) : null
                ) : tagsQuery.isLoading ? (
                    <div style={{display: 'flex', alignItems: 'center', gap: 8, color: '#5f7080', fontSize: 13}}>
                        <Loader2 size={14}/> Loading tags…
                    </div>
                ) : tagsQuery.isError ? (
                    <p style={{color: '#f87171', fontSize: 13}}>Failed to load tags.</p>
                ) : (
                    <TagEditor
                        tags={tags}
                        setTags={setTags}
                        dirty={dirty}
                        setDirty={setDirty}
                        saveMsg={saveMsg}
                        onSave={() => saveMutation.mutate({bucket, key: objectKey!, tags})}
                        isPending={saveMutation.isPending}
                    />
                )}
            </div>
        </div>
    )
}

// ─── Bucket settings drawer ───────────────────────────────────────────────────

function BucketSettingsDrawer({
                                  bucket,
                                  open,
                                  onClose,
                              }: {
    bucket: string
    open: boolean
    onClose: () => void
}) {
    const [tab, setTab] = useState<'versioning' | 'tags'>('versioning')
    const [tags, setTags] = useState<S3Tag[]>([])
    const [dirty, setDirty] = useState(false)
    const [saveMsg, setSaveMsg] = useState<string | null>(null)

    const versioningQuery = useBucketVersioningQuery(bucket, open)

    const bucketTagsQuery = useBucketTagsQuery(bucket, open)

    useEffect(() => {
        if (!open) {
            setTags([])
            setDirty(false)
            setSaveMsg(null)
            setTab('versioning')
        }
    }, [open])

    useEffect(() => {
        if (bucketTagsQuery.data && !dirty) setTags(bucketTagsQuery.data)
    }, [bucketTagsQuery.data, dirty])

    const versioningMutation = usePutBucketVersioningMutation({
        onSuccess: () => void versioningQuery.refetch(),
    })

    const tagsMutation = usePutBucketTagsMutation({
        onSuccess: () => {
            setDirty(false)
            setSaveMsg('Saved ✓')
            setTimeout(() => setSaveMsg(null), 2500)
        },
        onError: (err) => setSaveMsg(err instanceof Error ? err.message : 'Error'),
    })

    const versioningStatus = versioningQuery.data ?? 'Unversioned'

    return (
        <div className={`tag-drawer ${open ? 'open' : ''}`}>
            <div className="tag-drawer-header">
                <Settings size={14} color="#8d9cad"/>
                <h3 title={bucket}>Settings · {bucket}</h3>
                <button className="icon-btn" onClick={onClose}><X size={14}/></button>
            </div>

            <div className="drawer-tabs">
                <button
                    className={`drawer-tab ${tab === 'versioning' ? 'active' : ''}`}
                    onClick={() => setTab('versioning')}
                >
                    Versioning
                </button>
                <button
                    className={`drawer-tab ${tab === 'tags' ? 'active' : ''}`}
                    onClick={() => setTab('tags')}
                >
                    Tags
                </button>
            </div>

            <div className="tag-drawer-body">
                {tab === 'versioning' ? (
                    versioningQuery.isLoading ? (
                        <div style={{display: 'flex', alignItems: 'center', gap: 8, color: '#5f7080', fontSize: 13}}>
                            <Loader2 size={14}/> Loading…
                        </div>
                    ) : versioningQuery.isError ? (
                        <p style={{color: '#f87171', fontSize: 13}}>Failed to load versioning config.</p>
                    ) : (
                        <>
                            <div className="versioning-toggle">
                                <label className="toggle-switch">
                                    <input
                                        type="checkbox"
                                        checked={versioningStatus === 'Enabled'}
                                        disabled={versioningMutation.isPending}
                                        onChange={(e) => versioningMutation.mutate({bucket, enabled: e.target.checked})}
                                    />
                                    <span className="toggle-track"/>
                                </label>
                                <div>
                                    <div style={{fontSize: 13, color: '#d1d1d1', fontWeight: 500}}>
                                        Versioning: <span
                                        style={{color: versioningStatus === 'Enabled' ? '#4ade80' : '#8d9cad'}}>{versioningStatus}</span>
                                    </div>
                                    <div style={{fontSize: 12, color: '#5f7080', marginTop: 3, lineHeight: 1.5}}>
                                        {versioningStatus === 'Enabled'
                                            ? 'Multiple versions of objects are preserved.'
                                            : versioningStatus === 'Suspended'
                                                ? 'Versioning is suspended. Existing versions are retained.'
                                                : 'Enable to keep all previous versions of every object.'}
                                    </div>
                                </div>
                            </div>
                            {versioningMutation.isError && (
                                <p style={{fontSize: 12, color: '#f87171', margin: 0}}>
                                    {versioningMutation.error instanceof Error ? versioningMutation.error.message : 'Update failed'}
                                </p>
                            )}
                        </>
                    )
                ) : bucketTagsQuery.isLoading ? (
                    <div style={{display: 'flex', alignItems: 'center', gap: 8, color: '#5f7080', fontSize: 13}}>
                        <Loader2 size={14}/> Loading tags…
                    </div>
                ) : (
                    <TagEditor
                        tags={tags}
                        setTags={setTags}
                        dirty={dirty}
                        setDirty={setDirty}
                        saveMsg={saveMsg}
                        onSave={() => tagsMutation.mutate({bucket, tags})}
                        isPending={tagsMutation.isPending}
                        emptyText="No bucket tags. Click + to add one."
                    />
                )}
            </div>
        </div>
    )
}

// ─── Create bucket inline bar ─────────────────────────────────────────────────

function CreateBucketBar({
                             onConfirm,
                             onCancel,
                             isPending,
                         }: {
    onConfirm: (input: CreateS3BucketInput) => void
    onCancel: () => void
    isPending: boolean
}) {
    const [name, setName] = useState('')
    const [tags, setTags] = useState<S3Tag[]>([])
    const [tagsDirty, setTagsDirty] = useState(false)
    const [versioningEnabled, setVersioningEnabled] = useState(false)
    const validTags = tags.filter((tag) => tag.key.trim() && tag.value.trim())
    const createInput: CreateS3BucketInput = {
        name: name.trim(),
        tags: validTags.length ? validTags : undefined,
        versioningEnabled,
    }

    function submit() {
        if (name.trim().length >= 3) onConfirm(createInput)
    }

    return (
        <div className="create-bucket-bar">
            <div style={{display: 'flex', alignItems: 'center', gap: 8, width: '100%'}}>
                <Database size={13} color="#ff9900"/>
                <input
                    className="input"
                    autoFocus
                    value={name}
                    onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9.-]/g, ''))}
                    placeholder="my-bucket-name"
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') submit()
                        if (e.key === 'Escape') onCancel()
                    }}
                    style={{flex: 1, minWidth: 0}}
                />
                <label style={{display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#8d9cad'}}>
                    <input
                        type="checkbox"
                        checked={versioningEnabled}
                        onChange={(e) => setVersioningEnabled(e.target.checked)}
                    />
                    Versioning
                </label>
                <button
                    className="button primary"
                    disabled={name.trim().length < 3 || isPending}
                    onClick={submit}
                >
                    {isPending ? <Loader2 size={13}/> : null}
                    Create
                </button>
                <button className="button" onClick={onCancel} disabled={isPending}><X size={13}/></button>
            </div>
            <div style={{width: '100%', marginTop: 8}}>
                <TagEditor
                    tags={tags}
                    setTags={setTags}
                    dirty={tagsDirty}
                    setDirty={setTagsDirty}
                    saveMsg={null}
                    onSave={() => undefined}
                    isPending={false}
                    emptyText="No bucket tags. Click + to add one before creating."
                    showSave={false}
                />
            </div>
        </div>
    )
}

// ─── Copy object modal ────────────────────────────────────────────────────────

function CopyModal({
                       srcBucket,
                       srcKey,
                       onClose,
                       onSuccess,
                   }: {
    srcBucket: string
    srcKey: string
    onClose: () => void
    onSuccess: () => void
}) {
    const [destBucket, setDestBucket] = useState(srcBucket)
    const [destKey, setDestKey] = useState(() => {
        const parts = srcKey.split('/')
        const filename = parts.pop() ?? srcKey
        const dir = parts.join('/')
        return dir ? `${dir}/copy-of-${filename}` : `copy-of-${filename}`
    })

    const copyMutation = useCopyS3ObjectMutation({
        onSuccess: () => {
            onSuccess();
            onClose()
        },
    })

    return (
        <div
            className="copy-modal-overlay"
            onClick={(e) => {
                if (e.target === e.currentTarget) onClose()
            }}
        >
            <div className="copy-modal">
                <h3>Copy object</h3>
                <div style={{fontSize: 12, color: '#8d9cad'}}>
                    Source:{' '}
                    <span className="mono" style={{color: '#d1d1d1'}}>
            {srcBucket}/{srcKey}
          </span>
                </div>
                <div className="form-row">
                    <label>Destination bucket</label>
                    <input
                        className="input"
                        value={destBucket}
                        onChange={(e) => setDestBucket(e.target.value)}
                    />
                </div>
                <div className="form-row">
                    <label>Destination key</label>
                    <input
                        className="input"
                        value={destKey}
                        onChange={(e) => setDestKey(e.target.value)}
                    />
                </div>
                {copyMutation.isError && (
                    <p style={{fontSize: 12, color: '#f87171', margin: 0}}>
                        {copyMutation.error instanceof Error ? copyMutation.error.message : 'Copy failed'}
                    </p>
                )}
                <div className="copy-modal-footer">
                    <button className="button" onClick={onClose} disabled={copyMutation.isPending}>
                        Cancel
                    </button>
                    <button
                        className="button primary"
                        disabled={!destBucket.trim() || !destKey.trim() || copyMutation.isPending}
                        onClick={() => copyMutation.mutate({srcBucket, srcKey, destBucket, destKey})}
                    >
                        {copyMutation.isPending ? <Loader2 size={13}/> : <Copy size={13}/>}
                        Copy
                    </button>
                </div>
            </div>
        </div>
    )
}

// ─── Upload status overlay ────────────────────────────────────────────────────

type UploadStatus = 'pending' | 'done' | 'error'

function UploadStatusBar({uploads}: { uploads: Map<string, UploadStatus> }) {
    if (uploads.size === 0) return null
    return (
        <div>
            {Array.from(uploads.entries()).map(([name, status]) => (
                <div key={name} className={`upload-item ${status}`}>
                    {status === 'pending' && <Loader2 size={12}/>}
                    {status === 'done' && '✓'}
                    {status === 'error' && '✗'}
                    <span className="mono">{name}</span>
                    <span style={{marginLeft: 'auto', color: 'inherit', opacity: 0.7}}>
            {status === 'pending' ? 'Uploading…' : status === 'done' ? 'Done' : 'Failed'}
          </span>
                </div>
            ))}
        </div>
    )
}

// ─── New folder bar ───────────────────────────────────────────────────────────

function NewFolderBar({
                          prefix,
                          onConfirm,
                          onCancel,
                      }: {
    prefix: string
    onConfirm: (name: string) => void
    onCancel: () => void
}) {
    const [name, setName] = useState('')
    return (
        <div className="new-folder-bar">
            <FolderPlus size={13} color="#539fe5"/>
            <span style={{fontSize: 12, color: '#8d9cad'}}>{prefix || '/'}</span>
            <input
                className="input"
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="folder-name"
                onKeyDown={(e) => {
                    if (e.key === 'Enter' && name.trim()) onConfirm(name.trim())
                    if (e.key === 'Escape') onCancel()
                }}
                style={{minWidth: 180, width: 180}}
            />
            <button
                className="button primary"
                disabled={!name.trim()}
                onClick={() => onConfirm(name.trim())}
            >
                Create
            </button>
            <button className="button" onClick={onCancel}><X size={13}/></button>
        </div>
    )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function S3Page() {
    const qc = useQueryClient()
    const fileInputRef = useRef<HTMLInputElement>(null)

    const [selectedBucket, setSelectedBucket] = useState<string | null>(null)
    const [prefix, setPrefix] = useState('')
    const [fileSearch, setFileSearch] = useState('')
    const [infoKey, setInfoKey] = useState<string | null>(null)
    const [settingsOpen, setSettingsOpen] = useState(false)
    const [uploads, setUploads] = useState<Map<string, UploadStatus>>(new Map())
    const [deleting, setDeleting] = useState<Set<string>>(new Set())
    const [newFolderMode, setNewFolderMode] = useState(false)
    const [createBucketMode, setCreateBucketMode] = useState(false)
    const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
    const [bulkDeleting, setBulkDeleting] = useState(false)
    const [copyKey, setCopyKey] = useState<string | null>(null)

    // ── Queries ──
    const bucketsQuery = useS3BucketsQuery()

    const objectsQuery = useS3ObjectsQuery(selectedBucket, prefix)

    // ── Mutations ──
    const uploadObjectMutation = useUploadS3ObjectMutation()
    const deleteObjectMutation = useDeleteS3ObjectMutation()
    const deleteObjectsMutation = useDeleteS3ObjectsMutation()

    const createBucketMutation = useCreateS3BucketMutation({
        onSuccess: (_, input) => {
            setCreateBucketMode(false)
            selectBucket(input.name)
        },
        onError: (err) => alert(`Create bucket failed: ${err instanceof Error ? err.message : err}`),
    })

    const deleteBucketMutation = useDeleteS3BucketMutation({
        onSuccess: (_, name) => {
            if (selectedBucket === name) goToRoot()
        },
        onError: (err) => alert(`Delete bucket failed: ${err instanceof Error ? err.message : err}`),
    })

    // ── Navigation helpers ──
    function selectBucket(name: string) {
        setSelectedBucket(name)
        setPrefix('')
        setFileSearch('')
        setInfoKey(null)
        setSettingsOpen(false)
        setNewFolderMode(false)
        setSelectedKeys(new Set())
    }

    function navigateToFolder(folderPrefix: string) {
        setPrefix(folderPrefix)
        setFileSearch('')
        setInfoKey(null)
        setNewFolderMode(false)
        setSelectedKeys(new Set())
    }

    function goToRoot() {
        setSelectedBucket(null)
        setPrefix('')
        setFileSearch('')
        setInfoKey(null)
        setSettingsOpen(false)
        setNewFolderMode(false)
        setSelectedKeys(new Set())
        setCreateBucketMode(false)
    }

    // ── Upload ──
    async function handleFiles(fileList: FileList | null) {
        if (!fileList || !selectedBucket) return
        const files = Array.from(fileList)
        setUploads((prev) => {
            const next = new Map(prev)
            files.forEach((f) => next.set(f.name, 'pending'))
            return next
        })
        await Promise.all(
            files.map(async (file) => {
                try {
                    await uploadObjectMutation.mutateAsync({
                        bucket: selectedBucket,
                        key: prefix + file.name,
                        file,
                    })
                    setUploads((prev) => new Map(prev).set(file.name, 'done'))
                } catch {
                    setUploads((prev) => new Map(prev).set(file.name, 'error'))
                }
            }),
        )
        void objectsQuery.refetch()
        setTimeout(() => setUploads(new Map()), 3500)
    }

    // ── Delete single object ──
    async function handleDelete(key: string) {
        if (!selectedBucket) return
        if (!window.confirm(`Delete "${basename(key, prefix)}"?`)) return
        setDeleting((prev) => new Set(prev).add(key))
        try {
            await deleteObjectMutation.mutateAsync({bucket: selectedBucket, key})
            void qc.invalidateQueries({queryKey: s3QueryKeys.objects(selectedBucket, prefix)})
        } catch (err) {
            alert(`Delete failed: ${err instanceof Error ? err.message : err}`)
        } finally {
            setDeleting((prev) => {
                const s = new Set(prev);
                s.delete(key);
                return s
            })
        }
    }

    // ── Bulk delete ──
    async function handleBulkDelete() {
        if (!selectedBucket || selectedKeys.size === 0) return
        if (!window.confirm(`Delete ${selectedKeys.size} object${selectedKeys.size !== 1 ? 's' : ''}? This cannot be undone.`)) return
        setBulkDeleting(true)
        try {
            await deleteObjectsMutation.mutateAsync({bucket: selectedBucket, keys: [...selectedKeys]})
            setSelectedKeys(new Set())
            void qc.invalidateQueries({queryKey: s3QueryKeys.objects(selectedBucket, prefix)})
        } catch (err) {
            alert(`Bulk delete failed: ${err instanceof Error ? err.message : err}`)
        } finally {
            setBulkDeleting(false)
        }
    }

    // ── Delete bucket ──
    function handleDeleteBucket(name: string) {
        if (!window.confirm(`Delete bucket "${name}"?\n\nThe bucket must be empty. This cannot be undone.`)) return
        deleteBucketMutation.mutate(name)
    }

    // ── New folder ──
    async function handleNewFolder(name: string) {
        if (!selectedBucket) return
        const key = prefix + name.replace(/\/$/, '') + '/'
        try {
            await uploadObjectMutation.mutateAsync({
                bucket: selectedBucket,
                key,
                file: new Blob(['']),
            })
            setNewFolderMode(false)
            void qc.invalidateQueries({queryKey: s3QueryKeys.objects(selectedBucket, prefix)})
        } catch (err) {
            alert(`Could not create folder: ${err instanceof Error ? err.message : err}`)
        }
    }

    // ── Open info drawer (closes settings) ──
    function openInfo(key: string) {
        setSettingsOpen(false)
        setInfoKey(key)
    }

    // ── Open settings drawer (closes info) ──
    function openSettings() {
        setInfoKey(null)
        setSettingsOpen((v) => !v)
    }

    // ── Filtered data ──
    const folders = objectsQuery.data?.folders ?? []
    const files = objectsQuery.data?.files ?? []
    const q = fileSearch.toLowerCase()
    const filteredFolders = q ? folders.filter((f) => f.slice(prefix.length).toLowerCase().includes(q)) : folders
    const filteredFiles = q ? files.filter((f) => f.key.toLowerCase().includes(q)) : files
    const totalItems = filteredFolders.length + filteredFiles.length

    const allSelected = filteredFiles.length > 0 && filteredFiles.every((f) => selectedKeys.has(f.key))
    const someSelected = !allSelected && filteredFiles.some((f) => selectedKeys.has(f.key))

    const summaryParts = []
    if (folders.length) summaryParts.push(`${folders.length} folder${folders.length !== 1 ? 's' : ''}`)
    if (files.length) summaryParts.push(`${files.length} file${files.length !== 1 ? 's' : ''}`)

    return (
        <>
            {/* Hidden file input */}
            <input
                ref={fileInputRef}
                type="file"
                multiple
                style={{display: 'none'}}
                onChange={(e) => void handleFiles(e.target.files)}
                onClick={(e) => {
                    (e.target as HTMLInputElement).value = ''
                }}
            />

            {/* Object info + tags drawer */}
            {selectedBucket && (
                <ObjectInfoDrawer
                    key={infoKey}
                    bucket={selectedBucket}
                    objectKey={infoKey}
                    onClose={() => setInfoKey(null)}
                />
            )}

            {/* Bucket settings drawer */}
            {selectedBucket && (
                <BucketSettingsDrawer
                    key={selectedBucket}
                    bucket={selectedBucket}
                    open={settingsOpen}
                    onClose={() => setSettingsOpen(false)}
                />
            )}

            {/* Copy object modal */}
            {selectedBucket && copyKey && (
                <CopyModal
                    key={copyKey}
                    srcBucket={selectedBucket}
                    srcKey={copyKey}
                    onClose={() => setCopyKey(null)}
                    onSuccess={() => void qc.invalidateQueries({queryKey: s3QueryKeys.objects(selectedBucket, prefix)})}
                />
            )}

            <div className="page-header">
                <div className="page-title">
                    <h2>S3</h2>
                    <span className="info-link">
            <Info size={11}/>
            Simple Storage Service
          </span>
                </div>
                <div style={{display: 'flex', gap: 8}}>
                    {selectedBucket && (
                        <>
                            <button
                                className="button primary"
                                onClick={() => fileInputRef.current?.click()}
                            >
                                <Upload size={13}/>
                                Upload
                            </button>
                            <button
                                className="button"
                                onClick={() => setNewFolderMode((v) => !v)}
                            >
                                <FolderPlus size={13}/>
                                New folder
                            </button>
                            <button
                                className={`button ${settingsOpen ? 'primary' : ''}`}
                                onClick={openSettings}
                            >
                                <Settings size={13}/>
                                Settings
                            </button>
                        </>
                    )}
                    <button
                        className="button"
                        onClick={() => void (selectedBucket ? objectsQuery.refetch() : bucketsQuery.refetch())}
                    >
                        <RefreshCw size={13}/>
                        Refresh
                    </button>
                </div>
            </div>

            <div className="split">
                {/* ── Left: bucket list ── */}
                <aside className="list-pane">
                    <div className="widget-header">
                        <Database size={13} color="#8d9cad"/>
                        <h3>Buckets ({bucketsQuery.data?.length ?? 0})</h3>
                        <button
                            className="icon-btn"
                            style={{marginLeft: 'auto'}}
                            title="Create bucket"
                            onClick={() => setCreateBucketMode((v) => !v)}
                        >
                            <Plus size={13}/>
                        </button>
                    </div>

                    {createBucketMode && (
                        <CreateBucketBar
                            onConfirm={(input) => createBucketMutation.mutate(input)}
                            onCancel={() => setCreateBucketMode(false)}
                            isPending={createBucketMutation.isPending}
                        />
                    )}

                    {bucketsQuery.isLoading ? (
                        <div className="empty"><p>Loading buckets…</p></div>
                    ) : bucketsQuery.isError ? (
                        <EmptyState icon={Database} title="Cannot load buckets"
                                    description="S3 did not respond from the Floci endpoint."/>
                    ) : (bucketsQuery.data ?? []).length === 0 ? (
                        <EmptyState icon={Database} title="No buckets"
                                    description='Click + above or use the AWS CLI to create a bucket.'/>
                    ) : (
                        (bucketsQuery.data ?? []).map((bucket) => (
                            <div
                                key={bucket.id}
                                className={`list-item ${selectedBucket === bucket.name ? 'active' : ''}`}
                                style={{cursor: 'pointer', display: 'flex', alignItems: 'center'}}
                                onClick={() => selectBucket(bucket.name)}
                            >
                                <div style={{flex: 1, minWidth: 0}}>
                                    <strong>{bucket.name}</strong>
                                    <span>Created {timeAgo(bucket.metadata?.createdAt as string | undefined)}</span>
                                </div>
                                <div style={{display: 'flex', gap: 2, flexShrink: 0}}>
                                    <button
                                        className="icon-btn bucket-action-btn"
                                        title="Bucket settings"
                                        onClick={(e) => {
                                            e.stopPropagation()
                                            selectBucket(bucket.name)
                                            setTimeout(() => {
                                                setInfoKey(null);
                                                setSettingsOpen(true)
                                            }, 0)
                                        }}
                                    >
                                        <Settings size={12}/>
                                    </button>
                                    <button
                                        className="icon-btn danger bucket-action-btn"
                                        title="Delete bucket"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleDeleteBucket(bucket.name)
                                        }}
                                    >
                                        <Trash2 size={12}/>
                                    </button>
                                </div>
                            </div>
                        ))
                    )}
                </aside>

                {/* ── Right: object browser ── */}
                <section
                    className="detail-pane"
                    style={{display: 'flex', flexDirection: 'column', overflow: 'hidden'}}
                >
                    {!selectedBucket ? (
                        <div className="empty" style={{minHeight: 400}}>
                            <div className="empty-icon"><Database size={24}/></div>
                            <h3>Select a bucket</h3>
                            <p>Choose a bucket from the list, or click + to create one.</p>
                        </div>
                    ) : (
                        <div style={{display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden'}}>

                            {/* Breadcrumb */}
                            <Breadcrumb
                                bucket={selectedBucket}
                                prefix={prefix}
                                onRoot={goToRoot}
                                onNavigate={navigateToFolder}
                            />

                            {/* New folder bar */}
                            {newFolderMode && (
                                <NewFolderBar
                                    prefix={prefix}
                                    onConfirm={handleNewFolder}
                                    onCancel={() => setNewFolderMode(false)}
                                />
                            )}

                            {/* Upload status */}
                            <UploadStatusBar uploads={uploads}/>

                            {/* Search + summary */}
                            <div className="input-row">
                                <Search size={14} color="#8d9cad"/>
                                <input
                                    className="input"
                                    value={fileSearch}
                                    onChange={(e) => setFileSearch(e.target.value)}
                                    placeholder="Search files and folders…"
                                />
                                {(folders.length > 0 || files.length > 0) && (
                                    <span style={{color: '#5f7080', fontSize: 11, whiteSpace: 'nowrap'}}>
                    {summaryParts.join(', ')}
                  </span>
                                )}
                            </div>

                            {/* Table */}
                            <div style={{flex: 1, overflowY: 'auto'}}>
                                {objectsQuery.isLoading ? (
                                    <div className="empty"><p>Loading objects…</p></div>
                                ) : objectsQuery.isError ? (
                                    <EmptyState icon={File} title="Cannot load objects"
                                                description="Failed to list objects in this bucket."/>
                                ) : totalItems === 0 && !fileSearch ? (
                                    <EmptyState
                                        icon={Folder}
                                        title={prefix ? 'Empty folder' : 'Bucket is empty'}
                                        description={
                                            prefix
                                                ? 'No files here yet. Click Upload to add some.'
                                                : 'This bucket has no objects. Click Upload to add files.'
                                        }
                                    />
                                ) : totalItems === 0 ? (
                                    <EmptyState icon={Search} title="No results"
                                                description={`Nothing matches "${fileSearch}".`}/>
                                ) : (
                                    <table className="table">
                                        <thead>
                                        <tr>
                                            <th style={{width: 36, textAlign: 'center'}}>
                                                <input
                                                    type="checkbox"
                                                    ref={(el) => {
                                                        if (el) el.indeterminate = someSelected
                                                    }}
                                                    checked={allSelected}
                                                    onChange={() => {
                                                        if (allSelected) setSelectedKeys(new Set())
                                                        else setSelectedKeys(new Set(filteredFiles.map((f) => f.key)))
                                                    }}
                                                />
                                            </th>
                                            <th>Name</th>
                                            <th style={{width: 80}}>Type</th>
                                            <th style={{width: 90}}>Size</th>
                                            <th style={{width: 120}}>Last modified</th>
                                            <th style={{width: 108}}>Actions</th>
                                        </tr>
                                        </thead>
                                        <tbody>
                                        {/* Folders */}
                                        {filteredFolders.map((folder) => {
                                            const name = folder.slice(prefix.length).replace(/\/$/, '') || folder
                                            return (
                                                <tr
                                                    key={folder}
                                                    style={{cursor: 'pointer'}}
                                                    onClick={() => navigateToFolder(folder)}
                                                >
                                                    <td/>
                                                    <td>
                              <span style={{display: 'flex', alignItems: 'center', gap: 8}}>
                                <Folder size={14} color="#f59e0b" style={{flexShrink: 0}}/>
                                <span style={{color: '#539fe5'}}>{name}/</span>
                              </span>
                                                    </td>
                                                    <td style={{color: '#5f7080'}}>Folder</td>
                                                    <td style={{color: '#5f7080'}}>—</td>
                                                    <td style={{color: '#5f7080'}}>—</td>
                                                    <td/>
                                                </tr>
                                            )
                                        })}

                                        {/* Files */}
                                        {filteredFiles.map((obj) => {
                                            const name = basename(obj.key, prefix)
                                            const isDeleting = deleting.has(obj.key)
                                            const isSelected = selectedKeys.has(obj.key)
                                            return (
                                                <tr
                                                    key={obj.key}
                                                    style={{
                                                        opacity: isDeleting ? 0.4 : 1,
                                                        background: isSelected ? 'rgba(83,159,229,0.07)' : undefined,
                                                    }}
                                                >
                                                    <td style={{textAlign: 'center'}}>
                                                        <input
                                                            type="checkbox"
                                                            checked={isSelected}
                                                            onChange={(e) => {
                                                                const next = new Set(selectedKeys)
                                                                if (e.target.checked) next.add(obj.key)
                                                                else next.delete(obj.key)
                                                                setSelectedKeys(next)
                                                            }}
                                                            onClick={(e) => e.stopPropagation()}
                                                        />
                                                    </td>
                                                    <td>
                              <span style={{display: 'flex', alignItems: 'center', gap: 8}}>
                                {fileIcon(obj.key)}
                                  <span className="mono" style={{fontSize: 12}}>{name}</span>
                              </span>
                                                    </td>
                                                    <td style={{color: '#5f7080'}}>Object</td>
                                                    <td>{formatBytes(obj.size)}</td>
                                                    <td style={{color: '#8d9cad'}}>
                                                        {obj.lastModified ? timeAgo(obj.lastModified) : '—'}
                                                    </td>
                                                    <td>
                              <span style={{display: 'flex', gap: 3}}>
                                {/* Info */}
                                  <button
                                      className="icon-btn"
                                      title="Info & tags"
                                      onClick={(e) => {
                                          e.stopPropagation();
                                          openInfo(obj.key)
                                      }}
                                  >
                                  <Tag size={12}/>
                                </button>
                                  {/* Download */}
                                  <a
                                      className="icon-btn"
                                      href={downloadUrl(selectedBucket, obj.key)}
                                      download={name}
                                      title="Download"
                                      onClick={(e) => e.stopPropagation()}
                                      style={{
                                          display: 'inline-flex',
                                          alignItems: 'center',
                                          justifyContent: 'center',
                                          textDecoration: 'none',
                                          fontSize: 13
                                      }}
                                  >
                                  ⬇
                                </a>
                                  {/* Copy */}
                                  <button
                                      className="icon-btn"
                                      title="Copy object"
                                      onClick={(e) => {
                                          e.stopPropagation();
                                          setCopyKey(obj.key)
                                      }}
                                  >
                                  <Copy size={12}/>
                                </button>
                                  {/* Delete */}
                                  <button
                                      className="icon-btn danger"
                                      title="Delete"
                                      disabled={isDeleting}
                                      onClick={(e) => {
                                          e.stopPropagation();
                                          void handleDelete(obj.key)
                                      }}
                                  >
                                  {isDeleting ? <Loader2 size={12}/> : <Trash2 size={12}/>}
                                </button>
                              </span>
                                                    </td>
                                                </tr>
                                            )
                                        })}
                                        </tbody>
                                    </table>
                                )}
                            </div>

                            {/* Bulk action bar */}
                            {selectedKeys.size > 0 && (
                                <div className="bulk-bar">
                  <span className="bulk-count">
                    {selectedKeys.size} object{selectedKeys.size !== 1 ? 's' : ''} selected
                  </span>
                                    <span className="bulk-spacer"/>
                                    <button
                                        className="button"
                                        style={{
                                            background: 'rgba(255,255,255,0.12)',
                                            borderColor: 'rgba(255,255,255,0.25)',
                                            color: 'white'
                                        }}
                                        onClick={() => setSelectedKeys(new Set())}
                                    >
                                        Deselect all
                                    </button>
                                    <button
                                        className="button danger"
                                        disabled={bulkDeleting}
                                        onClick={() => void handleBulkDelete()}
                                    >
                                        {bulkDeleting ? <Loader2 size={13}/> : <Trash2 size={13}/>}
                                        Delete {selectedKeys.size}
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </section>
            </div>
        </>
    )
}
