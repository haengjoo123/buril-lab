import { supabase } from './supabaseClient';
import type { WasteHazardFlag, WasteStreamCode } from '../types';

export interface ResolvedWasteStream {
    streamCode: WasteStreamCode;
    displayNameKo: string;
    displayNameEn: string;
    descriptionKo?: string | null;
    containerLabel?: string | null;
    containerColor?: string | null;
    location?: string | null;
    handlerContact?: string | null;
    sopUrl?: string | null;
    allowedHazardFlags: WasteHazardFlag[];
    blockedHazardFlags: WasteHazardFlag[];
    prohibitions: string[];
    labelRequirements: string[];
    policyVersionId?: string | null;
    policyScope?: 'system' | 'institution' | 'lab' | string;
    sourceRefs: WastePolicySourceRef[];
    isEnabled: boolean;
    sortOrder: number;
    /** Institution/system physical values before any lab-level overlay. */
    inheritedPhysical: WastePhysicalDestination;
    /** Raw lab-owned values. Null means every value is inherited. */
    labOverride: LabWasteStreamOverrideSnapshot | null;
}

export interface WastePhysicalDestination {
    containerLabel?: string | null;
    containerColor?: string | null;
    location?: string | null;
    handlerContact?: string | null;
}

export interface LabWasteStreamOverrideSnapshot extends WastePhysicalDestination {
    id?: string | null;
    replacementLocation?: string | null;
    isDisabled: boolean;
    updatedAt?: string | null;
}

export interface WastePolicySourceRef {
    title: string;
    url?: string | null;
}

export interface ActiveWastePolicy {
    systemPolicyVersionId?: string | null;
    institutionPolicyVersionId?: string | null;
    labPolicyVersionId?: string | null;
    resolvedStreams: ResolvedWasteStream[];
}

export interface LabWasteStreamOverrideInput {
    labId: string;
    streamCode: WasteStreamCode;
    containerLabel?: string | null;
    containerColor?: string | null;
    location?: string | null;
    handlerContact?: string | null;
    replacementLocation?: string | null;
    isDisabled?: boolean;
}

export interface LabWasteStreamOverrideReceipt {
    id?: string | null;
    labId: string;
    streamCode: WasteStreamCode;
    containerLabel?: string | null;
    containerColor?: string | null;
    location?: string | null;
    handlerContact?: string | null;
    replacementLocation?: string | null;
    isDisabled: boolean;
    updatedAt?: string | null;
    reset: boolean;
}

export interface SafetyCenterWastePolicyVersion {
    id: string;
    centerId: string;
    policyKey: string;
    versionLabel: string;
    name: string;
    status: 'draft' | 'active' | 'retired';
    parentPolicyVersionId?: string | null;
    sourceRefs: WastePolicySourceRef[];
    createdAt: string;
    activatedAt?: string | null;
    streams: ResolvedWasteStream[];
}

export interface SafetyCenterWastePolicyStreamInput {
    streamCode: WasteStreamCode;
    displayNameKo: string;
    displayNameEn: string;
    descriptionKo?: string | null;
    containerLabel?: string | null;
    containerColor?: string | null;
    location?: string | null;
    handlerContact?: string | null;
    sopUrl?: string | null;
    allowedHazardFlags: WasteHazardFlag[];
    blockedHazardFlags: WasteHazardFlag[];
    prohibitions: string[];
    labelRequirements: string[];
    isEnabled: boolean;
    sortOrder: number;
}

export interface SaveSafetyCenterWastePolicyDraftInput {
    centerId: string;
    versionLabel: string;
    name: string;
    streams: SafetyCenterWastePolicyStreamInput[];
    sourceRefs?: WastePolicySourceRef[];
}

export interface SafetyCenterWastePolicyDraftReceipt {
    id: string;
    centerId: string;
    policyKey: string;
    versionLabel: string;
    status: 'draft';
    streamCount: number;
    parentPolicyVersionId?: string | null;
}

export interface SafetyCenterWastePolicyActivationReceipt {
    id: string;
    policyKey: string;
    scopeType: 'safety_center';
    status: 'active';
    activatedAt: string;
    activatedBy: string;
}

