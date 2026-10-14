import { createLucideIcon } from 'lucide-react';

// Match Lucide's 24px grid and rounded outlines, with reagent bottle silhouettes.
export const AmberBottleIcon = createLucideIcon('AmberBottle', [
    ['rect', { x: '9', y: '2', width: '6', height: '4', rx: '1', key: 'cap' }],
    ['path', { d: 'M10 6v3c0 2-4 2-4 5v6a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-6c0-3-4-3-4-5V6', key: 'body' }],
    ['path', { d: 'M9 15h6v4H9z', key: 'label' }],
]);

export const PlasticContainerIcon = createLucideIcon('PlasticContainer', [
    ['rect', { x: '7', y: '2', width: '10', height: '4', rx: '1', key: 'cap' }],
    ['path', { d: 'M8 6v2l-3 3v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-9l-3-3V6', key: 'body' }],
    ['path', { d: 'M8 14h8M8 18h8', key: 'ribs' }],
]);

export const GlassBottleIcon = createLucideIcon('GlassBottle', [
    ['rect', { x: '9', y: '2', width: '6', height: '3', rx: '1', key: 'cap' }],
    ['path', { d: 'M10 5v4c0 2-4 3-4 6v5a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-5c0-3-4-4-4-6V5', key: 'body' }],
    ['path', { d: 'M9 15v4M6 17h12', key: 'glass' }],
]);

export const SquareBottleIcon = createLucideIcon('SquareBottle', [
    ['rect', { x: '9', y: '2', width: '6', height: '4', rx: '1', key: 'cap' }],
    ['path', { d: 'M9 6v2l-4 3v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-9l-4-3V6', key: 'body' }],
    ['path', { d: 'M15 12v10M8 13h4v5H8z', key: 'edge-label' }],
]);
