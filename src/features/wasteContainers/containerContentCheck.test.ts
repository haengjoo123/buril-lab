import { describe, expect, it } from 'vitest';
import type { WasteHazardFlag } from '../../types';
import { checkContainerContents, type IncomingWaste } from './containerContentCheck';

const incoming = (
    name: string,
    hazardFlags: WasteHazardFlag[],
    options: { isAcid?: boolean; isAqueous?: boolean } = {},
): IncomingWaste => ({
    components: [{ name, hazardFlags, isAcid: options.isAcid ?? false }],
    isAqueous: options.isAqueous ?? false,
});
const recorded = (chemicalName: string, hazardFlags: WasteHazardFlag[]) => ({ chemicalName, hazardFlags });
const rules = (waste: IncomingWaste, contents: ReturnType<typeof recorded>[]) =>
    checkContainerContents(waste, contents).map((warning) => `${warning.severity}:${warning.ruleId}`);

describe('checkContainerContents', () => {
    it('reports nothing for an empty container or unrelated hazards', () => {
        expect(checkContainerContents(incoming('Acetone', ['FLAMMABLE']), [])).toEqual([]);
        expect(rules(incoming('Acetone', ['FLAMMABLE']), [recorded('Ethanol', ['FLAMMABLE'])])).toEqual([]);
        expect(rules(
            incoming('Lead nitrate', ['HEAVY_METAL', 'ACUTE_TOXIC']),
            [recorded('Cadmium chloride', ['HEAVY_METAL', 'CMR'])],
        )).toEqual([]);
    });

    it('flags an oxidizer meeting a flammable in either direction', () => {
        expect(rules(incoming('Hydrogen peroxide', ['OXIDIZER']), [recorded('Acetone', ['FLAMMABLE'])]))
            .toEqual(['DANGER:oxidizer_flammable']);
        expect(checkContainerContents(incoming('Acetone', ['FLAMMABLE']), [recorded('Hydrogen peroxide', ['OXIDIZER'])]))
            .toEqual([{ severity: 'DANGER', ruleId: 'oxidizer_flammable', incoming: 'Acetone', inContainer: 'Hydrogen peroxide' }]);
    });

    it('treats pyrophoric, self-reactive and explosive contents as dangerous with any other substance', () => {
        expect(rules(incoming('Water', []), [recorded('tert-Butyllithium', ['PYROPHORIC'])])).toEqual(['DANGER:pyrophoric']);
        expect(rules(incoming('Benzoyl peroxide', ['SELF_REACTIVE']), [recorded('Toluene', [])])).toEqual(['DANGER:self_reactive']);
        expect(rules(incoming('Picric acid', ['EXPLOSIVE']), [recorded('Toluene', [])])).toEqual(['DANGER:explosive']);
    });

    it('does not pair a substance with itself', () => {
        expect(rules(
            incoming(' benzoyl peroxide ', ['SELF_REACTIVE', 'OXIDIZER']),
            [recorded('Benzoyl peroxide', ['SELF_REACTIVE', 'OXIDIZER'])],
        )).toEqual([]);
    });

    it('flags water reaching a recorded water-reactive substance, and asks to check when the direction is unknown', () => {
        const sodium = recorded('Sodium', ['WATER_REACTIVE']);
        expect(rules(incoming('Buffer', [], { isAqueous: true }), [sodium])).toEqual(['DANGER:water_reactive_aqueous']);
        expect(rules(incoming('Hexane', []), [sodium])).toEqual([]);
        expect(rules(incoming('Sodium', ['WATER_REACTIVE']), [recorded('Hexane', [])]))
            .toEqual(['WARNING:water_reactive_unknown_matrix']);
    });

    it('flags an identified acid meeting recorded cyanide or sulfide', () => {
        const acid = incoming('Hydrochloric acid', ['CORROSIVE'], { isAcid: true });
        expect(rules(acid, [recorded('Sodium cyanide', ['CYANIDE', 'ACUTE_TOXIC'])])).toEqual(['DANGER:acid_cyanide']);
        expect(rules(acid, [recorded('Sodium sulfide', ['SULFIDE'])])).toEqual(['DANGER:acid_sulfide']);
        expect(rules(incoming('Sodium hydroxide', ['CORROSIVE']), [recorded('Sodium cyanide', ['CYANIDE'])])).toEqual([]);
    });

    it('only warns when cyanide or sulfide meets a recorded corrosive of unknown acidity', () => {
        expect(rules(incoming('Sodium cyanide', ['CYANIDE']), [recorded('Unknown corrosive', ['CORROSIVE'])]))
            .toEqual(['WARNING:corrosive_cyanide_sulfide']);
    });

    it('lists dangers first and reports each pair once per rule', () => {
        const nitric = { name: 'Nitric acid', hazardFlags: ['OXIDIZER', 'CORROSIVE'] as WasteHazardFlag[], isAcid: true };
        const waste: IncomingWaste = {
            components: [{ name: 'Sodium cyanide', hazardFlags: ['CYANIDE'], isAcid: false }, nitric, nitric],
            isAqueous: true,
        };
        expect(rules(waste, [recorded('Ethanol', ['FLAMMABLE']), recorded('Sulfuric acid', ['CORROSIVE'])]))
            .toEqual(['DANGER:oxidizer_flammable', 'WARNING:corrosive_cyanide_sulfide']);
    });
});
