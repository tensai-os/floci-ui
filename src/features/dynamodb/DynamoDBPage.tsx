import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Database,
  Info,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Table2,
  Trash2,
  X,
} from 'lucide-react'
import { EmptyState } from '@/components/EmptyState'
import {
  createDynamoDbTable,
  deleteDynamoDbItem,
  deleteDynamoDbTable,
  listServiceResources,
  putDynamoDbItem,
  queryDynamoDbTable,
  scanDynamoDbTable,
} from '@/api/services'
import type { DynamoDbItem, DynamoDbKeyAttr } from '@/api/services'
import { formatNumber } from '@/lib/utils'
import type { ResourceSummary } from '@/api/types'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(Math.max(bytes, 1)) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

function getKeySchema(table: ResourceSummary): DynamoDbKeyAttr[] {
  return (table.metadata?.keySchema as DynamoDbKeyAttr[] | undefined) ?? []
}

function buildKey(item: DynamoDbItem, keySchema: DynamoDbKeyAttr[]): DynamoDbItem {
  return Object.fromEntries(keySchema.map((k) => [k.name, item[k.name]]))
}

function renderCell(value: unknown): React.ReactNode {
  if (value === null) return <span style={{ color: '#5f7080' }}>null</span>
  if (value === undefined) return <span style={{ color: '#5f7080' }}>—</span>
  if (typeof value === 'boolean') return <span style={{ color: '#60a5fa' }}>{String(value)}</span>
  if (typeof value === 'number') return <span style={{ color: '#34d399' }}>{String(value)}</span>
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

// ─── Table meta + key schema ──────────────────────────────────────────────────

function TableMeta({ table }: { table: ResourceSummary }) {
  const keySchema = getKeySchema(table)
  return (
    <>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
        <div className="metric-grid">
          <div>
            <p className="metric-label">Status</p>
            <p className="metric-value" style={{ textTransform: 'capitalize' }}>
              {(table.status ?? 'unknown').toLowerCase()}
            </p>
          </div>
          <div>
            <p className="metric-label">Items (approx.)</p>
            <p className="metric-value">{formatNumber(table.metadata?.itemCount as number | undefined)}</p>
          </div>
          <div>
            <p className="metric-label">Table size</p>
            <p className="metric-value">
              {table.metadata?.sizeBytes !== undefined ? formatBytes(table.metadata.sizeBytes as number) : '—'}
            </p>
          </div>
          <div>
            <p className="metric-label">Billing mode</p>
            <p className="metric-value">{(table.metadata?.billingMode as string | undefined) ?? '—'}</p>
          </div>
        </div>
      </div>

      {keySchema.length > 0 && (
        <div className="key-schema-row">
          {keySchema.map((k) => (
            <span key={k.name} className={`key-badge ${k.keyType === 'HASH' ? 'hash' : 'range'}`}>
              {k.keyType === 'HASH' ? '🔑' : '↕'} {k.name}
              <span style={{ opacity: 0.7, fontSize: 10 }}>
                ({k.attrType === 'S' ? 'String' : k.attrType === 'N' ? 'Number' : 'Binary'})
              </span>
              <span style={{ opacity: 0.5, fontSize: 10 }}>{k.keyType}</span>
            </span>
          ))}
        </div>
      )}
    </>
  )
}

// ─── Item drawer (JSON editor) ────────────────────────────────────────────────

function ItemDrawer({
  tableName,
  keySchema,
  item,
  isNew,
  onClose,
  onSaved,
}: {
  tableName: string
  keySchema: DynamoDbKeyAttr[]
  item: DynamoDbItem | null
  isNew: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const [json, setJson] = useState('')
  const [jsonError, setJsonError] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState(false)

  // Initialise JSON when item/isNew changes (key prop ensures remount)
  useEffect(() => {
    if (isNew) {
      const template: DynamoDbItem = {}
      for (const k of keySchema) {
        template[k.name] = k.attrType === 'N' ? 0 : ''
      }
      setJson(JSON.stringify(template, null, 2))
    } else if (item) {
      setJson(JSON.stringify(item, null, 2))
    }
    setJsonError(null)
    setDeleteConfirm(false)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const saveMutation = useMutation({
    mutationFn: () => {
      let parsed: DynamoDbItem
      try {
        parsed = JSON.parse(json) as DynamoDbItem
      } catch {
        throw new Error('Invalid JSON')
      }
      if (typeof parsed !== 'object' || Array.isArray(parsed) || parsed === null) {
        throw new Error('Must be a JSON object { … }')
      }
      return putDynamoDbItem(tableName, parsed)
    },
    onSuccess: () => { onSaved(); onClose() },
    onError: (err) => setJsonError(err instanceof Error ? err.message : 'Save failed'),
  })

  const deleteMutation = useMutation({
    mutationFn: () => {
      const key = buildKey(item!, keySchema)
      return deleteDynamoDbItem(tableName, key)
    },
    onSuccess: () => { onSaved(); onClose() },
    onError: (err) => setJsonError(err instanceof Error ? err.message : 'Delete failed'),
  })

  const isOpen = isNew || item !== null

  return (
    <div className={`tag-drawer ${isOpen ? 'open' : ''}`} style={{ width: 400 }}>
      <div className="tag-drawer-header">
        {isNew ? <Plus size={14} color="#8d9cad" /> : <Pencil size={14} color="#8d9cad" />}
        <h3>{isNew ? 'New item' : 'Edit item'}</h3>
        <button className="icon-btn" onClick={onClose}><X size={14} /></button>
      </div>

      <div className="tag-drawer-body" style={{ gap: 10 }}>
        {keySchema.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {keySchema.map((k) => (
              <span key={k.name} className={`key-badge ${k.keyType === 'HASH' ? 'hash' : 'range'}`} style={{ fontSize: 10 }}>
                {k.name} ({k.attrType})
              </span>
            ))}
          </div>
        )}

        <div>
          <div style={{ fontSize: 11, color: '#5f7080', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            JSON
          </div>
          <textarea
            className={`json-editor ${jsonError ? 'error' : ''}`}
            value={json}
            onChange={(e) => { setJson(e.target.value); setJsonError(null) }}
            spellCheck={false}
          />
          {jsonError && (
            <p style={{ fontSize: 12, color: '#f87171', margin: '4px 0 0' }}>{jsonError}</p>
          )}
        </div>
      </div>

      <div className="tag-drawer-footer" style={{ flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="button primary"
            disabled={saveMutation.isPending || !json.trim()}
            onClick={() => saveMutation.mutate()}
          >
            {saveMutation.isPending ? <Loader2 size={13} /> : null}
            {isNew ? 'Create item' : 'Save changes'}
          </button>
          <button className="button" onClick={onClose}>Cancel</button>
          {!isNew && item && (
            <button
              className="button danger"
              style={{ marginLeft: 'auto' }}
              disabled={deleteMutation.isPending}
              onClick={() => setDeleteConfirm(true)}
            >
              {deleteMutation.isPending ? <Loader2 size={13} /> : <Trash2 size={13} />}
              Delete
            </button>
          )}
        </div>
        {deleteConfirm && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 10px', background: 'rgba(239,68,68,0.08)', borderRadius: 4, border: '1px solid rgba(239,68,68,0.3)' }}>
            <span style={{ fontSize: 12, color: '#f87171', flex: 1 }}>Delete this item?</span>
            <button className="button danger" onClick={() => deleteMutation.mutate()} disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? <Loader2 size={12} /> : 'Yes, delete'}
            </button>
            <button className="button" onClick={() => setDeleteConfirm(false)}>Cancel</button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Create table modal ───────────────────────────────────────────────────────

function CreateTableModal({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: (name: string) => void
}) {
  const [tableName, setTableName] = useState('')
  const [pkName, setPkName] = useState('id')
  const [pkType, setPkType] = useState<'S' | 'N'>('S')
  const [hasSk, setHasSk] = useState(false)
  const [skName, setSkName] = useState('sk')
  const [skType, setSkType] = useState<'S' | 'N'>('S')
  const [billingMode, setBillingMode] = useState<'PAY_PER_REQUEST' | 'PROVISIONED'>('PAY_PER_REQUEST')
  const [err, setErr] = useState<string | null>(null)

  const createMutation = useMutation({
    mutationFn: () =>
      createDynamoDbTable(
        tableName.trim(),
        { name: pkName.trim(), type: pkType },
        hasSk && skName.trim() ? { name: skName.trim(), type: skType } : undefined,
        billingMode,
      ),
    onSuccess: () => { onCreated(tableName.trim()); onClose() },
    onError: (e) => setErr(e instanceof Error ? e.message : 'Create failed'),
  })

  const valid = tableName.trim().length >= 3 && pkName.trim().length > 0 && (!hasSk || skName.trim().length > 0)

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="create-table-modal">
        <h3>Create table</h3>

        {/* Table name */}
        <div className="modal-section">
          <p className="modal-section-title">Table name</p>
          <input
            className="input"
            style={{ width: '100%', minWidth: 'unset' }}
            autoFocus
            value={tableName}
            onChange={(e) => setTableName(e.target.value)}
            placeholder="my-table"
            onKeyDown={(e) => e.key === 'Escape' && onClose()}
          />
        </div>

        {/* Partition key */}
        <div className="modal-section">
          <p className="modal-section-title">Partition key (HASH)</p>
          <div className="field-row">
            <label>Name</label>
            <input className="input" value={pkName} onChange={(e) => setPkName(e.target.value)} placeholder="id" />
            <select className="input" value={pkType} onChange={(e) => setPkType(e.target.value as 'S' | 'N')}>
              <option value="S">String</option>
              <option value="N">Number</option>
            </select>
          </div>
        </div>

        {/* Sort key (optional) */}
        <div className="modal-section">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label className="toggle-switch" style={{ width: 32, height: 18 }}>
              <input type="checkbox" checked={hasSk} onChange={(e) => setHasSk(e.target.checked)} />
              <span className="toggle-track" />
            </label>
            <p className="modal-section-title" style={{ margin: 0 }}>Sort key (RANGE) — optional</p>
          </div>
          {hasSk && (
            <div className="field-row">
              <label>Name</label>
              <input className="input" value={skName} onChange={(e) => setSkName(e.target.value)} placeholder="sk" />
              <select className="input" value={skType} onChange={(e) => setSkType(e.target.value as 'S' | 'N')}>
                <option value="S">String</option>
                <option value="N">Number</option>
              </select>
            </div>
          )}
        </div>

        {/* Billing mode */}
        <div className="modal-section">
          <p className="modal-section-title">Billing mode</p>
          <div className="field-row">
            <label>Mode</label>
            <select
              className="input"
              value={billingMode}
              onChange={(e) => setBillingMode(e.target.value as 'PAY_PER_REQUEST' | 'PROVISIONED')}
            >
              <option value="PAY_PER_REQUEST">On-demand (PAY_PER_REQUEST)</option>
              <option value="PROVISIONED">Provisioned (5 RCU / 5 WCU)</option>
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
            {createMutation.isPending ? <Loader2 size={13} /> : <Database size={13} />}
            Create table
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Results table ────────────────────────────────────────────────────────────

function ResultsTable({
  items,
  columns,
  keySchema,
  onEdit,
  onDelete,
  deleting,
}: {
  items: DynamoDbItem[]
  columns: string[]
  keySchema: DynamoDbKeyAttr[]
  onEdit: (item: DynamoDbItem) => void
  onDelete: (item: DynamoDbItem) => void
  deleting: Set<string>
}) {
  function itemKey(item: DynamoDbItem): string {
    return JSON.stringify(buildKey(item, keySchema))
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="table">
        <thead>
          <tr>
            {columns.map((col) => {
              const ks = keySchema.find((k) => k.name === col)
              return (
                <th key={col}>
                  {col}
                  {ks && (
                    <span
                      style={{
                        marginLeft: 5,
                        fontSize: 10,
                        color: ks.keyType === 'HASH' ? '#fbbf24' : '#a78bfa',
                        fontWeight: 400,
                      }}
                    >
                      {ks.keyType}
                    </span>
                  )}
                </th>
              )
            })}
            <th style={{ width: 72 }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, i) => {
            const k = itemKey(item)
            const isDel = deleting.has(k)
            return (
              <tr key={i} style={{ opacity: isDel ? 0.4 : 1 }}>
                {columns.map((col) => (
                  <td key={col} className="mono" style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {renderCell(item[col])}
                  </td>
                ))}
                <td>
                  <span style={{ display: 'flex', gap: 4 }}>
                    <button
                      className="icon-btn"
                      title="Edit item"
                      onClick={() => onEdit(item)}
                    >
                      <Pencil size={12} />
                    </button>
                    <button
                      className="icon-btn danger"
                      title="Delete item"
                      disabled={isDel}
                      onClick={() => onDelete(item)}
                    >
                      {isDel ? <Loader2 size={12} /> : <Trash2 size={12} />}
                    </button>
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function DynamoDBPage() {
  const qc = useQueryClient()

  const [selectedTable, setSelectedTable] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'scan' | 'query'>('scan')
  const [limit, setLimit] = useState(50)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [itemDrawerItem, setItemDrawerItem] = useState<DynamoDbItem | null>(null)
  const [itemDrawerIsNew, setItemDrawerIsNew] = useState(false)
  const [drawerKey, setDrawerKey] = useState(0)    // bump to remount drawer
  const [deleting, setDeleting] = useState<Set<string>>(new Set())

  // Query tab state
  const [pkValue, setPkValue] = useState('')
  const [skOp, setSkOp] = useState('=')
  const [skValue, setSkValue] = useState('')
  const [skValue2, setSkValue2] = useState('')
  const [queryRan, setQueryRan] = useState(false)

  // ── Queries ──
  const tablesQuery = useQuery({
    queryKey: ['resources', 'dynamodb'],
    queryFn: ({ signal }) => listServiceResources('dynamodb', signal),
  })

  const selectedMeta = tablesQuery.data?.find((t) => t.name === selectedTable) ?? null
  const keySchema = selectedMeta ? getKeySchema(selectedMeta) : []
  const pkAttr = keySchema.find((k) => k.keyType === 'HASH')
  const skAttr = keySchema.find((k) => k.keyType === 'RANGE')

  const scanQuery = useQuery({
    queryKey: ['dynamodb-scan', selectedTable, limit],
    queryFn: ({ signal }) => scanDynamoDbTable(selectedTable!, limit, signal),
    enabled: Boolean(selectedTable) && activeTab === 'scan',
  })

  const queryQuery = useQuery({
    queryKey: ['dynamodb-query', selectedTable, pkValue, skOp, skValue, skValue2, limit],
    queryFn: ({ signal }) =>
      queryDynamoDbTable(
        selectedTable!,
        pkAttr!.name,
        pkAttr!.attrType === 'N' ? Number(pkValue) : pkValue,
        skAttr?.name,
        skValue ? skOp : undefined,
        skAttr && skValue ? (skAttr.attrType === 'N' ? Number(skValue) : skValue) : undefined,
        skAttr && skOp === 'between' && skValue2 ? (skAttr.attrType === 'N' ? Number(skValue2) : skValue2) : undefined,
        limit,
        signal,
      ),
    enabled: Boolean(selectedTable) && activeTab === 'query' && queryRan && Boolean(pkAttr) && Boolean(pkValue.trim()),
  })

  // ── Mutations ──
  const deleteTableMutation = useMutation({
    mutationFn: (name: string) => deleteDynamoDbTable(name),
    onSuccess: (_, name) => {
      if (selectedTable === name) setSelectedTable(null)
      void qc.invalidateQueries({ queryKey: ['resources', 'dynamodb'] })
    },
    onError: (err) => alert(`Delete table failed: ${err instanceof Error ? err.message : err}`),
  })

  // ── Select table ──
  function selectTable(name: string) {
    setSelectedTable(name)
    setActiveTab('scan')
    setPkValue('')
    setSkValue('')
    setSkValue2('')
    setQueryRan(false)
    closeDrawer()
  }

  // ── Drawer helpers ──
  function openNew() {
    setItemDrawerIsNew(true)
    setItemDrawerItem(null)
    setDrawerKey((k) => k + 1)
  }

  function openEdit(item: DynamoDbItem) {
    setItemDrawerIsNew(false)
    setItemDrawerItem(item)
    setDrawerKey((k) => k + 1)
  }

  function closeDrawer() {
    setItemDrawerItem(null)
    setItemDrawerIsNew(false)
  }

  function onItemSaved() {
    void qc.invalidateQueries({ queryKey: ['dynamodb-scan', selectedTable] })
    void qc.invalidateQueries({ queryKey: ['dynamodb-query', selectedTable] })
  }

  // ── Delete item ──
  async function handleDeleteItem(item: DynamoDbItem) {
    if (!selectedTable) return
    const key = buildKey(item, keySchema)
    const keyStr = JSON.stringify(key)
    if (!window.confirm(`Delete item with key ${keyStr}?`)) return
    setDeleting((prev) => new Set(prev).add(keyStr))
    try {
      await deleteDynamoDbItem(selectedTable, key)
      void qc.invalidateQueries({ queryKey: ['dynamodb-scan', selectedTable] })
      void qc.invalidateQueries({ queryKey: ['dynamodb-query', selectedTable] })
    } catch (err) {
      alert(`Delete failed: ${err instanceof Error ? err.message : err}`)
    } finally {
      setDeleting((prev) => { const s = new Set(prev); s.delete(keyStr); return s })
    }
  }

  // ── Delete table ──
  function handleDeleteTable(name: string) {
    if (!window.confirm(`Delete table "${name}"?\n\nThis permanently deletes the table and all its data.`)) return
    deleteTableMutation.mutate(name)
  }

  // ── Active dataset ──
  const activeData = activeTab === 'scan' ? scanQuery.data : (queryRan ? queryQuery.data : undefined)
  const activeLoading = activeTab === 'scan' ? scanQuery.isLoading : queryQuery.isFetching
  const activeError = activeTab === 'scan' ? scanQuery.isError : queryQuery.isError
  const allItems = activeData?.items ?? []
  const columns = allItems[0] ? Object.keys(allItems[0]) : []

  // Search (client-side, scan tab only)
  const [search, setSearch] = useState('')
  const filteredItems = search
    ? allItems.filter((item) => JSON.stringify(item).toLowerCase().includes(search.toLowerCase()))
    : allItems

  return (
    <>
      {/* Create table modal */}
      {showCreateModal && (
        <CreateTableModal
          onClose={() => setShowCreateModal(false)}
          onCreated={(name) => {
            void qc.invalidateQueries({ queryKey: ['resources', 'dynamodb'] })
            selectTable(name)
          }}
        />
      )}

      {/* Item drawer */}
      {selectedTable && (
        <ItemDrawer
          key={drawerKey}
          tableName={selectedTable}
          keySchema={keySchema}
          item={itemDrawerItem}
          isNew={itemDrawerIsNew}
          onClose={closeDrawer}
          onSaved={onItemSaved}
        />
      )}

      <div className="page-header">
        <div className="page-title">
          <h2>DynamoDB</h2>
          <span className="info-link">
            <Info size={11} />
            NoSQL database
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {selectedTable && (
            <button className="button primary" onClick={openNew}>
              <Plus size={13} />
              New item
            </button>
          )}
          <button className="button" onClick={() => void (selectedTable ? scanQuery.refetch() : tablesQuery.refetch())}>
            <RefreshCw size={13} />
            Refresh
          </button>
        </div>
      </div>

      <div className="split">
        {/* ── Left: table list ── */}
        <aside className="list-pane">
          <div className="widget-header">
            <Table2 size={13} color="#8d9cad" />
            <h3>Tables ({tablesQuery.data?.length ?? 0})</h3>
            <button
              className="icon-btn"
              style={{ marginLeft: 'auto' }}
              title="Create table"
              onClick={() => setShowCreateModal(true)}
            >
              <Plus size={13} />
            </button>
          </div>

          {tablesQuery.isLoading ? (
            <div className="empty"><p>Loading tables…</p></div>
          ) : tablesQuery.isError ? (
            <EmptyState icon={Table2} title="Cannot load tables" description="DynamoDB did not respond from the Floci endpoint." />
          ) : (tablesQuery.data ?? []).length === 0 ? (
            <EmptyState icon={Table2} title="No tables" description="Click + above to create a table." />
          ) : (
            (tablesQuery.data ?? []).map((table) => (
              <div
                key={table.id}
                className={`list-item ${selectedTable === table.name ? 'active' : ''}`}
                style={{ cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                onClick={() => selectTable(table.name)}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong>{table.name}</strong>
                  <span>
                    {formatNumber(table.metadata?.itemCount as number | undefined)} items
                    {table.metadata?.billingMode ? ` · ${table.metadata.billingMode}` : ''}
                  </span>
                </div>
                <button
                  className="icon-btn danger bucket-action-btn"
                  title="Delete table"
                  onClick={(e) => { e.stopPropagation(); handleDeleteTable(table.name) }}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))
          )}
        </aside>

        {/* ── Right: table detail ── */}
        <section className="detail-pane" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {!selectedTable ? (
            <div className="empty" style={{ minHeight: 400 }}>
              <div className="empty-icon"><Table2 size={24} /></div>
              <h3>Select a table</h3>
              <p>Choose a table from the list, or click + to create one.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

              {/* Table header */}
              <div className="page-header" style={{ borderBottom: 'none' }}>
                <div className="page-title">
                  <h2 style={{ fontSize: 16 }}>{selectedTable}</h2>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ color: '#8d9cad', fontSize: 12 }}>Limit</span>
                  <select
                    className="input"
                    style={{ minWidth: 'unset', width: 72 }}
                    value={limit}
                    onChange={(e) => setLimit(Number(e.target.value))}
                  >
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                  </select>
                </div>
              </div>

              {/* Table meta + key schema */}
              {selectedMeta && <TableMeta table={selectedMeta} />}

              {/* Tabs */}
              <div className="drawer-tabs" style={{ padding: '0 16px', background: 'var(--surface)' }}>
                <button
                  className={`drawer-tab ${activeTab === 'scan' ? 'active' : ''}`}
                  onClick={() => setActiveTab('scan')}
                >
                  Scan
                </button>
                <button
                  className={`drawer-tab ${activeTab === 'query' ? 'active' : ''}`}
                  onClick={() => setActiveTab('query')}
                  disabled={!pkAttr}
                >
                  Query
                </button>
              </div>

              {/* Scan controls */}
              {activeTab === 'scan' && (
                <div className="dynamo-query-bar">
                  <Search size={13} color="#8d9cad" />
                  <input
                    className="input"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Filter results…"
                    style={{ width: 220 }}
                  />
                  <span style={{ marginLeft: 'auto' }} />
                  <button className="button" onClick={() => void scanQuery.refetch()}>
                    <RefreshCw size={13} />
                    Scan
                  </button>
                </div>
              )}

              {/* Query controls */}
              {activeTab === 'query' && pkAttr && (
                <div className="dynamo-query-bar">
                  <label>{pkAttr.name} =</label>
                  <input
                    className="input"
                    value={pkValue}
                    onChange={(e) => setPkValue(e.target.value)}
                    placeholder={`${pkAttr.attrType === 'N' ? '42' : '"value"'}`}
                  />
                  {skAttr && (
                    <>
                      <label style={{ marginLeft: 8 }}>{skAttr.name}</label>
                      <select
                        className="input"
                        style={{ width: 'auto' }}
                        value={skOp}
                        onChange={(e) => setSkOp(e.target.value)}
                      >
                        <option value="=">=</option>
                        <option value="<">&lt;</option>
                        <option value="<=">&lt;=</option>
                        <option value=">">&gt;</option>
                        <option value=">=">&gt;=</option>
                        <option value="begins_with">begins_with</option>
                        <option value="between">between</option>
                      </select>
                      <input
                        className="input"
                        value={skValue}
                        onChange={(e) => setSkValue(e.target.value)}
                        placeholder="value"
                      />
                      {skOp === 'between' && (
                        <>
                          <label>and</label>
                          <input
                            className="input"
                            value={skValue2}
                            onChange={(e) => setSkValue2(e.target.value)}
                            placeholder="value2"
                          />
                        </>
                      )}
                    </>
                  )}
                  <button
                    className="button primary"
                    disabled={!pkValue.trim() || queryQuery.isFetching}
                    onClick={() => { setQueryRan(true); void queryQuery.refetch() }}
                  >
                    {queryQuery.isFetching ? <Loader2 size={13} /> : <Search size={13} />}
                    Query
                  </button>
                </div>
              )}

              {/* Results */}
              <div style={{ flex: 1, overflowY: 'auto' }}>
                <div className="widget-header">
                  <h3>Items</h3>
                  {activeData && (
                    <span style={{ marginLeft: 'auto', color: '#5f7080', fontSize: 11 }}>
                      {activeData.count} returned · {activeData.scannedCount} scanned
                    </span>
                  )}
                </div>

                {activeLoading ? (
                  <div className="empty"><p>{activeTab === 'scan' ? 'Scanning…' : 'Querying…'}</p></div>
                ) : activeError ? (
                  <EmptyState icon={Table2} title={`${activeTab === 'scan' ? 'Scan' : 'Query'} failed`} description="Check the table name and try again." />
                ) : !queryRan && activeTab === 'query' ? (
                  <EmptyState
                    icon={Search}
                    title="Ready to query"
                    description={`Enter a value for ${pkAttr?.name ?? 'the partition key'} and click Query.`}
                    compact
                  />
                ) : filteredItems.length === 0 ? (
                  <EmptyState
                    icon={Table2}
                    title={search ? 'No matches' : 'No items returned'}
                    description={search ? `Nothing matches "${search}".` : 'The table is empty or no items match the criteria.'}
                    compact
                  />
                ) : (
                  <ResultsTable
                    items={filteredItems}
                    columns={columns}
                    keySchema={keySchema}
                    onEdit={openEdit}
                    onDelete={handleDeleteItem}
                    deleting={deleting}
                  />
                )}
              </div>
            </div>
          )}
        </section>
      </div>
    </>
  )
}
