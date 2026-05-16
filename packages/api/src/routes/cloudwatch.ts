import {Hono} from 'hono'
import {
    CreateLogGroupCommand,
    CreateLogStreamCommand,
    DescribeLogGroupsCommand,
    DescribeLogStreamsCommand,
    GetLogEventsCommand,
    PutLogEventsCommand,
    PutRetentionPolicyCommand,
} from '@aws-sdk/client-cloudwatch-logs'
import {DescribeAlarmsCommand, ListMetricsCommand} from '@aws-sdk/client-cloudwatch'
import {cw, cwLogs} from '../aws'

const app = new Hono()

// ─── Log groups ───────────────────────────────────────────────────────────────

app.get('/log-groups', async (c) => {
    const prefix = c.req.query('prefix')
    const res = await cwLogs.send(new DescribeLogGroupsCommand(
        prefix ? {logGroupNamePrefix: prefix} : {}
    ))
    return c.json((res.logGroups ?? []).map(g => ({
        name: g.logGroupName ?? '',
        arn: g.arn,
        retentionInDays: g.retentionInDays,
        createdAt: g.creationTime ?? 0,
        storedBytes: g.storedBytes ?? 0,
        metricFilterCount: g.metricFilterCount ?? 0,
    })))
})

app.post('/log-groups', async (c) => {
    const {name, retentionInDays} = await c.req.json<{name: string; retentionInDays?: number}>()
    try {
        await cwLogs.send(new CreateLogGroupCommand({logGroupName: name}))
    } catch (err) {
        // An already-existing log group is an acceptable end state — the
        // ingestor re-requests groups it created on earlier navigations.
        if ((err as {name?: string}).name !== 'ResourceAlreadyExistsException') throw err
    }
    if (retentionInDays) {
        await cwLogs.send(new PutRetentionPolicyCommand({logGroupName: name, retentionInDays}))
    }
    return c.json({ok: true})
})

// ─── Log streams ──────────────────────────────────────────────────────────────

app.get('/log-streams', async (c) => {
    const group = c.req.query('group') ?? ''
    const res = await cwLogs.send(new DescribeLogStreamsCommand({
        logGroupName: group,
        orderBy: 'LastEventTime',
        descending: true,
    }))
    return c.json((res.logStreams ?? []).map(s => ({
        name: s.logStreamName ?? '',
        createdAt: s.creationTime,
        firstEventAt: s.firstEventTimestamp,
        lastEventAt: s.lastEventTimestamp,
        lastIngestionAt: s.lastIngestionTime,
        storedBytes: s.storedBytes ?? 0,
    })))
})

app.post('/log-streams', async (c) => {
    const {group, name} = await c.req.json<{group: string; name: string}>()
    try {
        await cwLogs.send(new CreateLogStreamCommand({logGroupName: group, logStreamName: name}))
    } catch (err) {
        // An already-existing log stream is an acceptable end state.
        if ((err as {name?: string}).name !== 'ResourceAlreadyExistsException') throw err
    }
    return c.json({ok: true})
})

// ─── Log events ───────────────────────────────────────────────────────────────

app.get('/log-events', async (c) => {
    const group = c.req.query('group') ?? ''
    const stream = c.req.query('stream') ?? ''
    const res = await cwLogs.send(new GetLogEventsCommand({
        logGroupName: group,
        logStreamName: stream,
        startFromHead: false,
    }))
    return c.json((res.events ?? []).map((e, i) => ({
        id: `${e.timestamp ?? 0}-${i}`,
        timestamp: e.timestamp ?? 0,
        message: e.message ?? '',
        ingestionTime: e.ingestionTime,
    })))
})

app.post('/log-events', async (c) => {
    const {group, stream, events} = await c.req.json<{
        group: string
        stream: string
        events: Array<{timestamp: number; message: string}>
    }>()
    await cwLogs.send(new PutLogEventsCommand({
        logGroupName: group,
        logStreamName: stream,
        logEvents: events,
    }))
    return c.json({ok: true})
})

// ─── Alarms ───────────────────────────────────────────────────────────────────

app.get('/alarms', async (c) => {
    const res = await cw.send(new DescribeAlarmsCommand({}))
    return c.json((res.MetricAlarms ?? []).map(a => ({
        alarmName: a.AlarmName ?? '',
        stateValue: a.StateValue ?? 'INSUFFICIENT_DATA',
        stateReason: a.StateReason,
        metricName: a.MetricName,
        namespace: a.Namespace,
        threshold: a.Threshold,
    })))
})

// ─── Metrics ──────────────────────────────────────────────────────────────────

app.get('/metrics', async (c) => {
    const res = await cw.send(new ListMetricsCommand({}))
    return c.json((res.Metrics ?? []).map((m, i) => {
        const namespace = m.Namespace ?? 'Unknown'
        const metricName = m.MetricName ?? 'UnnamedMetric'
        const dimensions = (m.Dimensions ?? []).map(d => ({name: d.Name ?? '', value: d.Value ?? ''}))
        return {
            id: `${namespace}:${metricName}:${dimensions.map(d => `${d.name}=${d.value}`).join(',') || i}`,
            namespace,
            metricName,
            dimensions,
        }
    }))
})

export default app
