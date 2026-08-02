import type { LucideIcon } from 'lucide-react';
import {
    Beaker,
    Blocks,
    CircleHelp,
    FlaskConical,
    Hexagon,
    Orbit,
    ShieldAlert,
    Skull,
    Weight,
    Waves,
    Zap,
} from 'lucide-react';
import type { DisposalCategory } from '../types';

type CategorySymbol = {
    Icon: LucideIcon;
    key: string;
};

export const wasteCategorySymbols: Record<DisposalCategory, CategorySymbol> = {
    ACID: { Icon: FlaskConical, key: 'acid' },
    ALKALI: { Icon: Beaker, key: 'alkali' },
    NEUTRAL: { Icon: Waves, key: 'neutral' },
    ORGANIC_HALOGEN: { Icon: Orbit, key: 'organic-halogen' },
    ORGANIC_NON_HALOGEN: { Icon: Hexagon, key: 'organic-non-halogen' },
    HEAVY_METAL: { Icon: Weight, key: 'heavy-metal' },
    CYANIDE: { Icon: Skull, key: 'cyanide' },
    REACTIVE: { Icon: Zap, key: 'reactive' },
    SOLID_WASTE: { Icon: Blocks, key: 'solid-waste' },
    SPECIAL_HAZARD: { Icon: ShieldAlert, key: 'special-hazard' },
    UNKNOWN: { Icon: CircleHelp, key: 'unknown' },
};
