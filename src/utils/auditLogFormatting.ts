import type { TFunction } from 'i18next';
import type { AuditLog } from '../services/auditService';
import { translateLocationName } from './i18nUtils';
import { wasteStreamLabel } from './wasteLabels';
import { containerStatusLabel } from '../features/wasteContainers/copy';

type JsonRecord = Record<string, unknown>;

export interface AuditChangeRow {
    key: string;
    label: string;
    fromText: string;
    toText: string;
}

export interface AuditDetailRow {
    key: string;
    label: string;
    value: string;
}

export interface AuditDetailSection {
    key: 'before' | 'after';
    title: string;
    rows: AuditDetailRow[];
}

const ACTION_KEY: Record<string, string> = {
    create: 'audit_action_create',
    update: 'audit_action_update',
    delete: 'audit_action_delete',
    // Lab admin actions recorded by the database (members, center links, waste site settings).
    join: 'audit_action_join',
    role_change: 'audit_action_role_change',
    remove: 'audit_action_remove',
    leave: 'audit_action_leave',
    link_request: 'audit_action_link_request',
    link_approve: 'audit_action_link_approve',
    link_reject: 'audit_action_link_reject',
    link_revoke: 'audit_action_link_revoke',
    scope_change: 'audit_action_scope_change',
};

type AuditActionCategory = 'create' | 'update' | 'delete' | 'activity';

/** Where the lab admin actions fall in the create/update/delete counters and filters. */
const ACTION_CATEGORY: Record<string, Exclude<AuditActionCategory, 'activity'>> = {
    join: 'create',
    role_change: 'update',
    link_request: 'update',
    link_approve: 'update',
    link_reject: 'update',
    link_revoke: 'update',
    scope_change: 'update',
    remove: 'delete',
    leave: 'delete',
};

const ENTITY_KEY: Record<string, string> = {
    inventory: 'audit_entity_inventory',
    cabinet_item: 'audit_entity_cabinet_item',
    cabinet_activity: 'audit_entity_cabinet_activity',
    cabinet: 'audit_entity_cabinet',
    waste_log: 'audit_entity_waste_log',
    waste_container: 'audit_entity_waste_container',
    lab_member: 'audit_entity_lab_member',
    safety_center_link: 'audit_entity_safety_center_link',
    waste_policy_override: 'audit_entity_waste_policy_override',
};

/** Center link states (safety_center_lab_links.status) shown in link records. */
const LINK_STATUS_KEY: Record<string, string> = {
    requested: 'sc_link_requested',
    approved: 'sc_link_approved',
    rejected: 'sc_link_rejected',
    revoked: 'sc_link_revoked',
};

const FIELD_KEY: Record<string, string> = {
    name: 'audit_field_name',
    quantity: 'audit_field_quantity',
    capacity: 'audit_field_capacity',
    expiry_date: 'audit_field_expiry_date',
    manufacturer_date_type: 'manufacturer_date_type_label',
    received_date: 'inventory_received_date',
    opened_date: 'inventory_opened_date',
    memo: 'audit_field_memo',
    notes: 'audit_field_memo',
    brand: 'audit_field_brand',
    product_number: 'audit_field_product_number',
    cas_number: 'audit_field_cas_number',
    cas_no: 'audit_field_cas_number',
    action_type: 'audit_field_action_type',
    item_name: 'audit_field_item_name',
    storage_type: 'audit_field_storage_type',
    cabinet_id: 'audit_field_cabinet_id',
    storage_location_id: 'audit_field_storage_location_id',
    status: 'audit_field_waste_container_status',
    location: 'audit_field_waste_container_location',
    stream_code: 'audit_field_waste_container_stream',
    pickup: 'audit_field_waste_container_pickup',
    role: 'audit_field_role',
    scope: 'audit_field_scope',
    center_name: 'audit_field_center_name',
    is_disabled: 'audit_field_is_disabled',
    changed_fields: 'audit_field_changed_fields',
};

