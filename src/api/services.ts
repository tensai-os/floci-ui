import {
    flociGetJson,
    flociGetXml,
    flociJsonAction,
    flociQueryAction,
    flociRestJson,
    IS_MOCK_MODE,
    PROXY
} from './floci-client'
import type {
    ConsoleOverview,
    CWAlarm,
    CWLogEvent,
    CWLogGroup,
    CWLogStream,
    CWMetric,
    HealthReport,
    ResourceSummary,
    ServiceInfo,
    ServiceName,
    ServiceResourceSnapshot,
    ServiceStatus,
} from './types'

export const SERVICE_META: Array<{
    name: ServiceName
    displayName: string
    route: string
    implemented: boolean
    resourceLabel: string
}> = [
    {
        name: 'cloudwatch',
        displayName: 'CloudWatch',
        route: '/cloudwatch',
        implemented: true,
        resourceLabel: 'log groups'
    },
    {name: 's3', displayName: 'S3', route: '/s3', implemented: true, resourceLabel: 'buckets'},
    {name: 'sqs', displayName: 'SQS', route: '/sqs', implemented: true, resourceLabel: 'queues'},
    {name: 'lambda', displayName: 'Lambda', route: '/lambda', implemented: true, resourceLabel: 'functions'},
    {name: 'dynamodb', displayName: 'DynamoDB', route: '/dynamodb', implemented: true, resourceLabel: 'tables'},
    {name: 'sns', displayName: 'SNS', route: '/sns', implemented: true, resourceLabel: 'topics'},
    {
        name: 'secretsmanager',
        displayName: 'Secrets Manager',
        route: '/secretsmanager',
        implemented: false,
        resourceLabel: 'secrets'
    },
    {name: 'cognito', displayName: 'Cognito', route: '/cognito', implemented: false, resourceLabel: 'user pools'},
    {name: 'rds', displayName: 'RDS', route: '/rds', implemented: false, resourceLabel: 'instances'},
    {
        name: 'elasticache',
        displayName: 'ElastiCache',
        route: '/elasticache',
        implemented: false,
        resourceLabel: 'clusters'
    },
    {name: 'iam', displayName: 'IAM', route: '/iam', implemented: false, resourceLabel: 'roles'},
    {name: 'ssm', displayName: 'Systems Manager', route: '/ssm', implemented: false, resourceLabel: 'parameters'},
    {name: 'kms', displayName: 'KMS', route: '/kms', implemented: false, resourceLabel: 'keys'},
]

const LOGS = (op: string) => `Logs_20140328.${op}`
const METRICS = (op: string) => `GraniteServiceVersion20100801.${op}`
const DYNAMODB = (op: string) => `DynamoDB_20120810.${op}`

type FlociHealthResponse = {
    version?: string
    services?: Record<string, string>
}

function normalizeStatus(value?: string): ServiceStatus {
    if (!value) return 'unknown'
    const normalized = value.toLowerCase()
    if (normalized === 'running' || normalized === 'healthy' || normalized === 'enabled') return 'healthy'
    if (normalized === 'available' || normalized === 'disabled') return 'unknown'
    if (normalized === 'degraded') return 'degraded'
    if (normalized === 'unavailable' || normalized === 'error' || normalized === 'down') return 'unavailable'
    return 'unknown'
}

function serviceHealth(raw: Record<string, string>, name: ServiceName): ServiceStatus {
    if (name === 'cloudwatch') {
        const logs = normalizeStatus(raw.logs ?? raw.cloudwatchlogs)
        const metrics = normalizeStatus(raw.monitoring ?? raw.cloudwatchmetrics)
        if (logs === 'healthy' || metrics === 'healthy') return 'healthy'
        if (logs === 'unavailable' || metrics === 'unavailable') return 'degraded'
        return 'unknown'
    }
    if (name === 'cognito') return normalizeStatus(raw['cognito-idp'] ?? raw.cognito)
    return normalizeStatus(raw[name])
}

function buildServiceInfo(meta: (typeof SERVICE_META)[number], raw: Record<string, string>): ServiceInfo {
    return {
        name: meta.name,
        displayName: meta.displayName,
        status: serviceHealth(raw, meta.name),
        requestCount: 0,
        errorCount: 0,
    }
}

function parseXml(xml: string): Document {
    return new DOMParser().parseFromString(xml, 'application/xml')
}

function textContent(node: ParentNode, tagName: string): string | undefined {
    return node.querySelector(tagName)?.textContent ?? undefined
}

function epochMs(value?: string | number): number | undefined {
    if (value === undefined || value === null || value === '') return undefined
    if (typeof value === 'number') return value > 0 && value < 100000000000 ? value * 1000 : value
    const asNumber = Number(value)
    if (Number.isFinite(asNumber)) return asNumber > 0 && asNumber < 100000000000 ? asNumber * 1000 : asNumber
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : undefined
}

async function timedCount(service: ServiceName, signal?: AbortSignal): Promise<ServiceResourceSnapshot> {
    const meta = SERVICE_META.find((item) => item.name === service)
    const displayName = meta?.displayName ?? service
    const started = performance.now()

    if (!meta?.implemented) {
        return {service, displayName, implemented: false, status: 'unknown'}
    }

    try {
        const resources = await listServiceResources(service, signal)
        return {
            service,
            displayName,
            implemented: true,
            status: 'healthy',
            count: resources.length,
            latencyMs: Math.round(performance.now() - started),
        }
    } catch (error) {
        return {
            service,
            displayName,
            implemented: true,
            status: 'unavailable',
            latencyMs: Math.round(performance.now() - started),
            error: error instanceof Error ? error.message : 'Request failed',
        }
    }
}

