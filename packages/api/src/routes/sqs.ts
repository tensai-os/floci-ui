import {Hono} from 'hono'
import {
    CreateQueueCommand,
    DeleteMessageCommand,
    DeleteQueueCommand,
    GetQueueAttributesCommand,
    ListDeadLetterSourceQueuesCommand,
    ListMessageMoveTasksCommand,
    ListQueuesCommand,
    ListQueueTagsCommand,
    PurgeQueueCommand,
    ReceiveMessageCommand,
    SendMessageBatchCommand,
    SendMessageCommand,
    SetQueueAttributesCommand,
    StartMessageMoveTaskCommand,
    TagQueueCommand,
    UntagQueueCommand,
} from '@aws-sdk/client-sqs'
import {sqs} from '../aws'

const app = new Hono()

function epochMs(v?: string): number | undefined {
    if (!v) return undefined
    const n = Number(v)
    return Number.isFinite(n) ? (n < 1e11 ? n * 1000 : n) : undefined
}

/**
 * FIFO send parameters. A FIFO queue needs a MessageGroupId; it also needs a
 * MessageDeduplicationId, EXCEPT when the queue derives one from the body hash
 * (content-based deduplication) — supplying one there would override and
 * defeat that deduplication. Returns an empty object for standard queues.
 */
function fifoSendFields(messageGroupId?: string, contentBasedDedup?: boolean) {
    if (!messageGroupId) return {}
    return {
        MessageGroupId: messageGroupId,
        ...(contentBasedDedup ? {} : {MessageDeduplicationId: crypto.randomUUID()}),
    }
}

interface RedrivePolicy {
    deadLetterTargetArn: string
    maxReceiveCount: number
}

function parseRedrivePolicy(raw?: string): RedrivePolicy | undefined {
    if (!raw) return undefined
    try {
        const p = JSON.parse(raw) as {deadLetterTargetArn?: string; maxReceiveCount?: number | string}
        if (!p.deadLetterTargetArn) return undefined
        return {
            deadLetterTargetArn: p.deadLetterTargetArn,
            maxReceiveCount: Number(p.maxReceiveCount ?? 0),
        }
    } catch {
        return undefined
    }
}

app.get('/queues', async (c) => {
    const res = await sqs.send(new ListQueuesCommand({}))
    return c.json((res.QueueUrls ?? []).map(url => {
        const name = url.split('/').filter(Boolean).pop() ?? url
        return {name, url}
    }))
})

app.post('/queues', async (c) => {
    const {name, fifo, visibilityTimeout, messageRetentionPeriod, contentBasedDeduplication} =
        await c.req.json<{
            name: string
            fifo?: boolean
            visibilityTimeout?: number
            messageRetentionPeriod?: number
            contentBasedDeduplication?: boolean
        }>()
    const attributes: Record<string, string> = {}
    if (visibilityTimeout !== undefined) attributes.VisibilityTimeout = String(visibilityTimeout)
    if (messageRetentionPeriod !== undefined) attributes.MessageRetentionPeriod = String(messageRetentionPeriod)
    if (fifo) {
        attributes.FifoQueue = 'true'
        if (contentBasedDeduplication !== undefined) {
            attributes.ContentBasedDeduplication = String(contentBasedDeduplication)
        }
    }
    const res = await sqs.send(new CreateQueueCommand({
        QueueName: name,
        Attributes: Object.keys(attributes).length ? attributes : undefined,
    }))
    return c.json({name, url: res.QueueUrl ?? ''})
})

app.delete('/queue', async (c) => {
    const url = c.req.query('url') ?? ''
    await sqs.send(new DeleteQueueCommand({QueueUrl: url}))
    return c.json({ok: true})
})

app.post('/queue/purge', async (c) => {
    const {url} = await c.req.json<{url: string}>()
    await sqs.send(new PurgeQueueCommand({QueueUrl: url}))
    return c.json({ok: true})
})

app.get('/queue/attributes', async (c) => {
    const url = c.req.query('url') ?? ''
    const res = await sqs.send(new GetQueueAttributesCommand({
        QueueUrl: url,
        AttributeNames: ['All'],
    }))
    const a = res.Attributes ?? {}
    const toInt = (k: string) => a[k] !== undefined ? Number(a[k]) : undefined
    return c.json({
        approximateNumberOfMessages: toInt('ApproximateNumberOfMessages'),
        approximateNumberOfMessagesDelayed: toInt('ApproximateNumberOfMessagesDelayed'),
        approximateNumberOfMessagesNotVisible: toInt('ApproximateNumberOfMessagesNotVisible'),
        createdTimestamp: epochMs(a['CreatedTimestamp']),
        lastModifiedTimestamp: epochMs(a['LastModifiedTimestamp']),
        visibilityTimeout: toInt('VisibilityTimeout'),
        maximumMessageSize: toInt('MaximumMessageSize'),
        messageRetentionPeriod: toInt('MessageRetentionPeriod'),
        receiveMessageWaitTimeSeconds: toInt('ReceiveMessageWaitTimeSeconds'),
        delaySeconds: toInt('DelaySeconds'),
        fifoQueue: a['FifoQueue'] === 'true',
        contentBasedDeduplication: a['ContentBasedDeduplication'] === 'true',
        queueArn: a['QueueArn'],
        redrivePolicy: parseRedrivePolicy(a['RedrivePolicy']),
    })
})