const asStringArray = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

const WASTE_HAZARD_FLAGS = new Set<WasteHazardFlag>([
    'FLAMMABLE', 'OXIDIZER', 'EXPLOSIVE', 'SELF_REACTIVE', 'WATER_REACTIVE',
    'PYROPHORIC', 'CORROSIVE', 'ACUTE_TOXIC', 'CMR', 'ENVIRONMENTAL_HAZARD',
    'CYANIDE', 'SULFIDE', 'HEAVY_METAL', 'HYDROFLUORIC_ACID', 'FLUORIDE',
    'REACTIVE', 'UNKNOWN_COMPONENT',
]);
const WASTE_STREAM_CODES = new Set<WasteStreamCode>([
    'ACID_AQUEOUS',
    'ALKALI_AQUEOUS',
    'ORGANIC_HALOGENATED',
    'ORGANIC_NON_HALOGENATED',
    'HEAVY_METAL',
    'CYANIDE_SULFIDE',
    'REACTIVE_OXIDIZER',
    'SOLID_CONTAMINATED',
    'AQUEOUS_OTHER',
    'SPECIAL_REVIEW',
]);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const assertUuid = (value: string, field: string): void => {
    if (!UUID_PATTERN.test(value)) throw new Error(`${field} must be a valid UUID.`);
};

const asHazardFlags = (value: unknown): WasteHazardFlag[] =>
    asStringArray(value).filter((item): item is WasteHazardFlag =>
        WASTE_HAZARD_FLAGS.has(item as WasteHazardFlag)
    );

const asSourceRefs = (value: unknown): WastePolicySourceRef[] => {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item): WastePolicySourceRef[] => {
        if (typeof item === 'string' && item.trim()) {
            return [{ title: item.trim() }];
        }
        if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
        const record = item as Record<string, unknown>;
        const title = typeof record.title === 'string' ? record.title.trim() : '';
        if (!title) return [];
        const url = typeof record.url === 'string' && record.url.trim()
            ? record.url.trim()
            : null;
        return [{ title, url }];
    });
};

const asNullableString = (value: unknown): string | null =>
    typeof value === 'string' ? value : null;

const normalizePhysicalDestination = (value: unknown): WastePhysicalDestination => {
    const source = value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
    return {
        containerLabel: asNullableString(source.containerLabel ?? source.container_label),
        containerColor: asNullableString(source.containerColor ?? source.container_color),
        location: asNullableString(source.location),
        handlerContact: asNullableString(source.handlerContact ?? source.handler_contact),
    };
};

const normalizeLabOverride = (value: unknown): LabWasteStreamOverrideSnapshot | null => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const source = value as Record<string, unknown>;
    return {
        id: asNullableString(source.id),
        ...normalizePhysicalDestination(source),
        replacementLocation: asNullableString(
            source.replacementLocation ?? source.replacement_location,
        ),
        isDisabled: (source.isDisabled ?? source.is_disabled) === true,
        updatedAt: asNullableString(source.updatedAt ?? source.updated_at),
    };
};