const FIELD_ORDER = [
    'item_name',
    'name',
    'role',
    'status',
    'scope',
    'center_name',
    'stream_code',
    'is_disabled',
    'changed_fields',
    'action_type',
    'reason',
    'quantity',
    'remaining_percent',
    'capacity',
    'brand',
    'product_number',
    'cas_number',
    'cas_no',
    'manufacturer_date_type',
    'expiry_date',
    'received_date',
    'opened_date',
    'storage_type',
    'cabinet_id',
    'storage_location_id',
    'location_context',
    'memo',
    'notes',
] as const;

const HIDDEN_FIELDS = new Set([
    'id',
    'lab_id',
    'user_id',
    'created_at',
    'updated_at',
    'product_id',
    'request_id',
    'actor_user_id',
    'entity_id',
    'template',
    'shelf_id',
    'width',
    'position',
    'depth_position',
]);

const localeText = (locale: string, ko: string, en: string): string =>
    locale.startsWith('ko') ? ko : en;

const toRecord = (value: unknown): JsonRecord | null => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }

    return value as JsonRecord;
};

const getCabinetActivityActionType = (
    log: Pick<AuditLog, 'entity_type' | 'before_data' | 'after_data'>
): string | null => {
    if (log.entity_type !== 'cabinet_activity') {
        return null;
    }

    const afterData = toRecord(log.after_data);
    if (typeof afterData?.action_type === 'string' && afterData.action_type.trim()) {
        return afterData.action_type;
    }

    const beforeData = toRecord(log.before_data);
    if (typeof beforeData?.action_type === 'string' && beforeData.action_type.trim()) {
        return beforeData.action_type;
    }

    return null;
};

const shouldHideField = (key: string, value: unknown): boolean => {
    // Only fields with a user-facing label belong in an activity history.
    if (HIDDEN_FIELDS.has(key) || (!Object.hasOwn(FIELD_KEY, key) && !FIELD_ORDER.some((field) => field === key))) {
        return true;
    }

    if (typeof value === 'string' && !value.trim()) {
        return true;
    }

    if ((key === 'cabinet_id' || key === 'storage_location_id' || key.endsWith('_id')) && typeof value === 'string' && isUuidLike(value)) {
        return true;
    }

    return false;
};

const formatBoolean = (value: boolean, locale: string): string =>
    value
        ? localeText(locale, '\uC608', 'Yes')
        : localeText(locale, '\uC544\uB2C8\uC624', 'No');

const formatDate = (value: string, locale: string): string => {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return value;
    }

    return parsed.toLocaleDateString(locale.startsWith('ko') ? 'ko-KR' : 'en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
    });
};

const formatActivityAction = (value: string, t: TFunction): string => {
    if (value === 'add') return t('activity_log_action_add');
    if (value === 'remove') return t('activity_log_action_remove');
    if (value === 'clear_all') return t('activity_log_action_clear_all');
    if (value === 'update') return t('audit_action_update');
    return t('audit_change_summary');
};

const formatArrayValue = (key: string, value: unknown[], t: TFunction, locale: string): string => {
    if (value.length === 0) {
        return '-';
    }

    const simpleValues = value.map((entry) => {
        if (entry == null) return null;
        if (typeof entry === 'string' || typeof entry === 'number') return String(entry);
        const record = toRecord(entry);
        if (!record) return null;
        const namedValue = record.item_name ?? record.name;
        if (typeof namedValue === 'string' && namedValue.trim()) {
            return namedValue;
        }
        return null;
    }).filter((entry): entry is string => Boolean(entry));

    if (simpleValues.length === value.length) {
        return simpleValues.join(', ');
    }

    if (key === 'chemicals') {
        return localeText(locale, `\uD56D\uBAA9 ${value.length}\uAC1C`, `${value.length} items`);
    }

    return t('audit_complex_data');
};

/** Center link scope values (summary, risk_detail, ...) as readable labels; unknown values pass through. */
const formatLinkScope = (value: unknown, t: TFunction): string => {
    if (!Array.isArray(value)) return '-';
    const labels = value
        .filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
        .map((entry) => t(`sc_scope_${entry}`, { defaultValue: entry }));
    return labels.length > 0 ? labels.join(', ') : '-';
};

export const isUuidLike = (value: string): boolean =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

