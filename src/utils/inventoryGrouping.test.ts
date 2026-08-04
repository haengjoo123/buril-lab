import { describe, expect, it } from 'vitest';
import {
    findInventoryIdentityConflictItemIds,
    partitionInventoryItemsByIdentity,
    resolveInventoryIdentity,
} from './inventoryGrouping';

type Item = {
    id: string;
    name: string;
    cas_number: string | null;
};

function groupIds(items: Item[]): string[][] {
    return partitionInventoryItemsByIdentity(items)
        .map((group) => group.map(({ id }) => id).sort())
        .sort((left, right) => left.join().localeCompare(right.join()));
}

describe('inventory identity grouping', () => {
    it('groups checksum-valid CAS values without using names as transitive links', () => {
        const items: Item[] = [
            { id: 'acetone-correct', name: 'Acetone', cas_number: '67-64-1' },
            { id: 'acetone-wrong', name: 'Acetone', cas_number: '71-43-2' },
            { id: 'benzene', name: 'Benzene', cas_number: '71-43-2' },
        ];

        expect(groupIds(items)).toEqual([
            ['acetone-correct'],
            ['acetone-wrong', 'benzene'],
        ]);
        expect(findInventoryIdentityConflictItemIds(items)).toEqual(new Set([
            'acetone-correct',
            'acetone-wrong',
        ]));
    });

    it('keeps CAS groups separate from name-only groups even when names match exactly', () => {
        expect(groupIds([
            { id: 'with-cas', name: 'Acetone', cas_number: '67-64-1' },
            { id: 'without-cas', name: ' acetone ', cas_number: null },
        ])).toEqual([
            ['with-cas'],
            ['without-cas'],
        ]);
    });

    it('groups CAS-less records only by their exact normalized names', () => {
        expect(groupIds([
            { id: 'a', name: 'Sodium   chloride', cas_number: null },
            { id: 'b', name: ' sodium chloride ', cas_number: null },
            { id: 'c', name: 'Sodium chloride solution', cas_number: null },
        ])).toEqual([
            ['a', 'b'],
            ['c'],
        ]);
    });

    it('isolates every record that contains an invalid CAS value', () => {
        const items: Item[] = [
            { id: 'invalid-a', name: 'Acetone', cas_number: '67-64-0' },
            { id: 'invalid-b', name: 'Acetone', cas_number: '67-64-0' },
        ];

        expect(groupIds(items)).toEqual([
            ['invalid-a'],
            ['invalid-b'],
        ]);
        expect(resolveInventoryIdentity(items[0]).kind).toBe('invalid_cas');
        expect(findInventoryIdentityConflictItemIds(items)).toEqual(new Set(['invalid-a', 'invalid-b']));
    });
});
