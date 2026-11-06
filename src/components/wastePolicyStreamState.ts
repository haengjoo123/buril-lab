import type { ResolvedWasteStream } from '../services/wastePolicyService';

export type WasteStreamOverrideState = 'default' | 'modified' | 'disabled';

export const WASTE_STREAM_STATE_LABEL_KEYS: Record<WasteStreamOverrideState, string> = {
    default: 'waste_policy_state_default',
    modified: 'waste_policy_state_modified',
    disabled: 'waste_policy_state_disabled',
};

const hasText = (value?: string | null) => Boolean(value?.trim());

/** Whether this lab has changed a stream, so each row can show it at a glance. */
export function getWasteStreamOverrideState(
    stream: Pick<ResolvedWasteStream, 'labOverride'>,
): WasteStreamOverrideState {
    const override = stream.labOverride;
    if (!override) return 'default';
    if (override.isDisabled) return 'disabled';
    const hasOwnValue = [
        override.containerLabel,
        override.containerColor,
        override.location,
        override.handlerContact,
    ].some(hasText);
    return hasOwnValue ? 'modified' : 'default';
}

/** Where users are currently sent for this stream: the lab's value first, then the inherited one. */
export function getWasteStreamEffectiveLocation(
    stream: Pick<ResolvedWasteStream, 'labOverride' | 'inheritedPhysical'>,
): string | null {
    const override = stream.labOverride;
    if (override?.isDisabled) return override.replacementLocation?.trim() || null;
    return override?.location?.trim() || stream.inheritedPhysical.location?.trim() || null;
}

const POLICY_SOURCE_LABEL_KEYS: Record<string, string> = {
    system: 'waste_policy_source_system',
    institution: 'waste_policy_source_institution',
    lab: 'waste_policy_source_lab',
};

/** i18n key for a resolved policy scope; null for scopes we have no label for. */
export function getWastePolicySourceLabelKey(scope?: string | null): string | null {
    return POLICY_SOURCE_LABEL_KEYS[scope ?? 'system'] ?? null;
}