export const formatAuditFieldName = (key: string, t: TFunction, locale: string): string => {
    if (FIELD_KEY[key]) {
        return t(FIELD_KEY[key]);
    }

    if (key === 'remaining_percent') {
        return t('voice_agent_chip_remaining');
    }

    if (key === 'reason') {
        return t('log_disposal_reason');
    }

    if (key === 'location_context') {
        return localeText(locale, '\uC704\uCE58', 'Location');
    }

    return t('audit_change_summary');
};

export const getAuditActionCategory = (
    log: Pick<AuditLog, 'action' | 'entity_type' | 'before_data' | 'after_data'>
): AuditActionCategory => {
    if (log.entity_type === 'cabinet_activity') {
        return 'activity';
    }

    if (log.action === 'create' || log.action === 'update' || log.action === 'delete') {
        return log.action;
    }

    return ACTION_CATEGORY[log.action] ?? 'activity';
};

export const formatAuditActionName = (
    action: string,
    t: TFunction,
    log?: Pick<AuditLog, 'entity_type' | 'before_data' | 'after_data'>
): string => {
    const activityActionType = log ? getCabinetActivityActionType(log) : null;

    if (activityActionType === 'add') {
        return t('activity_log_action_add');
    }

    if (activityActionType === 'remove') {
        return t('activity_log_action_remove');
    }

    if (activityActionType === 'clear_all') {
        return t('activity_log_action_clear_all');
    }

    return ACTION_KEY[action] ? t(ACTION_KEY[action]) : t('audit_change_summary');
};

export const formatAuditEntityName = (entityType: string, t: TFunction): string =>
    ENTITY_KEY[entityType] ? t(ENTITY_KEY[entityType]) : t('audit_field_item_name');

export const formatAuditValue = (
    key: string,
    value: unknown,
    t: TFunction,
    locale: string
): string => {
    if (value == null || value === '') {
        return '-';
    }

    if (typeof value === 'boolean') {
        return formatBoolean(value, locale);
    }

    if (typeof value === 'number') {
        if (key === 'remaining_percent') {
            return `${value}%`;
        }
        return String(value);
    }

    if (typeof value === 'string') {
        if (key === 'stream_code') return wasteStreamLabel(value, locale);
        if (key === 'pickup') {
            return t(value === 'requested' ? 'audit_value_pickup_requested' : 'audit_value_pickup_none');
        }
        if (key === 'status') {
            if (value === 'active' || value === 'sealed' || value === 'collected') {
                return containerStatusLabel(value, locale);
            }
            return LINK_STATUS_KEY[value] ? t(LINK_STATUS_KEY[value]) : t('common_unknown');
        }
        if (key === 'role') {
            return t(`member_role_${value}`, { defaultValue: t('common_unknown') });
        }
        if (key === 'storage_type') {
            if (value === 'cabinet') return t('inventory_loc_cabinet');
            if (value === 'other') return t('inventory_loc_other');
            return t('common_unknown');
        }

        if (key === 'action_type') {
            return formatActivityAction(value, t);
        }

        if (key === 'expiry_date' || key === 'received_date' || key === 'opened_date') {
            return formatDate(value, locale);
        }

        if (key === 'manufacturer_date_type') {
            if (value === 'expiry') return t('manufacturer_date_type_expiry');
            if (value === 'minimum_shelf_life') return t('manufacturer_date_type_minimum_shelf_life');
            if (value === 'unlabeled') return t('manufacturer_date_type_unlabeled');
            return t('common_unknown');
        }

        if (key === 'reason' && ['used', 'expired', 'broken', 'other'].includes(value)) {
            return t(`cabinet_dispose_reason_${value}`);
        }

        if (key === 'remaining_percent' && /^-?\d+(\.\d+)?$/.test(value)) {
            return `${value}%`;
        }

        if (key === 'location_context') {
            if (isUuidLike(value)) {
                return '-';
            }
            return translateLocationName(value, t);
        }

        if ((key === 'cabinet_id' || key === 'storage_location_id' || key.endsWith('_id')) && isUuidLike(value)) {
            return '-';
        }

        return value;
    }

    if (Array.isArray(value)) {
        if (key === 'scope') return formatLinkScope(value, t);
        if (key === 'changed_fields') {
            const labels = value
                .filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
                .map((entry) => t(`audit_override_field_${entry}`, { defaultValue: t('common_unknown') }));
            return labels.length > 0 ? labels.join(', ') : '-';
        }
        return formatArrayValue(key, value, t, locale);
    }

    const record = toRecord(value);
    if (record) {
        const namedValue = record.item_name ?? record.name;
        if (typeof namedValue === 'string' && namedValue.trim()) {
            return namedValue;
        }
    }

    return t('audit_complex_data');
};

