import {FlociError} from './types'

export const API_BASE = '/api'

export interface FlociRequestEvent {
    service: string
    method: string
    path: string
    statusCode: number
    latencyMs: number
    timestamp: number
}

const listeners = new Set<(event: FlociRequestEvent) => void>()

export function subscribeRequests(cb: (event: FlociRequestEvent) => void): () => void {
    listeners.add(cb)
    return () => listeners.delete(cb)
}

function emitRequest(event: FlociRequestEvent) {
    for (const listener of listeners) {
        try { listener(event) } catch { /* ignore */ }
    }
}

async function apiFetch<T>(path: string, service: string, init: RequestInit, signal?: AbortSignal): Promise<T> {
    const started = performance.now()
    let statusCode = 0
    try {
        const res = await fetch(`${API_BASE}${path}`, {...init, signal}).catch((cause: unknown) => {
            const message = cause instanceof Error ? cause.message : 'Network error'
            throw new FlociError(`Cannot reach floci-api: ${message}`, undefined, path)
        })
        statusCode = res.status
        if (!res.ok) throw new FlociError(await errorMessage(res), res.status, path)
        return res.json() as Promise<T>
    } finally {
        if (statusCode > 0) {
            emitRequest({service, method: init.method ?? 'GET', path, statusCode, latencyMs: Math.round(performance.now() - started), timestamp: Date.now()})
        }
    }
}

async function errorMessage(res: Response): Promise<string> {
    const fallback = `HTTP ${res.status}`
    const contentType = res.headers.get('content-type') ?? ''
    if (!contentType.includes('application/json')) return fallback

    try {
        const body = await res.json() as {error?: unknown}
        return typeof body.error === 'string' && body.error.trim() ? body.error : fallback
    } catch {
        return fallback
    }
}

export function apiGet<T>(path: string, service: string, signal?: AbortSignal): Promise<T> {
    return apiFetch<T>(path, service, {}, signal)
}

export function apiPost<T>(path: string, service: string, body: unknown, signal?: AbortSignal): Promise<T> {
    return apiFetch<T>(path, service, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)}, signal)
}

export function apiPut<T>(path: string, service: string, body: unknown, signal?: AbortSignal): Promise<T> {
    return apiFetch<T>(path, service, {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)}, signal)
}

export function apiDelete<T>(path: string, service: string, signal?: AbortSignal): Promise<T> {
    return apiFetch<T>(path, service, {method: 'DELETE'}, signal)
}