const normalizeStream = (value: unknown): ResolvedWasteStream | null => {
    if (!value || typeof value !== 'object') return null;
    const stream = value as Record<string, unknown>;
    const streamCode = (stream.streamCode ?? stream.stream_code) as WasteStreamCode | undefined;
    if (!streamCode ||
        typeof streamCode !== 'string' ||
        !WASTE_STREAM_CODES.has(streamCode)) return null;

    const inheritedPhysical = normalizePhysicalDestination(
        stream.inheritedPhysical ?? stream.inherited_physical,
    );
    const labOverride = normalizeLabOverride(stream.labOverride ?? stream.lab_override);

    return {
        streamCode,
        displayNameKo: String(stream.displayNameKo ?? stream.display_name_ko ?? streamCode),
        displayNameEn: String(stream.displayNameEn ?? stream.display_name_en ?? streamCode),
        descriptionKo: (stream.descriptionKo ?? stream.description_ko ?? null) as string | null,
        containerLabel: (stream.containerLabel ?? stream.container_label ?? null) as string | null,
        containerColor: (stream.containerColor ?? stream.container_color ?? null) as string | null,
        location: (stream.location ?? null) as string | null,
        handlerContact: (stream.handlerContact ?? stream.handler_contact ?? null) as string | null,
        sopUrl: (stream.sopUrl ?? stream.sop_url ?? null) as string | null,
        allowedHazardFlags: asHazardFlags(stream.allowedHazardFlags ?? stream.allowed_hazard_flags),
        blockedHazardFlags: asHazardFlags(stream.blockedHazardFlags ?? stream.blocked_hazard_flags),
        prohibitions: asStringArray(stream.prohibitions),
        labelRequirements: asStringArray(stream.labelRequirements ?? stream.label_requirements),
        policyVersionId: (stream.policyVersionId ?? stream.policy_version_id ?? null) as string | null,
        policyScope: (stream.policyScope ?? stream.policy_scope ?? 'system') as string,
        sourceRefs: asSourceRefs(stream.sourceRefs ?? stream.source_refs),
        isEnabled: (stream.isEnabled ?? stream.is_enabled) !== false,
        sortOrder: Number.isFinite(Number(stream.sortOrder ?? stream.sort_order))
            ? Number(stream.sortOrder ?? stream.sort_order)
            : 0,
        inheritedPhysical,
        labOverride,
    };
};

export async function getActiveWastePolicyV2(labId?: string | null): Promise<ActiveWastePolicy> {
    const { data, error } = await supabase.rpc('get_active_waste_policy_v2', {
        p_lab_id: labId ?? null,
    });

    if (error) throw error;
    const value = (data ?? {}) as Record<string, unknown>;
    const rawStreams = value.resolvedStreams ?? value.resolved_streams;

    return {
        systemPolicyVersionId: (value.systemPolicyVersionId ?? value.system_policy_version_id ?? null) as string | null,
        institutionPolicyVersionId: (value.institutionPolicyVersionId ?? value.institution_policy_version_id ?? null) as string | null,
        labPolicyVersionId: (value.labPolicyVersionId ?? value.lab_policy_version_id ?? null) as string | null,
        resolvedStreams: Array.isArray(rawStreams)
            ? rawStreams.map(normalizeStream).filter((item): item is ResolvedWasteStream => Boolean(item))
            : [],
    };
}

/** Lab admins can only provide physical, on-site details; safety rules are not writable here. */
export async function upsertLabWasteStreamOverrideV2(
    input: LabWasteStreamOverrideInput,
): Promise<LabWasteStreamOverrideReceipt> {
    const clean = (value?: string | null) => value?.trim() || null;
    const { data, error } = await supabase.rpc('upsert_lab_waste_stream_override_v2', {
        p_lab_id: input.labId,
        p_stream_code: input.streamCode,
        p_container_label: clean(input.containerLabel),
        p_container_color: clean(input.containerColor),
        p_location: clean(input.location),
        p_handler_contact: clean(input.handlerContact),
        p_replacement_location: input.isDisabled ? clean(input.replacementLocation) : null,
        p_is_disabled: input.isDisabled === true,
    });

    if (error) throw error;
    const value = (Array.isArray(data) ? data[0] : data ?? {}) as Record<string, unknown>;
    const labId = value.labId ?? value.lab_id;
    const streamCode = value.streamCode ?? value.stream_code;
    if (labId !== input.labId ||
        streamCode !== input.streamCode ||
        typeof value.reset !== 'boolean') {
        throw new Error('The lab waste-stream override RPC returned an invalid receipt.');
    }

    return {
        id: (value.id ?? null) as string | null,
        labId: labId as string,
        streamCode: streamCode as WasteStreamCode,
        containerLabel: (value.containerLabel ?? value.container_label ?? null) as string | null,
        containerColor: (value.containerColor ?? value.container_color ?? null) as string | null,
        location: (value.location ?? null) as string | null,
        handlerContact: (value.handlerContact ?? value.handler_contact ?? null) as string | null,
        replacementLocation: (
            value.replacementLocation ?? value.replacement_location ?? null
        ) as string | null,
        isDisabled: (value.isDisabled ?? value.is_disabled) === true,
        updatedAt: (value.updatedAt ?? value.updated_at ?? null) as string | null,
        reset: Boolean(value.reset),
    };
}

