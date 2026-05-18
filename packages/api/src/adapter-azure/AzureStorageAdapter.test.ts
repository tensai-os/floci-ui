import {afterEach, describe, expect, test} from 'bun:test'
import {AzureStorageAdapter} from './AzureStorageAdapter'
import type {AzureRuntimeClient, AzureRuntimeFetchOptions} from '../azure'

const originalFetch = globalThis.fetch

afterEach(() => {
    globalThis.fetch = originalFetch
})

describe('AzureStorageAdapter', () => {
    test('normalizes missing container list endpoint to an empty list', async () => {
        globalThis.fetch = (async () => new Response('Not Found', {status: 404})) as unknown as typeof fetch

        const adapter = new AzureStorageAdapter(testClient())
        await expect(adapter.list()).resolves.toEqual([])
    })

    test('normalizes missing blob list endpoint to an empty list', async () => {
        globalThis.fetch = (async () => new Response('Not Found', {status: 404})) as unknown as typeof fetch

        const adapter = new AzureStorageAdapter(testClient())
        await expect(adapter.listObjects('container')).resolves.toEqual({prefix: '', objects: []})
    })
})

function testClient(): AzureRuntimeClient {
    return {
        endpoint: 'http://localhost:4577',
        async fetch(path: string, init: RequestInit, options: AzureRuntimeFetchOptions = {}) {
            const res = await globalThis.fetch(path, init)
            if (options.emptyOnNotFound && res.status === 404) return null
            if (!res.ok) throw new Error(`Azure Blob request failed: HTTP ${res.status}`)
            return res
        },
    }
}
