import type {CloudServiceDescriptor, CloudServiceType} from '@/types/cloud'

interface ServiceSelectorProps {
    services: CloudServiceDescriptor[]
    selected: CloudServiceType
    onSelect: (service: CloudServiceType) => void
}

export function ServiceSelector({services, selected, onSelect}: ServiceSelectorProps) {
    return (
        <div className="service-selector" aria-label="Cloud service">
            {services.map((service) => (
                <button
                    key={service.service}
                    className={`selector-pill ${selected === service.service ? 'active' : ''}`}
                    disabled={service.availability !== 'available'}
                    onClick={() => onSelect(service.service)}
                    type="button"
                >
                    <span>{service.displayName}</span>
                    {service.availability === 'coming_soon' && <span className="badge neutral">Soon</span>}
                </button>
            ))}
        </div>
    )
}