export async function fetchHealth(signal?: AbortSignal): Promise<HealthReport> {
    if (IS_MOCK_MODE) return {status: 'unknown', services: [], checkedAt: new Date().toISOString()}

    const health = await flociGetJson<FlociHealthResponse>('/_floci/health', 'health', signal)
    const raw = health.services ?? {}
    const services = SERVICE_META.map((meta) => buildServiceInfo(meta, raw))
    const implemented = services.filter((svc) => SERVICE_META.find((meta) => meta.name === svc.name)?.implemented)
    const status = implemented.some((svc) => svc.status === 'unavailable')
        ? 'degraded'
        : implemented.some((svc) => svc.status === 'healthy')
            ? 'healthy'
            : 'unknown'

    return {status, services, checkedAt: new Date().toISOString(), version: health.version}
}

export async function fetchConsoleOverview(signal?: AbortSignal): Promise<ConsoleOverview> {
    if (IS_MOCK_MODE) {
        const health: HealthReport = {status: 'unknown', services: [], checkedAt: new Date().toISOString()}
        return {
            checkedAt: health.checkedAt,
            health,
            resources: [],
            logGroupCount: 0,
            alarmCount: 0,
            metricCount: 0,
            totalResourceCount: 0
        }
    }

    const [health, resources, logGroups, alarms, metrics] = await Promise.all([
        fetchHealth(signal),
        Promise.all(['s3', 'sqs', 'lambda', 'dynamodb', 'sns'].map((service) => timedCount(service as ServiceName, signal))),
        listLogGroups(undefined, signal).catch(() => []),
        listAlarms(signal).catch(() => []),
        listMetrics(signal).catch(() => []),
    ])

    return {
        checkedAt: new Date().toISOString(),
        health,
        resources,
        logGroupCount: logGroups.length,
        alarmCount: alarms.length,
        metricCount: metrics.length,
        totalResourceCount: resources.reduce((sum, svc) => sum + (svc.count ?? 0), 0),
    }
}

export async function listServiceResources(service: ServiceName, signal?: AbortSignal): Promise<ResourceSummary[]> {
    if (IS_MOCK_MODE) return []

    if (service === 's3') return listS3Buckets(signal)
    if (service === 'sqs') return listSqsQueues(signal)
    if (service === 'sns') return listSnsTopics(signal)
    if (service === 'lambda') return listLambdaFunctions(signal)
    if (service === 'dynamodb') return listDynamoDbTables(signal)
    if (service === 'cloudwatch') return listCloudWatchResources(signal)

    return []
}

async function listS3Buckets(signal?: AbortSignal): Promise<ResourceSummary[]> {
    const xml = await flociGetXml('/', signal)
    const doc = parseXml(xml)
    return Array.from(doc.querySelectorAll('Bucket')).map((bucket) => {
        const name = textContent(bucket, 'Name') ?? ''
        return {
            id: name,
            name,
            status: 'available',
            metadata: {createdAt: textContent(bucket, 'CreationDate')},
        }
    }).filter((bucket) => bucket.name)
}

async function listSqsQueues(signal?: AbortSignal): Promise<ResourceSummary[]> {
    const xml = await flociQueryAction({Action: 'ListQueues'}, signal)
    const doc = parseXml(xml)
    return Array.from(doc.querySelectorAll('QueueUrl')).map((url) => {
        const queueUrl = url.textContent ?? ''
        const name = queueUrl.split('/').filter(Boolean).pop() ?? queueUrl
        return {id: queueUrl || name, name, status: 'available', metadata: {queueUrl}}
    }).filter((queue) => queue.name)
}

async function listSnsTopics(signal?: AbortSignal): Promise<ResourceSummary[]> {
    const xml = await flociQueryAction({Action: 'ListTopics'}, signal)
    const doc = parseXml(xml)
    return Array.from(doc.querySelectorAll('TopicArn')).map((arn) => {
        const value = arn.textContent ?? ''
        const name = value.split(':').pop() ?? value
        return {id: value || name, name, status: 'available', metadata: {arn: value}}
    }).filter((topic) => topic.name)
}

async function listLambdaFunctions(signal?: AbortSignal): Promise<ResourceSummary[]> {
    const res = await flociRestJson<{
        Functions?: Array<{
            FunctionName: string
            FunctionArn?: string
            Runtime?: string
            Handler?: string
            State?: string
            LastModified?: string
            MemorySize?: number
            Timeout?: number
            CodeSize?: number
            PackageType?: string
            Description?: string
        }>
    }>('/2015-03-31/functions', 'lambda', 'GET', undefined, signal)

    return (res.Functions ?? []).map((fn) => ({
        id: fn.FunctionArn ?? fn.FunctionName,
        name: fn.FunctionName,
        status: fn.State ?? 'Active',
        description: fn.Description ?? fn.Handler,
        metadata: {
            runtime: fn.Runtime,
            handler: fn.Handler,
            memoryMb: fn.MemorySize,
            timeoutSec: fn.Timeout,
            codeSize: fn.CodeSize,
            packageType: fn.PackageType,
            lastModified: fn.LastModified,
        },
    }))
}

async function listDynamoDbTables(signal?: AbortSignal): Promise<ResourceSummary[]> {
    const res = await flociJsonAction<{ TableNames?: string[] }>(DYNAMODB('ListTables'), {}, signal)
    const tables = res.TableNames ?? []
    const described = await Promise.all(
        tables.map(async (tableName) => {
            try {
                const detail = await flociJsonAction<{
                    Table?: {
                        TableName?: string
                        TableStatus?: string
                        TableArn?: string
                        CreationDateTime?: number
                        ItemCount?: number
                        TableSizeBytes?: number
                        BillingModeSummary?: { BillingMode?: string }
                        KeySchema?: Array<{ AttributeName: string; KeyType: 'HASH' | 'RANGE' }>
                        AttributeDefinitions?: Array<{ AttributeName: string; AttributeType: 'S' | 'N' | 'B' }>
                    }
                }>(DYNAMODB('DescribeTable'), {TableName: tableName}, signal)
                const table = detail.Table
                const attrMap = Object.fromEntries(
                    (table?.AttributeDefinitions ?? []).map((a) => [a.AttributeName, a.AttributeType])
                )
                const keySchema = (table?.KeySchema ?? []).map((k) => ({
                    name: k.AttributeName,
                    keyType: k.KeyType,
                    attrType: attrMap[k.AttributeName] ?? 'S',
                }))
                return {
                    id: table?.TableArn ?? tableName,
                    name: table?.TableName ?? tableName,
                    status: table?.TableStatus ?? 'unknown',
                    metadata: {
                        itemCount: table?.ItemCount,
                        sizeBytes: table?.TableSizeBytes,
                        billingMode: table?.BillingModeSummary?.BillingMode,
                        createdAt: epochMs(table?.CreationDateTime),
                        keySchema,
                    },
                }
            } catch {
                return {id: tableName, name: tableName, status: 'unknown'}
            }
        })
    )
    return described
}

