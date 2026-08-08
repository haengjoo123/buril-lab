import type { TFunction } from 'i18next';
import type { AuditLog } from '../services/auditService';
import { translateLocationName } from './i18nUtils';

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
};

type AuditActionCategory = 'create' | 'update' | 'delete' | 'activity';

const ENTITY_KEY: Record<string, string> = {
    inventory: 'audit_entity_inventory',
    cabinet_item: 'audit_entity_cabinet_item',
    cabinet_activity: 'audit_entity_cabinet_activity',
    cabinet: 'audit_entity_cabinet',
    waste_log: 'audit_entity_waste_log',
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
};

const FIELD_ORDER = [
    'item_name',
    'name',
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

const titleCaseKey = (value: string): string =>
    value
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (char) => char.toUpperCase());

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
    if (HIDDEN_FIELDS.has(key)) {
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
    return value;
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

    return titleCaseKey(key);
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

    return 'activity';
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

    return ACTION_KEY[action] ? t(ACTION_KEY[action]) : action;
};

export const formatAuditEntityName = (entityType: string, t: TFunction): string =>
    ENTITY_KEY[entityType] ? t(ENTITY_KEY[entityType]) : entityType;

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
        if (key === 'storage_type') {
            if (value === 'cabinet') return t('inventory_loc_cabinet');
            if (value === 'other') return t('inventory_loc_other');
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

export const buildAuditEventDescription = (
    log: Pick<AuditLog, 'actor_name' | 'action' | 'entity_type' | 'before_data' | 'after_data' | 'location_context'>,
    t: TFunction,
    locale: string
): string => {
    const actor = log.actor_name || t('audit_unknown_user');
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
