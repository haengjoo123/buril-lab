import type { LabMember } from '../store/useLabStore';

export interface LabFormDefaults {
    /** Nickname the user already uses in a lab (most recent membership first). */
    nickname: string;
    /** Institution of the most recently joined lab that has one. */
    institutionName: string;
    institutionType: string;
    /** Distinct institution names across the user's labs, newest first, for autocomplete. */
    institutionNames: string[];
}

const newestFirst = (labs: LabMember[]) =>
    [...labs].sort((a, b) => (b.joined_at ?? '').localeCompare(a.joined_at ?? ''));

/** Prefill values for the lab create/join forms, taken only from memberships already loaded. */
export function resolveLabFormDefaults(myLabs: LabMember[]): LabFormDefaults {
    const memberships = newestFirst(myLabs);
    const nickname = memberships.find(member => member.nickname?.trim())?.nickname?.trim() ?? '';
    const institutionLab = memberships.find(member => member.lab?.institution_name?.trim())?.lab;
    const institutionType = institutionLab?.institution_type?.trim()
        || memberships.find(member => member.lab?.institution_type?.trim())?.lab?.institution_type?.trim()
        || '';
    const institutionNames = Array.from(new Set(
        memberships
            .map(member => member.lab?.institution_name?.trim())
            .filter((name): name is string => Boolean(name)),
    ));
    return {
        nickname,
        institutionName: institutionLab?.institution_name?.trim() ?? '',
        institutionType,
        institutionNames,
    };
}