async function listCloudWatchResources(signal?: AbortSignal): Promise<ResourceSummary[]> {
    const [groups, alarms, metrics] = await Promise.all([
        listLogGroups(undefined, signal).catch(() => []),
        listAlarms(signal).catch(() => []),
        listMetrics(signal).catch(() => []),
    ])

    return [
        ...groups.map((group) => ({
            id: `log-group:${group.name}`,
            name: group.name,
            status: 'log group',
            metadata: {storedBytes: group.storedBytes, createdAt: group.createdAt},
        })),
        ...alarms.map((alarm) => ({
            id: `alarm:${alarm.alarmName}`,
            name: alarm.alarmName,
            status: alarm.stateValue,
            metadata: {metricName: alarm.metricName, namespace: alarm.namespace, threshold: alarm.threshold},
        })),
        ...metrics.map((metric) => ({
            id: `metric:${metric.id}`,
            name: `${metric.namespace}/${metric.metricName}`,
            status: 'metric',
            metadata: {dimensions: metric.dimensions.length},
        })),
    ]
}

export async function listLogGroups(prefix?: string, signal?: AbortSignal): Promise<CWLogGroup[]> {
    if (IS_MOCK_MODE) return []
    const res = await flociJsonAction<{
        logGroups?: Array<{
            logGroupName: string
            arn?: string
            createdTime?: number
            creationTime?: number
            storedBytes?: number
            metricFilterCount?: number
            retentionInDays?: number
        }>
    }>(LOGS('DescribeLogGroups'), prefix ? {logGroupNamePrefix: prefix} : {}, signal)

    return (res.logGroups ?? []).map((group) => ({
        name: group.logGroupName,
        arn: group.arn,
        retentionInDays: group.retentionInDays,
        createdAt: group.createdTime ?? group.creationTime ?? 0,
        storedBytes: group.storedBytes ?? 0,
        metricFilterCount: group.metricFilterCount ?? 0,
    }))
}

export async function listLogStreams(logGroupName: string, signal?: AbortSignal): Promise<CWLogStream[]> {
    if (IS_MOCK_MODE || !logGroupName) return []
    const res = await flociJsonAction<{
        logStreams?: Array<{
            logStreamName: string
            createdTime?: number
            creationTime?: number
            firstEventTimestamp?: number
            lastEventTimestamp?: number
            lastIngestionTime?: number
            storedBytes?: number
        }>
    }>(LOGS('DescribeLogStreams'), {logGroupName, orderBy: 'LastEventTime', descending: true}, signal)

    return (res.logStreams ?? []).map((stream) => ({
        name: stream.logStreamName,
        createdAt: stream.createdTime ?? stream.creationTime,
        firstEventAt: stream.firstEventTimestamp,
        lastEventAt: stream.lastEventTimestamp,
        lastIngestionAt: stream.lastIngestionTime,
        storedBytes: stream.storedBytes ?? 0,
    }))
}

export async function getLogEvents(logGroupName: string, logStreamName: string, signal?: AbortSignal): Promise<CWLogEvent[]> {
    if (IS_MOCK_MODE || !logGroupName || !logStreamName) return []
    const res = await flociJsonAction<{
        events?: Array<{ timestamp?: number; message?: string; ingestionTime?: number }>
    }>(
        LOGS('GetLogEvents'),
        {logGroupName, logStreamName, startFromHead: false},
        signal
    )
    return (res.events ?? []).map((event, index) => ({
        id: `${event.timestamp ?? 0}-${index}`,
        timestamp: event.timestamp ?? 0,
        message: event.message ?? '',
        ingestionTime: event.ingestionTime,
    }))
}

export async function listAlarms(signal?: AbortSignal): Promise<CWAlarm[]> {
    if (IS_MOCK_MODE) return []
    const res = await flociJsonAction<{
        MetricAlarms?: Array<{
            AlarmName: string
            StateValue?: CWAlarm['stateValue']
            StateReason?: string
            MetricName?: string
            Namespace?: string
            Threshold?: number
        }>
    }>(METRICS('DescribeAlarms'), {}, signal)

    return (res.MetricAlarms ?? []).map((alarm) => ({
        alarmName: alarm.AlarmName,
        stateValue: alarm.StateValue ?? 'INSUFFICIENT_DATA',
        stateReason: alarm.StateReason,
        metricName: alarm.MetricName,
        namespace: alarm.Namespace,
        threshold: alarm.Threshold,
    }))
}

export async function listMetrics(signal?: AbortSignal): Promise<CWMetric[]> {
    if (IS_MOCK_MODE) return []
    const res = await flociJsonAction<{
        Metrics?: Array<{
            Namespace?: string
            MetricName?: string
            Dimensions?: Array<{ Name?: string; Value?: string }>
        }>
    }>(METRICS('ListMetrics'), {}, signal)

    return (res.Metrics ?? []).map((metric, index) => {
        const namespace = metric.Namespace ?? 'Unknown'
        const metricName = metric.MetricName ?? 'UnnamedMetric'
        const dimensions = (metric.Dimensions ?? []).map((dimension) => ({
            name: dimension.Name ?? '',
            value: dimension.Value ?? '',
        }))
        return {
            id: `${namespace}:${metricName}:${dimensions.map((dimension) => `${dimension.name}=${dimension.value}`).join(',') || index}`,
            namespace,
            metricName,
            dimensions,
        }
    })
}

