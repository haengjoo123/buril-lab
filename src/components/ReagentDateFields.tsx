import React from 'react';
import { useTranslation } from 'react-i18next';
import {
    DEFAULT_MANUFACTURER_DATE_TYPE,
    type ManufacturerDateType,
    hasManufacturerDate,
} from '../utils/manufacturerDate';

export interface ReagentDateValues {
    manufacturer_date_type?: ManufacturerDateType;
    expiry_date?: string;
    received_date?: string;
    opened_date?: string;
}

interface ReagentDateFieldsProps {
    value: ReagentDateValues;
    onChange: (next: Required<ReagentDateValues>) => void;
    className?: string;
    labelClassName?: string;
    inputClassName?: string;
    columnsClassName?: string;
}

export const ReagentDateFields: React.FC<ReagentDateFieldsProps> = ({
    value,
    onChange,
    className = '',
    labelClassName = 'text-sm font-semibold text-slate-700 dark:text-slate-300',
    inputClassName = 'w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none text-slate-900 dark:text-slate-100 min-h-[42px]',
    columnsClassName = 'grid grid-cols-1 gap-3',
}) => {
    const { t, i18n } = useTranslation();
    const manufacturerDateType = value.manufacturer_date_type || DEFAULT_MANUFACTURER_DATE_TYPE;
    const dateVisible = hasManufacturerDate(manufacturerDateType);

    const emit = (patch: Partial<Required<ReagentDateValues>>) => {
        const next = {
            manufacturer_date_type: manufacturerDateType,
            expiry_date: value.expiry_date || '',
            received_date: value.received_date || '',
            opened_date: value.opened_date || '',
            ...patch,
        } as Required<ReagentDateValues>;

        if (!hasManufacturerDate(next.manufacturer_date_type)) {
            next.expiry_date = '';
        }
        onChange(next);
    };

    return (
        <div className={`flex flex-col gap-3 ${className}`}>
            <div className="flex flex-col gap-1.5">
                <label className={labelClassName}>{t('manufacturer_date_type_label')}</label>
                <select
                    value={manufacturerDateType}
                    onChange={(event) => emit({ manufacturer_date_type: event.target.value as ManufacturerDateType })}
                    className={inputClassName}
                >
                    <option value="expiry">{t('manufacturer_date_type_expiry')}</option>
                    <option value="minimum_shelf_life">{t('manufacturer_date_type_minimum_shelf_life')}</option>
                    <option value="unlabeled">{t('manufacturer_date_type_unlabeled')}</option>
                </select>
            </div>

            <div className={columnsClassName}>
                {dateVisible && (
                    <div className="flex flex-col gap-1.5">
                        <label className={labelClassName}>
                            {manufacturerDateType === 'minimum_shelf_life'
                                ? t('manufacturer_date_type_minimum_shelf_life')
                                : t('manufacturer_date_type_expiry')}
                        </label>
                        <input
                            type="date"
                            value={value.expiry_date || ''}
                            onChange={(event) => emit({ expiry_date: event.target.value })}
                            lang={i18n.language.startsWith('ko') ? 'ko' : 'en-US'}
                            className={inputClassName}
                        />
                    </div>
                )}
                <div className="flex flex-col gap-1.5">
                    <label className={labelClassName}>{t('inventory_received_date')}</label>
                    <input
                        type="date"
                        value={value.received_date || ''}
                        onChange={(event) => emit({ received_date: event.target.value })}
                        lang={i18n.language.startsWith('ko') ? 'ko' : 'en-US'}
                        className={inputClassName}
                    />
                </div>
                <div className="flex flex-col gap-1.5">
                    <label className={labelClassName}>{t('inventory_opened_date')}</label>
                    <input
                        type="date"
                        value={value.opened_date || ''}
                        onChange={(event) => emit({ opened_date: event.target.value })}
                        lang={i18n.language.startsWith('ko') ? 'ko' : 'en-US'}
                        className={inputClassName}
                    />
                </div>
            </div>
        </div>
    );
};
