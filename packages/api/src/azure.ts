export interface AzureRuntimeFetchOptions {
    emptyOnNotFound?: boolean
}

export interface AzureRuntimeClient {
    readonly endpoint: string
    fetch(path: string, init: RequestInit, options?: AzureRuntimeFetchOptions): Promise<Response | null>
}

export class AzureRestRuntimeClient implements AzureRuntimeClient {
    constructor(readonly endpoint: string = azureEndpoint()) {}

    async fetch(path: string, init: RequestInit, options: AzureRuntimeFetchOptions = {}): Promise<Response | null> {
        const res = await globalThis.fetch(`${this.endpoint}${path}`, {
            ...init,
            headers: {
                'x-ms-version': '2021-12-02',
                ...(init.headers ?? {}),
            },
        })

        if (options.emptyOnNotFound && res.status === 404) return null
        if (!res.ok) throw new Error(`Azure Blob request failed: HTTP ${res.status}`)

        return res
    }
}

export function azureEndpoint(): string {
    return process.env.FLOCI_AZURE_ENDPOINT ?? process.env.FLOCI_AZ_ENDPOINT ?? 'http://localhost:4577'
}

export const azure = new AzureRestRuntimeClient()