// ─── CloudWatch write operations (used by the ingestor) ──────────────────────

export async function createLogGroup(logGroupName: string, retentionInDays?: number): Promise<void> {
    await flociJsonAction(
        LOGS('CreateLogGroup'),
        retentionInDays ? {logGroupName, retentionInDays} : {logGroupName},
    )
}

export async function createLogStream(logGroupName: string, logStreamName: string): Promise<void> {
    await flociJsonAction(LOGS('CreateLogStream'), {logGroupName, logStreamName})
}

export async function putLogEvents(
    logGroupName: string,
    logStreamName: string,
    logEvents: Array<{ timestamp: number; message: string }>,
): Promise<void> {
    await flociJsonAction(LOGS('PutLogEvents'), {logGroupName, logStreamName, logEvents})
}

export async function deleteLogGroup(logGroupName: string, signal?: AbortSignal): Promise<void> {
    await flociJsonAction(LOGS('DeleteLogGroup'), {logGroupName}, signal)
}

export async function deleteLogStream(logGroupName: string, logStreamName: string, signal?: AbortSignal): Promise<void> {
    await flociJsonAction(LOGS('DeleteLogStream'), {logGroupName, logStreamName}, signal)
}

// ─── Lambda actions ──────────────────────────────────────────────────────────

export interface LambdaFunctionConfig {
    functionName: string
    functionArn?: string
    runtime?: string
    handler?: string
    codeSize?: number
    description?: string
    timeout?: number
    memorySize?: number
    lastModified?: string
    state?: string
    stateReason?: string
    packageType?: string
    architectures?: string[]
    role?: string
    environment?: Record<string, string>
}

export async function getLambdaFunction(name: string, signal?: AbortSignal): Promise<LambdaFunctionConfig> {
    const res = await flociRestJson<{
        FunctionName?: string
        FunctionArn?: string
        Runtime?: string
        Handler?: string
        CodeSize?: number
        Description?: string
        Timeout?: number
        MemorySize?: number
        LastModified?: string
        State?: string
        StateReason?: string
        PackageType?: string
        Architectures?: string[]
        Role?: string
        Environment?: { Variables?: Record<string, string> }
    }>(`/2015-03-31/functions/${encodeURIComponent(name)}/configuration`, 'lambda', 'GET', undefined, signal)
    return {
        functionName: res.FunctionName ?? name,
        functionArn: res.FunctionArn,
        runtime: res.Runtime,
        handler: res.Handler,
        codeSize: res.CodeSize,
        description: res.Description,
        timeout: res.Timeout,
        memorySize: res.MemorySize,
        lastModified: res.LastModified,
        state: res.State,
        stateReason: res.StateReason,
        packageType: res.PackageType,
        architectures: res.Architectures,
        role: res.Role,
        environment: res.Environment?.Variables,
    }
}

export interface LambdaInvokeResult {
    statusCode: number
    payload: string
    functionError?: string
    logResult?: string
    executionDuration: number
}

export async function invokeLambdaFunction(name: string, payload = '{}', signal?: AbortSignal): Promise<LambdaInvokeResult> {
    const start = performance.now()
    const res = await fetch(`${PROXY}/2015-03-31/functions/${encodeURIComponent(name)}/invocations`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: payload,
        signal,
    })
    const body = await res.text()
    const duration = Math.round(performance.now() - start)
    let logResult: string | undefined
    const logB64 = res.headers.get('x-amz-log-result')
    if (logB64) {
        try {
            logResult = atob(logB64)
        } catch {
            logResult = logB64
        }
    }
    return {
        statusCode: res.status,
        payload: body,
        functionError: res.headers.get('x-amz-function-error') ?? undefined,
        logResult,
        executionDuration: duration,
    }
}

export async function deleteLambdaFunction(name: string, signal?: AbortSignal): Promise<void> {
    const res = await fetch(`${PROXY}/2015-03-31/functions/${encodeURIComponent(name)}`, {
        method: 'DELETE',
        signal,
    })
    if (!res.ok && res.status !== 204) throw new Error(`Delete failed: HTTP ${res.status}`)
}

// ─── S3 detail ───────────────────────────────────────────────────────────────

export interface S3Object {
    key: string
    size: number
    lastModified?: string
    etag?: string
    contentType?: string
}

export interface S3Contents {
    /** Virtual folders (CommonPrefixes), e.g. "data/", "logs/2024/" */
    folders: string[]
    files: S3Object[]
}

