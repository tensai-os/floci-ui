import {CloudAdapterRegistry} from './registry/CloudAdapterRegistry'
import {AwsStorageAdapter} from './adapter-aws/AwsStorageAdapter'
import {AzureStorageAdapter} from './adapter-azure/AzureStorageAdapter'
import {CloudProxyService} from './service/CloudProxyService'

export function createCloudProxyService(): CloudProxyService {
    const registry = new CloudAdapterRegistry([
        new AwsStorageAdapter(),
        new AzureStorageAdapter(),
    ])

    return new CloudProxyService(registry)
}
