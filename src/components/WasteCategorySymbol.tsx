import type { DisposalCategory } from '../types';
import { wasteCategorySymbols } from './wasteCategorySymbolConfig';

interface WasteCategorySymbolProps {
    category: DisposalCategory;
}

/**
 * A material-category cue, not a disposal-container or safety-status indicator.
 * Container colors are intentionally reserved for institution policy matches.
 */
export const WasteCategorySymbol = ({ category }: WasteCategorySymbolProps) => {
    const { Icon, key } = wasteCategorySymbols[category];

    return (
        <div
            aria-hidden="true"
            data-waste-category-symbol={key}
            className="flex h-16 w-16 items-center justify-center rounded-2xl border border-slate-200 bg-slate-100 text-slate-700 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
        >
            <Icon className="h-8 w-8" strokeWidth={1.8} />
        </div>
    );
};