export async function listS3Objects(bucket: string, prefix?: string, signal?: AbortSignal): Promise<S3Contents> {
    const qs = new URLSearchParams({'list-type': '2', delimiter: '/'})
    if (prefix) qs.set('prefix', prefix)
    const xml = await flociGetXml(`/${bucket}?${qs.toString()}`, signal)
    const doc = parseXml(xml)

    const folders = Array.from(doc.querySelectorAll('CommonPrefixes Prefix'))
        .map((el) => el.textContent ?? '')
        .filter(Boolean)

    const files = Array.from(doc.querySelectorAll('Contents'))
        .map((obj) => ({
            key: textContent(obj, 'Key') ?? '',
            size: Number(textContent(obj, 'Size') ?? 0),
            lastModified: textContent(obj, 'LastModified'),
            etag: textContent(obj, 'ETag')?.replace(/"/g, ''),
        }))
        // exclude directory-marker objects (keys that equal the prefix or end with /)
        .filter((obj) => obj.key && obj.key !== prefix && !obj.key.endsWith('/'))

    return {folders, files}
}

/** Upload a single file (or raw Blob) to S3. Key = prefix + filename. */
export async function uploadS3Object(
    bucket: string,
    key: string,
    file: File | Blob,
    signal?: AbortSignal,
): Promise<void> {
    const encodedKey = key.split('/').map(encodeURIComponent).join('/')
    const res = await fetch(`${PROXY}/${bucket}/${encodedKey}`, {
        method: 'PUT',
        headers: {'Content-Type': file.type || 'application/octet-stream'},
        body: file,
        signal,
    })
    if (!res.ok) throw new Error(`Upload failed: HTTP ${res.status}`)
}

/** Hard-delete a single S3 object. */
export async function deleteS3Object(bucket: string, key: string, signal?: AbortSignal): Promise<void> {
    const encodedKey = key.split('/').map(encodeURIComponent).join('/')
    const res = await fetch(`${PROXY}/${bucket}/${encodedKey}`, {method: 'DELETE', signal})
    // 204 No Content = success; treat anything 2xx as ok
    if (!res.ok && res.status !== 204) throw new Error(`Delete failed: HTTP ${res.status}`)
}

export interface S3Tag {
    key: string;
    value: string
}

export async function getS3ObjectTags(bucket: string, key: string, signal?: AbortSignal): Promise<S3Tag[]> {
    const xml = await flociGetXml(`/${bucket}/${key}?tagging`, signal)
    const doc = parseXml(xml)
    return Array.from(doc.querySelectorAll('Tag'))
        .map((tag) => ({key: textContent(tag, 'Key') ?? '', value: textContent(tag, 'Value') ?? ''}))
        .filter((t) => t.key)
}

export async function putS3ObjectTags(bucket: string, key: string, tags: S3Tag[], signal?: AbortSignal): Promise<void> {
    const tagXml = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<Tagging xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><TagSet>',
        ...tags.map((t) => `<Tag><Key>${t.key}</Key><Value>${t.value}</Value></Tag>`),
        '</TagSet></Tagging>',
    ].join('')
    const encodedKey = key.split('/').map(encodeURIComponent).join('/')
    const res = await fetch(`${PROXY}/${bucket}/${encodedKey}?tagging`, {
        method: 'PUT',
        headers: {'Content-Type': 'application/xml'},
        body: tagXml,
        signal,
    })
    if (!res.ok) throw new Error(`Tag update failed: HTTP ${res.status}`)
}

export async function createS3Bucket(name: string, signal?: AbortSignal): Promise<void> {
    const res = await fetch(`${PROXY}/${encodeURIComponent(name)}`, {method: 'PUT', signal})
    if (!res.ok) throw new Error(`Create bucket failed: HTTP ${res.status}`)
}

export async function deleteS3Bucket(name: string, signal?: AbortSignal): Promise<void> {
    const res = await fetch(`${PROXY}/${encodeURIComponent(name)}`, {method: 'DELETE', signal})
    if (!res.ok && res.status !== 204) throw new Error(`Delete bucket failed: HTTP ${res.status}`)
}

export async function deleteS3Objects(bucket: string, keys: string[], signal?: AbortSignal): Promise<void> {
    const xmlBody = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<Delete><Quiet>true</Quiet>',
        ...keys.map((k) => `<Object><Key>${k.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</Key></Object>`),
        '</Delete>',
    ].join('')
    const res = await fetch(`${PROXY}/${encodeURIComponent(bucket)}?delete`, {
        method: 'POST',
        headers: {'Content-Type': 'application/xml'},
        body: xmlBody,
        signal,
    })
    if (!res.ok) throw new Error(`Bulk delete failed: HTTP ${res.status}`)
}

export interface S3ObjectMetadata {
    contentType?: string
    contentLength?: number
    etag?: string
    lastModified?: string
    versionId?: string
    cacheControl?: string
    contentEncoding?: string
    contentDisposition?: string
}

export async function getS3ObjectMetadata(bucket: string, key: string, signal?: AbortSignal): Promise<S3ObjectMetadata> {
    const encodedKey = key.split('/').map(encodeURIComponent).join('/')
    const res = await fetch(`${PROXY}/${bucket}/${encodedKey}`, {method: 'HEAD', signal})
    if (!res.ok) throw new Error(`HEAD failed: HTTP ${res.status}`)
    const cl = res.headers.get('content-length')
    return {
        contentType: res.headers.get('content-type') ?? undefined,
        contentLength: cl !== null ? Number(cl) : undefined,
        etag: res.headers.get('etag')?.replace(/"/g, '') ?? undefined,
        lastModified: res.headers.get('last-modified') ?? undefined,
        versionId: res.headers.get('x-amz-version-id') ?? undefined,
        cacheControl: res.headers.get('cache-control') ?? undefined,
        contentEncoding: res.headers.get('content-encoding') ?? undefined,
        contentDisposition: res.headers.get('content-disposition') ?? undefined,
    }
}

export async function getBucketVersioning(bucket: string, signal?: AbortSignal): Promise<'Enabled' | 'Suspended' | 'Unversioned'> {
    const xml = await flociGetXml(`/${bucket}?versioning`, signal)
    const doc = parseXml(xml)
    const status = textContent(doc, 'Status')
    if (status === 'Enabled') return 'Enabled'
    if (status === 'Suspended') return 'Suspended'
    return 'Unversioned'
}

export async function putBucketVersioning(bucket: string, enabled: boolean, signal?: AbortSignal): Promise<void> {
    const xml = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<VersioningConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/">',
        `<Status>${enabled ? 'Enabled' : 'Suspended'}</Status>`,
        '</VersioningConfiguration>',
    ].join('')
    const res = await fetch(`${PROXY}/${encodeURIComponent(bucket)}?versioning`, {
        method: 'PUT',
        headers: {'Content-Type': 'application/xml'},
        body: xml,
        signal,
    })
    if (!res.ok) throw new Error(`Versioning update failed: HTTP ${res.status}`)
}