const sortAuditEntries = (entries: Array<[string, unknown]>): Array<[string, unknown]> => {
    const orderMap = new Map<string, number>(FIELD_ORDER.map((key, index) => [key, index]));

    return [...entries].sort(([keyA], [keyB]) => {
        const orderA = orderMap.get(keyA) ?? Number.MAX_SAFE_INTEGER;
        const orderB = orderMap.get(keyB) ?? Number.MAX_SAFE_INTEGER;
        if (orderA !== orderB) {
            return orderA - orderB;
        }
        return keyA.localeCompare(keyB);
    });
};

const buildAuditRows = (value: unknown, t: TFunction, locale: string): AuditDetailRow[] => {
    const record = toRecord(value);
    if (!record) {
        return [];
    }

    return sortAuditEntries(Object.entries(record)).reduce<AuditDetailRow[]>((rows, [key, rawValue]) => {
        if (shouldHideField(key, rawValue)) {
            return rows;
        }

        const formattedValue = formatAuditValue(key, rawValue, t, locale);
        if (!formattedValue || formattedValue === '-') {
            return rows;
        }

        rows.push({
            key,
            label: formatAuditFieldName(key, t, locale),
            value: formattedValue,
        });
        return rows;
    }, []);
};

export const getAuditChangeRows = (
    log: Pick<AuditLog, 'diff_data'>,
    t: TFunction,
    locale: string
): AuditChangeRow[] => {
    const diffData = toRecord(log.diff_data);
    if (!diffData) {
        return [];
    }

    return sortAuditEntries(Object.entries(diffData)).reduce<AuditChangeRow[]>((rows, [key, rawValue]) => {
        const valueRecord = toRecord(rawValue);
        if (shouldHideField(key, valueRecord?.from) && shouldHideField(key, valueRecord?.to)) {
            return rows;
        }
        const fromText = formatAuditValue(key, valueRecord?.from, t, locale);
        const toText = formatAuditValue(key, valueRecord?.to, t, locale);

        if ((fromText === '-' || !fromText) && (toText === '-' || !toText)) {
            return rows;
        }

        rows.push({
            key,
            label: formatAuditFieldName(key, t, locale),
            fromText,
            toText,
        });
        return rows;
    }, []);
};

export const getAuditDetailSections = (
    log: Pick<AuditLog, 'before_data' | 'after_data'>,
    t: TFunction,
    locale: string
): AuditDetailSection[] => {
    const beforeRows = buildAuditRows(log.before_data, t, locale);
    const afterRows = buildAuditRows(log.after_data, t, locale);
    const sections: AuditDetailSection[] = [];

    if (beforeRows.length > 0) {
        sections.push({
            key: 'before',
            title: t('audit_before'),
            rows: beforeRows,
        });
    }

    if (afterRows.length > 0) {
        sections.push({
            key: 'after',
            title: t('audit_after'),
            rows: afterRows,
        });
    }

    return sections;
};

export interface AuditEventDescriptionContext {
    /** Current lab members, user_id -> display name. A member missing here is shown as a former member. */
    memberNames?: Readonly<Record<string, string>>;
}

type AuditDescriptionLog = Pick<AuditLog, 'actor_name' | 'action' | 'entity_type' | 'before_data' | 'after_data' | 'location_context'>
    & Partial<Pick<AuditLog, 'diff_data'>>;

const textValue = (value: unknown): string | null =>
    typeof value === 'string' && value.trim() ? value : null;