/** Read immutable institution policy versions; RLS limits rows to center members. */
export async function getSafetyCenterWastePolicyVersionsV2(
    centerId: string,
): Promise<SafetyCenterWastePolicyVersion[]> {
    assertUuid(centerId, 'centerId');
    const { data: versionRows, error: versionError } = await supabase
        .from('waste_policy_versions')
        .select('id,safety_center_id,policy_key,version_label,name,status,parent_policy_version_id,source_refs,created_at,activated_at')
        .eq('scope_type', 'safety_center')
        .eq('safety_center_id', centerId)
        .order('created_at', { ascending: false })
        .limit(30);

    if (versionError) throw versionError;
    const rows = Array.isArray(versionRows)
        ? versionRows as unknown as Array<Record<string, unknown>>
        : [];
    const ids = rows
        .map((row) => row.id)
        .filter((id): id is string => typeof id === 'string');
    let streamRows: Array<Record<string, unknown>> = [];
    if (ids.length > 0) {
        const { data, error } = await supabase
            .from('waste_policy_streams')
            .select('*')
            .in('policy_version_id', ids)
            .order('sort_order', { ascending: true });
        if (error) throw error;
        streamRows = Array.isArray(data) ? data as Array<Record<string, unknown>> : [];
    }

    return rows.flatMap((row): SafetyCenterWastePolicyVersion[] => {
        const id = typeof row.id === 'string' ? row.id : '';
        const rowCenterId = typeof row.safety_center_id === 'string' ? row.safety_center_id : '';
        const policyKey = typeof row.policy_key === 'string' ? row.policy_key : '';
        const versionLabel = typeof row.version_label === 'string' ? row.version_label : '';
        const name = typeof row.name === 'string' ? row.name : '';
        const status = row.status;
        const createdAt = typeof row.created_at === 'string' ? row.created_at : '';
        if (!id || rowCenterId !== centerId || !policyKey || !versionLabel || !name || !createdAt ||
            (status !== 'draft' && status !== 'active' && status !== 'retired')) return [];
        const sourceRefs = asSourceRefs(row.source_refs);
        const streams = streamRows
            .filter((stream) => stream.policy_version_id === id)
            .map((stream) => normalizeStream({
                ...stream,
                policyScope: 'institution',
                policyVersionId: id,
                sourceRefs,
            }))
            .filter((stream): stream is ResolvedWasteStream => Boolean(stream));
        return [{
            id,
            centerId: rowCenterId,
            policyKey,
            versionLabel,
            name,
            status,
            parentPolicyVersionId: typeof row.parent_policy_version_id === 'string'
                ? row.parent_policy_version_id
                : null,
            sourceRefs,
            createdAt,
            activatedAt: typeof row.activated_at === 'string' ? row.activated_at : null,
            streams,
        }];
    });
}