export async function getBucketTags(bucket: string, signal?: AbortSignal): Promise<S3Tag[]> {
    try {
        const xml = await flociGetXml(`/${bucket}?tagging`, signal)
        const doc = parseXml(xml)
        return Array.from(doc.querySelectorAll('Tag'))
            .map((tag) => ({key: textContent(tag, 'Key') ?? '', value: textContent(tag, 'Value') ?? ''}))
            .filter((t) => t.key)
    } catch {
        return []
    }
}

export async function putBucketTags(bucket: string, tags: S3Tag[], signal?: AbortSignal): Promise<void> {
    const tagXml = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<Tagging xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><TagSet>',
        ...tags.map((t) => `<Tag><Key>${t.key}</Key><Value>${t.value}</Value></Tag>`),
        '</TagSet></Tagging>',
    ].join('')
    const res = await fetch(`${PROXY}/${encodeURIComponent(bucket)}?tagging`, {
        method: 'PUT',
        headers: {'Content-Type': 'application/xml'},
        body: tagXml,
        signal,
    })
    if (!res.ok) throw new Error(`Bucket tag update failed: HTTP ${res.status}`)
}

export async function copyS3Object(
    srcBucket: string,
    srcKey: string,
    destBucket: string,
    destKey: string,
    signal?: AbortSignal,
): Promise<void> {
    const encodedSrcKey = srcKey.split('/').map(encodeURIComponent).join('/')
    const encodedDestKey = destKey.split('/').map(encodeURIComponent).join('/')
    const res = await fetch(`${PROXY}/${destBucket}/${encodedDestKey}`, {
        method: 'PUT',
        headers: {'x-amz-copy-source': `/${srcBucket}/${encodedSrcKey}`},
        signal,
    })
    if (!res.ok) throw new Error(`Copy failed: HTTP ${res.status}`)
}

// ─── SQS detail ──────────────────────────────────────────────────────────────

export interface SqsQueueAttributes {
    approximateNumberOfMessages?: number
    approximateNumberOfMessagesDelayed?: number
    approximateNumberOfMessagesNotVisible?: number
    createdTimestamp?: number
    lastModifiedTimestamp?: number
    visibilityTimeout?: number
    maximumMessageSize?: number
    messageRetentionPeriod?: number
    receiveMessageWaitTimeSeconds?: number
    delaySeconds?: number
    fifoQueue?: boolean
    contentBasedDeduplication?: boolean
}

export async function getSqsQueueAttributes(queueUrl: string, signal?: AbortSignal): Promise<SqsQueueAttributes> {
    const xml = await flociQueryAction(
        {Action: 'GetQueueAttributes', QueueUrl: queueUrl, 'AttributeName.1': 'All'},
        signal,
    )
    const doc = parseXml(xml)
    const getAttr = (name: string): string | undefined => {
        const attrs = Array.from(doc.querySelectorAll('Attribute'))
        return attrs.find((attr) => textContent(attr, 'Name') === name)?.querySelector('Value')?.textContent ?? undefined
    }
    const toInt = (name: string) => {
        const v = getAttr(name);
        return v !== undefined ? Number(v) : undefined
    }
    return {
        approximateNumberOfMessages: toInt('ApproximateNumberOfMessages'),
        approximateNumberOfMessagesDelayed: toInt('ApproximateNumberOfMessagesDelayed'),
        approximateNumberOfMessagesNotVisible: toInt('ApproximateNumberOfMessagesNotVisible'),
        createdTimestamp: epochMs(getAttr('CreatedTimestamp')),
        lastModifiedTimestamp: epochMs(getAttr('LastModifiedTimestamp')),
        visibilityTimeout: toInt('VisibilityTimeout'),
        maximumMessageSize: toInt('MaximumMessageSize'),
        messageRetentionPeriod: toInt('MessageRetentionPeriod'),
        receiveMessageWaitTimeSeconds: toInt('ReceiveMessageWaitTimeSeconds'),
        delaySeconds: toInt('DelaySeconds'),
        fifoQueue: getAttr('FifoQueue') === 'true',
        contentBasedDeduplication: getAttr('ContentBasedDeduplication') === 'true',
    }
}

// ─── SQS actions ─────────────────────────────────────────────────────────────

export async function sendSqsMessage(queueUrl: string, messageBody: string, signal?: AbortSignal): Promise<string> {
    const xml = await flociQueryAction(
        {Action: 'SendMessage', QueueUrl: queueUrl, MessageBody: messageBody},
        signal,
    )
    const doc = parseXml(xml)
    return textContent(doc, 'MessageId') ?? ''
}

export interface SqsMessage {
    messageId: string
    receiptHandle: string
    body: string
    sentTimestamp?: number
    receiveCount?: number
}

export async function peekSqsMessages(queueUrl: string, max = 10, signal?: AbortSignal): Promise<SqsMessage[]> {
    // VisibilityTimeout=0 → messages immediately re-available (standard AWS peek pattern)
    const xml = await flociQueryAction(
        {
            Action: 'ReceiveMessage',
            QueueUrl: queueUrl,
            MaxNumberOfMessages: String(Math.min(max, 10)),
            VisibilityTimeout: '0',
            'AttributeName.1': 'All',
        },
        signal,
    )
    const doc = parseXml(xml)
    return Array.from(doc.querySelectorAll('Message')).map((msg) => {
        const getAttr = (name: string) => {
            return Array.from(msg.querySelectorAll('Attribute'))
                .find((a) => textContent(a, 'Name') === name)
                ?.querySelector('Value')?.textContent ?? undefined
        }
        return {
            messageId: textContent(msg, 'MessageId') ?? '',
            receiptHandle: textContent(msg, 'ReceiptHandle') ?? '',
            body: textContent(msg, 'Body') ?? '',
            sentTimestamp: epochMs(getAttr('SentTimestamp')),
            receiveCount: Number(getAttr('ApproximateReceiveCount') ?? 0) || undefined,
        }
    })
}

