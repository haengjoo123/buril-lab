export const MANUFACTURER_DATE_TYPES = [
    'expiry',
    'minimum_shelf_life',
    'unlabeled',
] as const;

export type ManufacturerDateType = (typeof MANUFACTURER_DATE_TYPES)[number];

export const DEFAULT_MANUFACTURER_DATE_TYPE: ManufacturerDateType = 'unlabeled';

export function isManufacturerDateType(value: unknown): value is ManufacturerDateType {
    return typeof value === 'string'
        && (MANUFACTURER_DATE_TYPES as readonly string[]).includes(value);
}

export function normalizeManufacturerDateType(value: unknown): ManufacturerDateType {
    return isManufacturerDateType(value) ? value : DEFAULT_MANUFACTURER_DATE_TYPE;
}

export function hasManufacturerDate(type: ManufacturerDateType | null | undefined): boolean {
    return normalizeManufacturerDateType(type) !== 'unlabeled';
}

export function getManufacturerDateLabelKey(type: ManufacturerDateType | null | undefined): string {
    switch (normalizeManufacturerDateType(type)) {
        case 'minimum_shelf_life':
            return 'manufacturer_date_type_minimum_shelf_life';
        case 'expiry':
            return 'manufacturer_date_type_expiry';
        default:
            return 'manufacturer_date_type_unlabeled';
    }
}