// Used by the dead-letter-queue panel to set or clear a RedrivePolicy.
app.put('/queue/attributes', async (c) => {
    const {url, attributes} = await c.req.json<{url: string; attributes: Record<string, string>}>()
    await sqs.send(new SetQueueAttributesCommand({QueueUrl: url, Attributes: attributes}))
    return c.json({ok: true})
})

app.post('/queue/message', async (c) => {
    const {url, messageBody, messageGroupId, contentBasedDedup} = await c.req.json<{
        url: string
        messageBody: string
        messageGroupId?: string
        contentBasedDedup?: boolean
    }>()
    const res = await sqs.send(new SendMessageCommand({
        QueueUrl: url,
        MessageBody: messageBody,
        ...fifoSendFields(messageGroupId, contentBasedDedup),
    }))
    return c.json({messageId: res.MessageId ?? ''})
})

app.post('/queue/messages/batch', async (c) => {
    const {url, messages, messageGroupId, contentBasedDedup} = await c.req.json<{
        url: string
        messages: string[]
        messageGroupId?: string
        contentBasedDedup?: boolean
    }>()
    const res = await sqs.send(new SendMessageBatchCommand({
        QueueUrl: url,
        Entries: messages.map((body, i) => ({
            Id: `m${i}`,
            MessageBody: body,
            ...fifoSendFields(messageGroupId, contentBasedDedup),
        })),
    }))
    return c.json({
        successful: (res.Successful ?? []).map(s => ({id: s.Id ?? '', messageId: s.MessageId ?? ''})),
        failed: (res.Failed ?? []).map(f => ({id: f.Id ?? '', message: f.Message ?? 'Send failed'})),
    })
})

app.get('/queue/messages', async (c) => {
    const url = c.req.query('url') ?? ''
    const max = Math.min(Number(c.req.query('max') ?? '10'), 10)
    const res = await sqs.send(new ReceiveMessageCommand({
        QueueUrl: url,
        MaxNumberOfMessages: max,
        VisibilityTimeout: 0,
        AttributeNames: ['All'],
    }))
    return c.json((res.Messages ?? []).map(msg => ({
        messageId: msg.MessageId ?? '',
        receiptHandle: msg.ReceiptHandle ?? '',
        body: msg.Body ?? '',
        sentTimestamp: epochMs(msg.Attributes?.['SentTimestamp']),
        receiveCount: Number(msg.Attributes?.['ApproximateReceiveCount'] ?? 0) || undefined,
    })))
})

app.post('/queue/message/delete', async (c) => {
    const {url, receiptHandle} = await c.req.json<{url: string; receiptHandle: string}>()
    await sqs.send(new DeleteMessageCommand({QueueUrl: url, ReceiptHandle: receiptHandle}))
    return c.json({ok: true})
})

app.get('/queue/tags', async (c) => {
    const url = c.req.query('url') ?? ''
    const res = await sqs.send(new ListQueueTagsCommand({QueueUrl: url}))
    return c.json(Object.entries(res.Tags ?? {}).map(([key, value]) => ({key, value})))
})

app.put('/queue/tags', async (c) => {
    const {url, tags} = await c.req.json<{url: string; tags: Array<{key: string; value: string}>}>()
    await sqs.send(new TagQueueCommand({
        QueueUrl: url,
        Tags: Object.fromEntries(tags.map(t => [t.key, t.value])),
    }))
    return c.json({ok: true})
})

app.post('/queue/tags/delete', async (c) => {
    const {url, keys} = await c.req.json<{url: string; keys: string[]}>()
    await sqs.send(new UntagQueueCommand({QueueUrl: url, TagKeys: keys}))
    return c.json({ok: true})
})

// Dead-letter redrive: move messages from a DLQ back to their source queue.
app.post('/queue/redrive', async (c) => {
    const {sourceArn} = await c.req.json<{sourceArn: string}>()
    const res = await sqs.send(new StartMessageMoveTaskCommand({SourceArn: sourceArn}))
    return c.json({taskHandle: res.TaskHandle ?? ''})
})

app.get('/queue/redrive/tasks', async (c) => {
    const sourceArn = c.req.query('sourceArn') ?? ''
    const res = await sqs.send(new ListMessageMoveTasksCommand({SourceArn: sourceArn}))
    return c.json((res.Results ?? []).map(t => ({
        status: t.Status,
        approximateNumberOfMessagesMoved: t.ApproximateNumberOfMessagesMoved,
        approximateNumberOfMessagesToMove: t.ApproximateNumberOfMessagesToMove,
        startedTimestamp: t.StartedTimestamp,
        failureReason: t.FailureReason,
    })))
})

// Queues that use this queue as their dead-letter queue.
app.get('/queue/dlq-sources', async (c) => {
    const url = c.req.query('url') ?? ''
    const res = await sqs.send(new ListDeadLetterSourceQueuesCommand({QueueUrl: url}))
    return c.json((res.queueUrls ?? []).map(u => ({
        name: u.split('/').filter(Boolean).pop() ?? u,
        url: u,
    })))
})

export default app
