import type {CloudProvider, CloudServiceType} from './cloud'

export type FieldType = 'text' | 'select'
export type ActionSchema = 'list' | 'create' | 'delete' | 'inspect'

export interface FieldSchema {
    name: string
    label: string
    type: FieldType
    required: boolean
    description?: string
    validation?: {
        pattern?: string
        minLength?: number
        maxLength?: number
        message?: string
    }
    options?: Array<{label: string; value: string}>
}

export interface TableColumnSchema {
    name: string
    label: string
}

export interface ServiceSchema {
    cloud: CloudProvider
    service: CloudServiceType
    displayName: string
    fields: FieldSchema[]
    actions: ActionSchema[]
    filters: FieldSchema[]
    columns: TableColumnSchema[]
}
