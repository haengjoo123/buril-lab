/**
 * Media Product Filter Component
 * Custom dropdown with modern styling
 */

import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Filter, ArrowUpDown, X, ChevronDown, Check } from 'lucide-react';
import type { SortOption } from '../services/mediaProductService';

interface DropdownProps {
    value: string;
    options: { value: string; label: string }[];
    onChange: (value: string) => void;
    placeholder?: string;
}

const CustomDropdown: React.FC<DropdownProps> = ({ value, options, onChange, placeholder }) => {
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    const selectedOption = options.find(o => o.value === value);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    return (
        <div ref={dropdownRef} className="relative">
            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                className="w-full px-4 py-2.5 text-sm font-medium bg-white dark:bg-slate-700 border-2 border-slate-200 dark:border-slate-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 cursor-pointer transition-all text-slate-700 dark:text-slate-200 shadow-sm hover:border-emerald-400 flex items-center justify-between gap-2"
            >
                <span className="truncate">{selectedOption?.label || placeholder}</span>
                <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            {isOpen && (
                <div className="absolute z-50 w-full mt-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-xl shadow-lg overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
                    <div className="max-h-60 overflow-y-auto">
                        {options.map((option) => (
                            <button
                                key={option.value}
                                type="button"
                                onClick={() => {
                                    onChange(option.value);
                                    setIsOpen(false);
                                }}
                                className={`w-full px-4 py-2.5 text-sm text-left flex items-center justify-between transition-colors ${option.value === value
                                        ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 font-medium'
                                        : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
                                    }`}
                            >
                                <span>{option.label}</span>
                                {option.value === value && <Check className="w-4 h-4" />}
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

interface MediaProductFilterProps {
    brands: string[];
    selectedBrand: string;
    onBrandChange: (brand: string) => void;
    sortBy: SortOption;
    onSortChange: (sort: SortOption) => void;
    totalCount: number;
    onClearFilters: () => void;
}

export const MediaProductFilter: React.FC<MediaProductFilterProps> = ({
    brands,
    selectedBrand,
    onBrandChange,
    sortBy,
    onSortChange,
    totalCount,
    onClearFilters
}) => {
    const { t } = useTranslation();

    const hasActiveFilters = selectedBrand !== 'all' || sortBy !== 'relevance';

    const brandOptions = [
        { value: 'all', label: t('all_brands') || '전체' },
        ...brands.map(brand => ({ value: brand, label: brand }))
    ];

    const sortOptions = [
        { value: 'relevance', label: t('sort_relevance') || '관련도' },
        { value: 'name_asc', label: t('sort_name_asc') || '이름 A→Z' },
        { value: 'name_desc', label: t('sort_name_desc') || '이름 Z→A' },
        { value: 'brand_asc', label: t('sort_brand_asc') || '브랜드 A→Z' },
        { value: 'brand_desc', label: t('sort_brand_desc') || '브랜드 Z→A' },
    ];

    return (
        <div className="bg-gradient-to-br from-slate-50 to-slate-100/50 dark:from-slate-800/60 dark:to-slate-800/30 rounded-2xl p-4 mb-4 border border-slate-200/50 dark:border-slate-700/50 shadow-sm">
            {/* Header */}
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                    <div className="p-1.5 bg-emerald-100 dark:bg-emerald-900/40 rounded-lg">
                        <Filter className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                    </div>
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                        {t('filter_options') || '필터'}
                    </span>
                    <span className="px-2.5 py-1 bg-emerald-500 text-white rounded-full text-xs font-semibold tracking-wide shadow-sm">
                        {totalCount}
                    </span>
                </div>
                {hasActiveFilters && (
                    <button
                        onClick={onClearFilters}
                        className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 bg-white dark:bg-slate-700 hover:bg-slate-100 dark:hover:bg-slate-600 rounded-full transition-all shadow-sm border border-slate-200 dark:border-slate-600"
                    >
                        <X className="w-3 h-3" />
                        {t('clear_filters') || '초기화'}
                    </button>
                )}
            </div>

            {/* Filters Row */}
            <div className="flex flex-col sm:flex-row gap-3">
                {/* Brand Filter */}
                <div className="flex-1">
                    <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5 tracking-wide uppercase">
                        {t('brand') || '브랜드'}
                    </label>
                    <CustomDropdown
                        value={selectedBrand}
                        options={brandOptions}
                        onChange={onBrandChange}
                    />
                </div>

                {/* Sort Option */}
                <div className="flex-1">
                    <label className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5 tracking-wide uppercase">
                        <ArrowUpDown className="w-3 h-3" />
                        {t('sort_by') || '정렬'}
                    </label>
                    <CustomDropdown
                        value={sortBy}
                        options={sortOptions}
                        onChange={(val) => onSortChange(val as SortOption)}
                    />
                </div>
            </div>
        </div>
    );
};

export default MediaProductFilter;
