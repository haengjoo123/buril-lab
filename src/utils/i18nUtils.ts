import type { TFunction } from 'i18next';

/**
 * Translates default storage location names if they match known Korean names.
 * Used across modals and lists to ensure consistent internationalization.
 */
export const translateLocationName = (name: string | null | undefined, t: TFunction): string => {
    if (!name) return '';
    const trimmedName = name.trim();
    
    switch (trimmedName) {
        case '냉장고':
            return t('loc_fridge');
        case '냉동고':
            return t('loc_freezer');
        case '상온 보관':
        case '상온':
            return t('loc_room_temp');
        case '후드':
            return t('loc_hood');
        case '벤치':
            return t('loc_bench');
        default:
            return trimmedName;
    }
};