/** Create a complete new draft snapshot; existing policy versions remain immutable. */
export async function saveSafetyCenterWastePolicyDraftV2(
    input: SaveSafetyCenterWastePolicyDraftInput,
): Promise<SafetyCenterWastePolicyDraftReceipt> {
    assertUuid(input.centerId, 'centerId');
    const versionLabel = input.versionLabel.trim();
    const name = input.name.trim();
    if (!versionLabel || !name) throw new Error('Policy name and version are required.');
    if (input.streams.length < 1 || input.streams.length > WASTE_STREAM_CODES.size) {
        throw new Error('A policy must contain between 1 and 10 waste categories.');
    }

    const clean = (value?: string | null) => value?.replace(/\s+/g, ' ').trim() || null;
    const cleanList = (values: string[]) => Array.from(new Set(
        values.map((value) => clean(value)).filter((value): value is string => Boolean(value)),
    ));
    const streams = input.streams.map((stream) => {
        if (!WASTE_STREAM_CODES.has(stream.streamCode)) throw new Error('Unsupported waste category code.');
        return {
            streamCode: stream.streamCode,
            displayNameKo: stream.displayNameKo.trim(),
            displayNameEn: stream.displayNameEn.trim(),
            descriptionKo: clean(stream.descriptionKo),
            containerLabel: clean(stream.containerLabel),
            containerColor: clean(stream.containerColor),
            location: clean(stream.location),
            handlerContact: clean(stream.handlerContact),
            sopUrl: clean(stream.sopUrl),
            allowedHazardFlags: Array.from(new Set(stream.allowedHazardFlags.filter((flag) => WASTE_HAZARD_FLAGS.has(flag)))),
            blockedHazardFlags: Array.from(new Set(stream.blockedHazardFlags.filter((flag) => WASTE_HAZARD_FLAGS.has(flag)))),
            prohibitions: cleanList(stream.prohibitions),
            labelRequirements: cleanList(stream.labelRequirements),
            isEnabled: stream.isEnabled,
            sortOrder: stream.sortOrder,
        };
    });
    const sourceRefs = (input.sourceRefs ?? []).flatMap((reference) => {
        const title = clean(reference.title);
        if (!title) return [];
        return [{ title, url: clean(reference.url) }];
    });

    const { data, error } = await supabase.rpc('save_safety_center_waste_policy_draft_v2', {
        p_center_id: input.centerId,
        p_version_label: versionLabel,
        p_name: name,
        p_streams: streams,
        p_source_refs: sourceRefs,
    });
    if (error) throw error;

    const value = (Array.isArray(data) ? data[0] : data ?? {}) as Record<string, unknown>;
    const id = value.id;
    const returnedCenterId = value.centerId ?? value.center_id;
    const policyKey = value.policyKey ?? value.policy_key;
    const returnedVersionLabel = value.versionLabel ?? value.version_label;
    const streamCount = value.streamCount ?? value.stream_count;
    const parentPolicyVersionId = value.parentPolicyVersionId ?? value.parent_policy_version_id;
    if (typeof id !== 'string' || !UUID_PATTERN.test(id) || returnedCenterId !== input.centerId ||
        typeof policyKey !== 'string' || returnedVersionLabel !== versionLabel ||
        value.status !== 'draft' || streamCount !== streams.length) {
        throw new Error('The safety-center policy RPC returned an invalid receipt.');
    }
    return {
        id,
        centerId: returnedCenterId,
        policyKey,
        versionLabel: returnedVersionLabel,
        status: 'draft',
        streamCount,
        parentPolicyVersionId: typeof parentPolicyVersionId === 'string' ? parentPolicyVersionId : null,
    };
}

/** Activate one reviewed draft. The server retires the previous center version atomically. */
export async function activateSafetyCenterWastePolicyV2(
    policyVersionId: string,
): Promise<SafetyCenterWastePolicyActivationReceipt> {
    assertUuid(policyVersionId, 'policyVersionId');
    const { data, error } = await supabase.rpc('activate_waste_policy_v2', {
        p_policy_version_id: policyVersionId,
    });
    if (error) throw error;
    const value = (Array.isArray(data) ? data[0] : data ?? {}) as Record<string, unknown>;
    const id = value.id;
    const policyKey = value.policyKey ?? value.policy_key;
    const scopeType = value.scopeType ?? value.scope_type;
    const activatedAt = value.activatedAt ?? value.activated_at;
    const activatedBy = value.activatedBy ?? value.activated_by;
    if (id !== policyVersionId || typeof policyKey !== 'string' || scopeType !== 'safety_center' ||
        value.status !== 'active' || typeof activatedAt !== 'string' || typeof activatedBy !== 'string') {
        throw new Error('The policy activation RPC returned an invalid receipt.');
    }
    return {
        id,
        policyKey,
        scopeType,
        status: 'active',
        activatedAt,
        activatedBy,
    };
}
