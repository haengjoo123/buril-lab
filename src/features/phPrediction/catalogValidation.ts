import type { PhCatalog } from './catalogTypes';

const CAS_PATTERN = /^(\d{2,7})-(\d{2})-(\d)$/;
const INCHI_KEY_PATTERN = /^[A-Z]{14}-[A-Z]{10}-[A-Z]$/;

const hasValidCasChecksum = (cas: string): boolean => {
    const match = CAS_PATTERN.exec(cas);
    if (!match) return false;
    const digits = `${match[1]}${match[2]}`.split('').reverse().map(Number);
    const checksum = digits.reduce((sum, digit, index) => sum + digit * (index + 1), 0) % 10;
    return checksum === Number(match[3]);
};

/** Static integrity validation; scientific golden-set approval is a separate release gate. */
export const validatePhCatalog = (catalog: PhCatalog): string[] => {
    const errors: string[] = [];
    const sourceIds = new Set(catalog.sourceIds);
    if (!catalog.version.trim()) errors.push('catalog.version');
    if (catalog.temperatureC !== 25) errors.push('catalog.temperature');
    if (sourceIds.size !== catalog.sourceIds.length) errors.push('catalog.source_duplicate');

    const familyIds = new Set<string>();
    const familiesById = new Map(catalog.families.map((family) => [family.id, family]));
    for (const family of catalog.families) {
        if (!family.id || familyIds.has(family.id)) errors.push(`family.${family.id || 'empty'}.id`);
        familyIds.add(family.id);
        if (!Number.isInteger(family.fullyProtonatedCharge)) errors.push(`family.${family.id}.charge`);
        if (family.pKas.length === 0 || family.pKaMetadata.length !== family.pKas.length) {
            errors.push(`family.${family.id}.ladder`);
            continue;
        }
        family.pKas.forEach((pKa, index) => {
            const metadata = family.pKaMetadata[index];
            if (!Number.isFinite(pKa) || pKa < -20 || pKa > 30
                || (index > 0 && pKa <= family.pKas[index - 1]!)) {
                errors.push(`family.${family.id}.pka.${index}`);
            }
            if (!metadata || metadata.temperatureC !== 25 || metadata.solvent !== 'water'
                || metadata.sourceRefs.length === 0
                || metadata.sourceRefs.some((sourceRef) => !sourceIds.has(sourceRef))) {
                errors.push(`family.${family.id}.metadata.${index}`);
                return;
            }
            if (metadata.pKaType === 'thermodynamic') {
                if (metadata.ionicStrengthMolal !== 0
                    || metadata.standardState !== 'infinite_dilution_molality'
                    || metadata.approvalStatus !== 'approved') {
                    errors.push(`family.${family.id}.thermodynamic.${index}`);
                }
            } else if (metadata.standardState !== 'reported_condition'
                || metadata.approvalStatus !== 'provisional') {
                errors.push(`family.${family.id}.conditional.${index}`);
            }
            if (metadata.uncertaintyPka !== null
                && (!Number.isFinite(metadata.uncertaintyPka) || metadata.uncertaintyPka < 0)) {
                errors.push(`family.${family.id}.uncertainty.${index}`);
            }
        });
        if (family.sourceRefs.length === 0
            || family.sourceRefs.some((sourceRef) => !sourceIds.has(sourceRef))) {
            errors.push(`family.${family.id}.source`);
        }
    }

    const recordIds = new Set<string>();
    const casNumbers = new Set<string>();
    const inchiKeys = new Set<string>();
    for (const record of catalog.records) {
        if (!record.id || recordIds.has(record.id)) errors.push(`record.${record.id || 'empty'}.id`);
        recordIds.add(record.id);
        if (!record.names.length || !record.exactFormLabel.trim() || !record.formula.trim()
            || !Number.isFinite(record.molecularWeight) || record.molecularWeight <= 0
            || record.reviewed !== true) {
            errors.push(`record.${record.id}.identity`);
        }
        if (record.casNumber) {
            if (!hasValidCasChecksum(record.casNumber) || casNumbers.has(record.casNumber)) {
                errors.push(`record.${record.id}.cas`);
            }
            casNumbers.add(record.casNumber);
        }
        if (!record.structureIdentity) {
            errors.push(`record.${record.id}.structure`);
        } else if (record.structureIdentity.kind === 'pubchem') {
            if (!Number.isInteger(record.structureIdentity.pubchemCid)
                || record.structureIdentity.pubchemCid <= 0
                || !INCHI_KEY_PATTERN.test(record.structureIdentity.standardInchiKey)
                || inchiKeys.has(record.structureIdentity.standardInchiKey)
                || !sourceIds.has(record.structureIdentity.sourceRef)) {
                errors.push(`record.${record.id}.structure`);
            }
            inchiKeys.add(record.structureIdentity.standardInchiKey);
        } else if (record.structureIdentity.selectable !== false
            || !record.structureIdentity.modelId.trim()
            || !record.flags?.includes('gas_sensitive')) {
            errors.push(`record.${record.id}.pseudo_species`);
        }
        if (record.sourceRefs.length === 0
            || record.sourceRefs.some((sourceRef) => !sourceIds.has(sourceRef))) {
            errors.push(`record.${record.id}.source`);
        }
        if (record.contributions.some((contribution) =>
            !familyIds.has(contribution.familyId)
            || !Number.isInteger(contribution.stoichiometry)
            || contribution.stoichiometry <= 0)) {
            errors.push(`record.${record.id}.family`);
        }
        if (record.fixedIons.some((ion) =>
            !Number.isInteger(ion.charge) || ion.charge === 0
            || !Number.isInteger(ion.stoichiometry) || ion.stoichiometry <= 0)) {
            errors.push(`record.${record.id}.fixed_ion`);
        }
        if (record.implicitWaterIonCharge !== undefined
            && record.implicitWaterIonCharge !== -1 && record.implicitWaterIonCharge !== 1) {
            errors.push(`record.${record.id}.implicit_water_ion`);
        }

        let possibleCharges = new Set([
            record.fixedIons.reduce((sum, ion) => sum + ion.charge * ion.stoichiometry, 0)
            + (record.implicitWaterIonCharge ?? 0),
        ]);
        for (const contribution of record.contributions) {
            const acidBaseFamily = familiesById.get(contribution.familyId);
            if (!acidBaseFamily || !Number.isInteger(contribution.stoichiometry)) continue;
            const familyCharges = acidBaseFamily.pKas.map((_, index) =>
                (acidBaseFamily.fullyProtonatedCharge - index) * contribution.stoichiometry);
            familyCharges.push(
                (acidBaseFamily.fullyProtonatedCharge - acidBaseFamily.pKas.length)
                * contribution.stoichiometry,
            );
            possibleCharges = new Set(
                [...possibleCharges].flatMap((baseCharge) =>
                    familyCharges.map((familyCharge) => baseCharge + familyCharge)),
            );
        }
        if (!possibleCharges.has(0)) errors.push(`record.${record.id}.charge_closure`);
    }
    return [...new Set(errors)];
};
