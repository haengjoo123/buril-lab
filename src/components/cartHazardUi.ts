import type { WasteComponent } from '../types';

export function isHazardLookupPending(component: WasteComponent, enrichmentEnabled: boolean): boolean {
    if (!enrichmentEnabled || component.hazardDataConfirmedByUser || component.ghsDataStatus === 'verified') return false;
    const status = component.chemical.hazardLookup?.status;
    return !status || (status === 'transient_error' && (component.enrichmentRetryCount ?? 0) < 2);
}

export function needsHazardLabelCheck(component: WasteComponent, enrichmentEnabled: boolean): boolean {
    return component.ghsDataStatus === 'lookup_failed'
        && !component.hazardDataConfirmedByUser
        && !isHazardLookupPending(component, enrichmentEnabled);
}

export function shouldShowManualHazardPanel(component: WasteComponent, enrichmentEnabled: boolean): boolean {
    return component.ghsDataStatus !== 'verified' && (
        needsHazardLabelCheck(component, enrichmentEnabled) || Boolean(component.hazardDataConfirmedByUser)
    );
}

export function getHazardLookupMessageKey(component: WasteComponent): string {
    switch (component.chemical.hazardLookup?.status) {
        case 'identity_ambiguous': return 'waste_component_hazard_identity_ambiguous';
        case 'source_absent': return 'waste_component_hazard_source_absent';
        default: return 'waste_component_hazard_lookup_failed';
    }
}
