import {type ElementType, useMemo} from 'react'
import {Cloud, Database, ExternalLink, MessageSquare, Radio, Route, ShieldCheck, Table2, Zap} from 'lucide-react'
import {Navigate, useNavigate, useParams} from 'react-router-dom'
import {useQuery} from '@tanstack/react-query'
import {getCloudStatus, listClouds, listCloudResources, listCloudServices} from '@/api/cloudProxyClient'
import {CloudSelector} from '@/components/CloudSelector'
import type {CloudProvider, CloudStatus} from '@/types/cloud'

const SERVICE_PLACEHOLDERS = [
    {id: 'queue', label: 'Queue', icon: MessageSquare},
    {id: 'function', label: 'Function', icon: Zap},
    {id: 'database', label: 'Database', icon: Table2},
]

export function CloudConsoleHomePage() {
    const navigate = useNavigate()
    const params = useParams()
    const routeCloud = normalizeCloud(params.cloud)
    const cloud = routeCloud ?? 'aws'

    const cloudsQuery = useQuery({
        queryKey: ['clouds'],
        queryFn: ({signal}) => listClouds(signal),
    })

    const servicesQuery = useQuery({
        queryKey: ['cloud-services', cloud],
        queryFn: ({signal}) => listCloudServices(cloud, signal),
    })

    const statusQuery = useQuery({
        queryKey: ['cloud-status', cloud],
        queryFn: ({signal}) => getCloudStatus(cloud, signal),
        refetchInterval: 10_000,
    })

    const storageResourcesQuery = useQuery({
        queryKey: ['cloud-console-resources', cloud, 'storage'],
        queryFn: ({signal}) => listCloudResources(cloud, 'storage', undefined, signal),
        enabled: (servicesQuery.data?.some((service) => service.service === 'storage' && service.availability === 'available') ?? false)
            && statusQuery.data?.runtime === 'reachable',
    })

    const serviceCards = useMemo(() => {
        const storage = servicesQuery.data?.find((service) => service.service === 'storage')
        return [
            {
                id: 'storage',
                label: storage?.displayName ?? storageLabel(cloud),
                status: storage?.availability ?? (cloud === 'gcp' ? 'coming_soon' : 'available'),
                count: storageResourcesQuery.data?.length,
                icon: Database,
                route: `/cloud-explorer/${cloud}/storage`,
            },
            ...SERVICE_PLACEHOLDERS.map((service) => ({
                ...service,
                status: 'coming_soon' as const,
                count: undefined,
                route: undefined,
            })),
        ]
    }, [cloud, servicesQuery.data, storageResourcesQuery.data])

    if (!routeCloud) return <Navigate to="/console/aws" replace/>

    const status = statusQuery.data
    const runtimeLabel = status?.endpoint ?? (cloud === 'aws' ? 'http://localhost:4566' : cloud === 'azure' ? 'http://localhost:4577' : 'Future Floci-GP')
    const activeServices = serviceCards.filter((service) => service.status === 'available').length
    const resourceCount = storageResourcesQuery.data?.length ?? 0
    const runtimeState = runtimeLabelFor(status, statusQuery.isLoading)
    const runtimeClass = runtimeClassFor(status, statusQuery.isLoading)
    const resourceDetail = resourceDetailFor(status, statusQuery.isLoading, storageResourcesQuery.isLoading, storageResourcesQuery.isError)

    return (
        <>
            <div className="page-header cloud-explorer-header">
                <div className="page-title">
                    <Cloud size={20}/>
                    <div>
                        <h2>Console Home</h2>
                        <p className="muted">Cloud-aware local runtime overview</p>
                    </div>
                </div>
                <div className="cloud-header-selectors">
                    <label>
                        <span>Cloud</span>
                        <CloudSelector
                            clouds={cloudsQuery.data ?? []}
                            selected={cloud}
                            onSelect={(nextCloud) => navigate(`/console/${nextCloud}`)}
                        />
                    </label>
                </div>
            </div>

            <div className="content cloud-console-home">
                <section className={`console-provider-banner ${runtimeClass}`}>
                    <div>
                        <p className="eyebrow">Selected Cloud</p>
                        <h3>{cloudName(cloud)}</h3>
                        <p>{providerDescription(cloud)}</p>
                    </div>
                    <div className="console-provider-actions">
                        <button className="button primary" type="button" disabled={status?.runtime !== 'reachable'} onClick={() => navigate(`/cloud-explorer/${cloud}/storage`)}>
                            <ExternalLink size={14}/>
                            Open Storage
                        </button>
                    </div>
                </section>

                <section className="console-summary">
                    <SummaryTile label="Cloud" value={cloud.toUpperCase()} detail={runtimeLabel} icon={Cloud}/>
                    <SummaryTile label="Runtime" value={runtimeState} detail={status?.error ?? runtimeDetailFor(cloud, status)} icon={Radio} state={runtimeClass}/>
                    <SummaryTile label="Active services" value={`${activeServices}`} detail="Storage only for this first multi-cloud pass"/>
                    <SummaryTile label="Resources" value={`${resourceCount}`} detail={resourceDetail}/>
                </section>

                <section className="console-runtime-flow">
                    <FlowStep icon={Cloud} label="UI" value="Console Home"/>
                    <FlowStep icon={Route} label="Proxy" value="/api/clouds"/>
                    <FlowStep icon={ShieldCheck} label="Adapter" value={adapterLabel(cloud, status)}/>
                    <FlowStep icon={Database} label="Runtime" value={runtimeName(cloud)}/>
                </section>

                <section className="console-service-grid">
                    {serviceCards.map((service) => {
                        const Icon = service.icon
                        const isAvailable = service.status === 'available'
                        const canOpen = isAvailable && service.route && status?.runtime === 'reachable'
                        const content = (
                            <>
                                <div className="service-card-header">
                                    <div className="service-icon"><Icon size={18}/></div>
                                    <div>
                                        <h3>{service.label}</h3>
                                        <span className={isAvailable ? 'status healthy' : 'status unknown'}>
                                            {isAvailable ? 'available' : 'coming soon'}
                                        </span>
                                    </div>
                                </div>
                                <div className="console-service-meta">
                                    <strong>{service.count ?? '-'}</strong>
                                    <span>{service.id === 'storage' ? storageMetaLabel(status, storageResourcesQuery.isLoading) : 'not wired yet'}</span>
                                </div>
                            </>
                        )

                        return canOpen ? (
                            <button key={service.id} className="service-card console-service-card" type="button" onClick={() => navigate(service.route)}>
                                {content}
                            </button>
                        ) : (
                            <div key={service.id} className={`service-card console-service-card ${isAvailable ? 'blocked' : 'offline'}`}>
                                {content}
                            </div>
                        )
                    })}
                </section>
            </div>
        </>
    )
}