/** Lab member records (join, leave, remove, role change). Null for an action this build does not know. */
const describeMemberEvent = (
    log: AuditDescriptionLog,
    actor: string,
    t: TFunction,
    locale: string,
    context: AuditEventDescriptionContext | undefined,
): string | null => {
    const beforeData = toRecord(log.before_data);
    const afterData = toRecord(log.after_data);
    // The account deletion scrub removes user_id: that member then reads as a former member.
    const userId = textValue(afterData?.user_id) ?? textValue(beforeData?.user_id);
    const member = (userId ? context?.memberNames?.[userId] : undefined) || t('audit_member_former');

    if (log.action === 'join') return t('audit_event_member_join', { actor });
    if (log.action === 'leave') return t('audit_event_member_leave', { actor });
    if (log.action === 'remove') return t('audit_event_member_remove', { actor, member });
    if (log.action === 'role_change') {
        const roleDiff = toRecord(toRecord(log.diff_data)?.role);
        const fromRole = beforeData?.role ?? roleDiff?.from;
        const toRole = afterData?.role ?? roleDiff?.to;
        return t('audit_event_member_role', {
            actor,
            member,
            from: formatAuditValue('role', fromRole, t, locale),
            to: formatAuditValue('role', toRole, t, locale),
        });
    }
    return null;
};

/** Safety center link records. Null for an action this build does not know. */
const describeLinkEvent = (log: AuditDescriptionLog, actor: string, t: TFunction): string | null => {
    const afterData = toRecord(log.after_data);
    const center = textValue(afterData?.center_name) ?? t('audit_center_unknown');
    const scope = formatLinkScope(afterData?.scope, t);

    if (log.action === 'link_request') return t('audit_event_link_request', { center, scope });
    if (log.action === 'link_approve') return t('audit_event_link_approve', { actor, center });
    if (log.action === 'link_reject') return t('audit_event_link_reject', { actor, center });
    if (log.action === 'link_revoke') return t('audit_event_link_revoke', { actor, center });
    if (log.action === 'scope_change') return t('audit_event_link_scope', { center, scope });
    return null;
};

/** Waste container site setting records. Null for an action this build does not know. */
const describeOverrideEvent = (log: AuditDescriptionLog, actor: string, t: TFunction, locale: string): string | null => {
    const streamCode = textValue(toRecord(log.after_data)?.stream_code) ?? textValue(toRecord(log.before_data)?.stream_code) ?? '';
    const stream = wasteStreamLabel(streamCode, locale);

    if (log.action === 'create') return t('audit_event_override_create', { actor, stream });
    if (log.action === 'update') return t('audit_event_override_update', { actor, stream });
    if (log.action === 'delete') return t('audit_event_override_delete', { actor, stream });
    return null;
};

export const buildAuditEventDescription = (
    log: AuditDescriptionLog,
    t: TFunction,
    locale: string,
    context?: AuditEventDescriptionContext
): string => {
    const actor = log.actor_name || t('audit_unknown_user');

    const specificDescription = log.entity_type === 'lab_member'
        ? describeMemberEvent(log, actor, t, locale, context)
        : log.entity_type === 'safety_center_link'
            ? describeLinkEvent(log, actor, t)
            : log.entity_type === 'waste_policy_override'
                ? describeOverrideEvent(log, actor, t, locale)
                : null;
    if (specificDescription) return specificDescription;

    const actionLabel = formatAuditActionName(log.action, t, log);
    const entityLabel = formatAuditEntityName(log.entity_type, t);
    const beforeData = toRecord(log.before_data);
    const afterData = toRecord(log.after_data);

    const itemName =
        (afterData?.item_name as string | undefined) ||
        (afterData?.name as string | undefined) ||
        (beforeData?.item_name as string | undefined) ||
        (beforeData?.name as string | undefined);

    const location = typeof log.location_context === 'string'
        ? formatAuditValue('location_context', log.location_context, t, locale)
        : '-';

    if (itemName && location !== '-') {
        return t('audit_event_item_location', { actor, item: itemName, location, action: actionLabel });
    }

    if (itemName) {
        return t('audit_event_item', { actor, item: itemName, action: actionLabel });
    }

    return t('audit_event_entity', { actor, entity: entityLabel, action: actionLabel });
};
