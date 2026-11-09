import { AirVent, Package, Refrigerator, Snowflake, TestTubeDiagonal, ThermometerSun, type LucideIcon } from 'lucide-react';

interface StorageLocationIconProps {
    icon?: string | null;
    className?: string;
}

// Keep stored location values compatible while rendering crisp SVGs in the UI.
const locationIcons: Record<string, LucideIcon> = {
    '🧊': Refrigerator,
    '❄': Snowflake,
    '🌡': ThermometerSun,
    '🔬': AirVent,
    '🧪': TestTubeDiagonal,
    '📦': Package,
};

export function StorageLocationIcon({ icon, className = 'h-4 w-4 shrink-0' }: StorageLocationIconProps) {
    const Icon = locationIcons[icon?.replace(/\uFE0F/g, '') ?? ''] ?? Package;

    return <Icon className={className} strokeWidth={1.8} aria-hidden="true" />;
}