// ─── SQS queue management ────────────────────────────────────────────────────

export interface SqsQueueConfig {
    fifo?: boolean
    visibilityTimeout?: number
    messageRetentionPeriod?: number
    maxMessageSize?: number
    delaySeconds?: number
    receiveWaitTime?: number
    contentBasedDeduplication?: boolean
}

export async function createSqsQueue(name: string, config: SqsQueueConfig = {}, signal?: AbortSignal): Promise<string> {
    const params: Record<string, string> = {Action: 'CreateQueue', QueueName: name}
    const attrs: Array<[string, string]> = []
    if (config.fifo) attrs.push(['FifoQueue', 'true'])
    if (config.visibilityTimeout !== undefined) attrs.push(['VisibilityTimeout', String(config.visibilityTimeout)])
    if (config.messageRetentionPeriod !== undefined) attrs.push(['MessageRetentionPeriod', String(config.messageRetentionPeriod)])
    if (config.maxMessageSize !== undefined) attrs.push(['MaximumMessageSize', String(config.maxMessageSize)])
    if (config.delaySeconds !== undefined) attrs.push(['DelaySeconds', String(config.delaySeconds)])
    if (config.receiveWaitTime !== undefined) attrs.push(['ReceiveMessageWaitTimeSeconds', String(config.receiveWaitTime)])
    if (config.contentBasedDeduplication) attrs.push(['ContentBasedDeduplication', 'true'])
    attrs.forEach(([attrName, attrValue], idx) => {
        params[`Attribute.${idx + 1}.Name`] = attrName
        params[`Attribute.${idx + 1}.Value`] = attrValue
    })
    const xml = await flociQueryAction(params, signal)
    const doc = parseXml(xml)
    return textContent(doc, 'QueueUrl') ?? name
}

export async function deleteSqsQueue(queueUrl: string, signal?: AbortSignal): Promise<void> {
    await flociQueryAction({Action: 'DeleteQueue', QueueUrl: queueUrl}, signal)
}

export async function purgeSqsQueue(queueUrl: string, signal?: AbortSignal): Promise<void> {
    await flociQueryAction({Action: 'PurgeQueue', QueueUrl: queueUrl}, signal)
}

export async function deleteSqsMessage(queueUrl: string, receiptHandle: string, signal?: AbortSignal): Promise<void> {
    await flociQueryAction({Action: 'DeleteMessage', QueueUrl: queueUrl, ReceiptHandle: receiptHandle}, signal)
}

// ─── DynamoDB detail ─────────────────────────────────────────────────────────

export type DynamoDbItem = Record<string, unknown>

export interface DynamoDbKeyAttr {
    name: string
    keyType: 'HASH' | 'RANGE'
    attrType: 'S' | 'N' | 'B'
}

type RawDynamoAttr = { S?: string; N?: string; BOOL?: boolean; NULL?: boolean; L?: unknown[]; M?: Record<string, unknown> }

function unmarshalAttr(val: RawDynamoAttr): unknown {
    if (val.S !== undefined) return val.S
    if (val.N !== undefined) return Number(val.N)
    if (val.BOOL !== undefined) return val.BOOL
    if (val.NULL) return null
    if (val.L) return val.L.map((v) => unmarshalAttr(v as RawDynamoAttr))
    if (val.M) return Object.fromEntries(Object.entries(val.M).map(([k, v]) => [k, unmarshalAttr(v as RawDynamoAttr)]))
    return val
}

function unmarshalItems(raw: Array<Record<string, RawDynamoAttr>>): DynamoDbItem[] {
    return raw.map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, unmarshalAttr(v)])))
}

function marshalValue(value: unknown): unknown {
    if (value === null || value === undefined) return {NULL: true}
    if (typeof value === 'boolean') return {BOOL: value}
    if (typeof value === 'number') return {N: String(value)}
    if (typeof value === 'string') return {S: value}
    if (Array.isArray(value)) return {L: value.map(marshalValue)}
    if (typeof value === 'object') return {M: Object.fromEntries(Object.entries(value as object).map(([k, v]) => [k, marshalValue(v)]))}
    return {S: String(value)}
}

function marshalItem(item: DynamoDbItem): Record<string, unknown> {
    return Object.fromEntries(Object.entries(item).map(([k, v]) => [k, marshalValue(v)]))
}

export async function scanDynamoDbTable(
    tableName: string,
    limit = 50,
    signal?: AbortSignal,
): Promise<{ items: DynamoDbItem[]; count: number; scannedCount: number }> {
    const res = await flociJsonAction<{
        Items?: Array<Record<string, RawDynamoAttr>>
        Count?: number
        ScannedCount?: number
    }>(DYNAMODB('Scan'), {TableName: tableName, Limit: limit}, signal)

    const items = unmarshalItems(res.Items ?? [])
    return {items, count: res.Count ?? items.length, scannedCount: res.ScannedCount ?? items.length}
}

export async function queryDynamoDbTable(
    tableName: string,
    pkName: string,
    pkValue: string | number,
    skName?: string,
    skOp?: string,
    skValue?: string | number,
    skValue2?: string | number,
    limit = 50,
    signal?: AbortSignal,
): Promise<{ items: DynamoDbItem[]; count: number; scannedCount: number }> {
    const toAttr = (v: string | number) => (typeof v === 'number' ? {N: String(v)} : {S: String(v)})
    const exprValues: Record<string, unknown> = {':pk': toAttr(pkValue)}
    const exprNames: Record<string, string> = {'#pk': pkName}
    let keyCondition = '#pk = :pk'

    if (skName && skOp && skValue !== undefined) {
        exprNames['#sk'] = skName
        exprValues[':sk'] = toAttr(skValue)
        if (skOp === 'between' && skValue2 !== undefined) {
            exprValues[':sk2'] = toAttr(skValue2)
            keyCondition += ' AND #sk BETWEEN :sk AND :sk2'
        } else if (skOp === 'begins_with') {
            keyCondition += ' AND begins_with(#sk, :sk)'
        } else {
            keyCondition += ` AND #sk ${skOp} :sk`
        }
    }

    const res = await flociJsonAction<{
        Items?: Array<Record<string, RawDynamoAttr>>
        Count?: number
        ScannedCount?: number
    }>(DYNAMODB('Query'), {
        TableName: tableName,
        KeyConditionExpression: keyCondition,
        ExpressionAttributeNames: exprNames,
        ExpressionAttributeValues: exprValues,
        Limit: limit,
    }, signal)

    const items = unmarshalItems(res.Items ?? [])
    return {items, count: res.Count ?? items.length, scannedCount: res.ScannedCount ?? items.length}
}

