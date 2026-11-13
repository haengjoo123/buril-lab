import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLabStore } from '../../store/useLabStore';
import { SPACE_PARAM } from './qrPayload';

/**
 * A scanned label link names the space its record belongs to. Once the
 * user's labs are known, switch to that space when the user belongs to it,
 * then drop the parameter so the target screen can look the record up.
 * A space the user does not belong to is never entered; the screen then
 * reports that the record was not found.
 */
export function useQrSpaceSwitch(enabled: boolean): void {
    const [searchParams, setSearchParams] = useSearchParams();
    const space = enabled ? searchParams.get(SPACE_PARAM) : null;
    const labsLoaded = useLabStore((state) => state.labsLoaded);
    const myLabs = useLabStore((state) => state.myLabs);
    const currentLabId = useLabStore((state) => state.currentLabId);
    const setCurrentLabId = useLabStore((state) => state.setCurrentLabId);

    useEffect(() => {
        if (!space || !labsLoaded) return;
        if (space === 'personal') {
            if (currentLabId !== null) setCurrentLabId(null);
        } else {
            const membership = myLabs.find((candidate) => candidate.lab_id.toLowerCase() === space.toLowerCase());
            if (membership && membership.lab_id !== currentLabId) setCurrentLabId(membership.lab_id);
        }
        setSearchParams((current) => {
            const next = new URLSearchParams(current);
            next.delete(SPACE_PARAM);
            return next;
        }, { replace: true });
    }, [currentLabId, labsLoaded, myLabs, setCurrentLabId, setSearchParams, space]);
}