function SummaryTile({label, value, detail, icon, state}: {label: string; value: string; detail: string; icon?: ElementType; state?: string}) {
    const Icon = icon
    return (
        <div className={`summary-tile ${state ?? ''}`}>
            {Icon && <Icon size={16}/>}
            <span>{label}</span>
            <strong>{value}</strong>
            <small>{detail}</small>
        </div>
    )
}

function storageLabel(cloud: CloudProvider): string {
    if (cloud === 'aws') return 'S3 Storage'
    if (cloud === 'azure') return 'Blob Storage'
    return 'Storage'
}

function normalizeCloud(value?: string): CloudProvider | null {
    return value === 'aws' || value === 'azure' || value === 'gcp' ? value : null
}

function runtimeLabelFor(status: CloudStatus | undefined, loading: boolean): string {
    if (loading) return 'Checking runtime'
    if (!status) return 'Unknown'
    if (status.runtime === 'reachable') return 'Runtime reachable'
    if (status.runtime === 'unavailable') return 'Runtime unavailable'
    return 'Coming soon'
}

function runtimeClassFor(status: CloudStatus | undefined, loading: boolean): 'ready' | 'pending' | 'unavailable' {
    if (loading || !status || status.runtime === 'coming_soon') return 'pending'
    return status.runtime === 'reachable' ? 'ready' : 'unavailable'
}

function runtimeDetailFor(cloud: CloudProvider, status?: CloudStatus): string {
    if (status?.runtime === 'reachable') return 'Connected through Cloud Proxy API'
    if (status?.runtime === 'unavailable') return 'Start the selected runtime to load resources'
    if (cloud === 'gcp') return 'Adapter placeholder only'
    return 'Waiting for runtime status'
}

function resourceDetailFor(status: CloudStatus | undefined, statusLoading: boolean, resourcesLoading: boolean, resourcesError: boolean): string {
    if (statusLoading) return 'Waiting for runtime status'
    if (status?.runtime === 'unavailable') return 'Blocked until runtime is reachable'
    if (status?.runtime === 'coming_soon') return 'No adapter registered yet'
    if (resourcesLoading) return 'Loading normalized storage resources'
    if (resourcesError) return 'Resource load failed'
    return 'Normalized storage resources'
}

function storageMetaLabel(status: CloudStatus | undefined, loading: boolean): string {
    if (status?.runtime === 'unavailable') return 'runtime unavailable'
    if (status?.runtime === 'coming_soon') return 'coming soon'
    if (loading) return 'loading resources'
    return 'resources'
}

function cloudName(cloud: CloudProvider): string {
    if (cloud === 'aws') return 'AWS Local Runtime'
    if (cloud === 'azure') return 'Azure Local Runtime'
    return 'GCP Coming Soon'
}

function providerDescription(cloud: CloudProvider): string {
    if (cloud === 'aws') return 'Storage is backed by Floci AWS Core through the unified Cloud Proxy API.'
    if (cloud === 'azure') return 'Storage is backed by Floci-AZ through the same normalized storage contract.'
    return 'GCP appears as a placeholder so the layout stays ready for a future adapter.'
}

function adapterLabel(cloud: CloudProvider, status?: CloudStatus): string {
    if (cloud === 'gcp' || !status?.adapterRegistered) return 'Coming soon'
    return `${cloud.toUpperCase()} Storage`
}

function runtimeName(cloud: CloudProvider): string {
    if (cloud === 'aws') return 'Floci AWS Core'
    if (cloud === 'azure') return 'Floci-AZ'
    return 'Future Floci-GP'
}

function FlowStep({icon, label, value}: {icon: ElementType; label: string; value: string}) {
    const Icon = icon
    return (
        <div className="console-flow-step">
            <Icon size={16}/>
            <span>{label}</span>
            <strong>{value}</strong>
        </div>
    )
}