export async function createDynamoDbTable(
    name: string,
    partitionKey: {name: string; type: 'S' | 'N'},
    sortKey?: {name: string; type: 'S' | 'N'},
    billingMode: 'PAY_PER_REQUEST' | 'PROVISIONED' = 'PAY_PER_REQUEST',
    signal?: AbortSignal,
): Promise<void> {
    await flociJsonAction(DYNAMODB('CreateTable'), {
        TableName: name,
        AttributeDefinitions: [
            {AttributeName: partitionKey.name, AttributeType: partitionKey.type},
            ...(sortKey ? [{AttributeName: sortKey.name, AttributeType: sortKey.type}] : []),
        ],
        KeySchema: [
            {AttributeName: partitionKey.name, KeyType: 'HASH'},
            ...(sortKey ? [{AttributeName: sortKey.name, KeyType: 'RANGE'}] : []),
        ],
        BillingMode: billingMode,
        ...(billingMode === 'PROVISIONED' ? {ProvisionedThroughput: {ReadCapacityUnits: 5, WriteCapacityUnits: 5}} : {}),
    }, signal)
}

export async function deleteDynamoDbTable(name: string, signal?: AbortSignal): Promise<void> {
    await flociJsonAction(DYNAMODB('DeleteTable'), {TableName: name}, signal)
}

export async function putDynamoDbItem(tableName: string, item: DynamoDbItem, signal?: AbortSignal): Promise<void> {
    await flociJsonAction(DYNAMODB('PutItem'), {TableName: tableName, Item: marshalItem(item)}, signal)
}

export async function deleteDynamoDbItem(tableName: string, key: DynamoDbItem, signal?: AbortSignal): Promise<void> {
    await flociJsonAction(DYNAMODB('DeleteItem'), {TableName: tableName, Key: marshalItem(key)}, signal)
}

// ─── SNS detail ──────────────────────────────────────────────────────────────

export interface SnsTopic {
    arn: string
    name: string
}

export interface SnsSubscription {
    subscriptionArn: string
    protocol: string
    endpoint: string
    topicArn: string
    owner?: string
}

export async function listSnsTopicsDetail(signal?: AbortSignal): Promise<SnsTopic[]> {
    const xml = await flociQueryAction({Action: 'ListTopics'}, signal)
    const doc = parseXml(xml)
    return Array.from(doc.querySelectorAll('TopicArn')).map((el) => {
        const arn = el.textContent ?? ''
        const name = arn.split(':').pop() ?? arn
        return {arn, name}
    }).filter((t) => t.name)
}

export async function createSnsTopic(name: string, fifo = false, signal?: AbortSignal): Promise<string> {
    const params: Record<string, string> = {Action: 'CreateTopic', Name: name}
    if (fifo) {
        params['Attributes.entry.1.key'] = 'FifoTopic'
        params['Attributes.entry.1.value'] = 'true'
    }
    const xml = await flociQueryAction(params, signal)
    const doc = parseXml(xml)
    return textContent(doc, 'TopicArn') ?? name
}

export async function deleteSnsTopic(arn: string, signal?: AbortSignal): Promise<void> {
    await flociQueryAction({Action: 'DeleteTopic', TopicArn: arn}, signal)
}

export async function listSubscriptionsByTopic(topicArn: string, signal?: AbortSignal): Promise<SnsSubscription[]> {
    const xml = await flociQueryAction({Action: 'ListSubscriptionsByTopic', TopicArn: topicArn}, signal)
    const doc = parseXml(xml)
    return Array.from(doc.querySelectorAll('member')).map((m) => ({
        subscriptionArn: m.querySelector('SubscriptionArn')?.textContent ?? '',
        protocol: m.querySelector('Protocol')?.textContent ?? '',
        endpoint: m.querySelector('Endpoint')?.textContent ?? '',
        topicArn: m.querySelector('TopicArn')?.textContent ?? '',
        owner: m.querySelector('Owner')?.textContent ?? undefined,
    })).filter((s) => s.subscriptionArn && s.subscriptionArn !== 'PendingConfirmation')
}

export async function subscribeToTopic(
    topicArn: string,
    protocol: string,
    endpoint: string,
    signal?: AbortSignal,
): Promise<string> {
    const xml = await flociQueryAction({Action: 'Subscribe', TopicArn: topicArn, Protocol: protocol, Endpoint: endpoint}, signal)
    const doc = parseXml(xml)
    return textContent(doc, 'SubscriptionArn') ?? ''
}

export async function unsubscribeFromTopic(subscriptionArn: string, signal?: AbortSignal): Promise<void> {
    await flociQueryAction({Action: 'Unsubscribe', SubscriptionArn: subscriptionArn}, signal)
}

export async function publishSnsMessage(
    topicArn: string,
    message: string,
    subject?: string,
    signal?: AbortSignal,
): Promise<string> {
    const params: Record<string, string> = {Action: 'Publish', TopicArn: topicArn, Message: message}
    if (subject) params.Subject = subject
    const xml = await flociQueryAction(params, signal)
    const doc = parseXml(xml)
    return textContent(doc, 'MessageId') ?? ''
}
