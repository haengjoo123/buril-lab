import type { TFunction } from 'i18next';
import type { ReagentTemplateType } from '../../types/fridge';

export const INVENTORY_IMPORT_HEADER_KEYS = [
    'name',
    'brand',
    'product_number',
    'cas_number',
    'quantity',
    'capacity',
    'storage_type',
    'storage_location',
    'shelf_level',
    'shelf_section',
    'container_type',
    'expiry_date',
    'memo',
] as const;

export type InventoryImportHeaderKey = (typeof INVENTORY_IMPORT_HEADER_KEYS)[number];

export const INVENTORY_IMPORT_TEMPLATE_HEADERS_KO: string[] = [
    '시약명',
    '브랜드',
    '제품번호',
    'CAS번호',
    '수량',
    '용량',
    '보관유형',
    '보관위치',
    '선반',
    '칸',
    '시약병',
    '유효기간',
    '메모',
];

interface OtherLocationOption {
    key: 'fridge' | 'freezer' | 'room_temp' | 'bench' | 'hood';
    labelKey: 'loc_fridge' | 'loc_freezer' | 'loc_room_temp' | 'loc_bench' | 'loc_hood';
    aliases: string[];
}

interface ContainerTypeOption {
    type: ReagentTemplateType;
    labelKey:
        | 'cabinet_container_amber'
        | 'cabinet_container_plastic'
        | 'cabinet_container_glass'
        | 'cabinet_container_vial';
    modelUrl: string;
    aliases: string[];
}

export const OTHER_LOCATION_OPTIONS: OtherLocationOption[] = [
    {
        key: 'fridge',
        labelKey: 'loc_fridge',
        aliases: ['냉장고', 'fridge', 'refrigerator'],
    },
    {
        key: 'freezer',
        labelKey: 'loc_freezer',
        aliases: ['냉동고', 'freezer'],
    },
    {
        key: 'room_temp',
        labelKey: 'loc_room_temp',
        aliases: ['상온보관', '상온 보관', '상온', 'room temp', 'room temperature'],
    },
    {
        key: 'bench',
        labelKey: 'loc_bench',
        aliases: ['벤치', 'bench'],
    },
    {
        key: 'hood',
        labelKey: 'loc_hood',
        aliases: ['후드', 'hood', 'fume hood'],
    },
];

export const CONTAINER_TYPE_OPTIONS: ContainerTypeOption[] = [
    {
        type: 'A',
        labelKey: 'cabinet_container_amber',
        modelUrl: '/models/reagents/brown bottle.glb',
        aliases: ['a', '갈색병', '갈색 병', 'amber', 'amber bottle', 'brown', 'brown bottle'],
    },
    {
        type: 'B',
        labelKey: 'cabinet_container_plastic',
        modelUrl: '/models/reagents/plastic bottle.glb',
        aliases: ['b', '플라스틱통', '플라스틱 통', '플라스틱', 'plastic', 'plastic bottle', 'plastic container'],
    },
    {
        type: 'C',
        labelKey: 'cabinet_container_glass',
        modelUrl: '/models/reagents/glass.glb',
        aliases: ['c', '유리병', '유리 병', '유리', 'glass', 'glass bottle', 'clear bottle'],
    },
    {
        type: 'D',
        labelKey: 'cabinet_container_vial',
        modelUrl: '/models/reagents/square bottle.glb',
        aliases: ['d', '사각병', '사각 병', '사각', 'square', 'square bottle', 'vial'],
    },
];

export function normalizeImportToken(value: string): string {
    return (value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9가-힣]/gi, '');
}

export function getOtherLocationOptionLabels(t: TFunction): string[] {
    return OTHER_LOCATION_OPTIONS.map((option) => String(t(option.labelKey)));
}

export function findOtherLocationOption(rawValue: string): OtherLocationOption | null {
    const normalized = normalizeImportToken(rawValue);
    if (!normalized) return null;

    return OTHER_LOCATION_OPTIONS.find((option) =>
        option.aliases.some((alias) => normalizeImportToken(alias) === normalized),
    ) || null;
}

export function getContainerTypeLabel(type: ReagentTemplateType, t: TFunction): string {
    const option = CONTAINER_TYPE_OPTIONS.find((item) => item.type === type);
    if (!option) return type;
    return `${String(t(option.labelKey))} (${type})`;
}

export function getContainerTypeOptionLabels(t: TFunction): string[] {
    return CONTAINER_TYPE_OPTIONS.map((option) => getContainerTypeLabel(option.type, t));
}

export function parseImportedContainerType(rawValue: string): ReagentTemplateType | null {
    const trimmed = (rawValue || '').trim();
    if (!trimmed) return null;

    const directCodeMatch = trimmed.match(/^[ABCD]$/i);
    if (directCodeMatch) {
        return directCodeMatch[0].toUpperCase() as ReagentTemplateType;
    }

    const codeInTextMatch = trimmed.match(/\(([ABCD])\)/i) || trimmed.match(/\b([ABCD])\b/i);
    if (codeInTextMatch) {
        return codeInTextMatch[1].toUpperCase() as ReagentTemplateType;
    }

    const normalized = normalizeImportToken(trimmed);
    const matchedOption = CONTAINER_TYPE_OPTIONS.find((option) =>
        option.aliases.some((alias) => normalizeImportToken(alias) === normalized),
    );

    return matchedOption?.type || null;
}
