import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface Lab {
    id: string;
    name: string;
    created_by: string;
    created_at: string;
    institution_name?: string;
    institution_type?: string;
    research_field?: string;
    join_password_needs_change?: boolean;
}

export interface LabMember {
    id: string;
    lab_id: string;
    user_id: string;
    role: 'admin' | 'pi' | 'postdoc' | 'graduate' | 'undergrad' | 'researcher' | 'student';
    joined_at: string;
    nickname?: string | null;
    lab?: Lab;
}

interface LabState {
    currentLabId: string | null;
    /** Most recently selected lab, so switching back from personal space returns to it. */
    lastLabId: string | null;
    myLabs: LabMember[];
    /** True once this session has asked the server for the user's memberships (success or failure). */
    labsLoaded: boolean;
    setCurrentLabId: (labId: string | null) => void;
    setMyLabs: (labs: LabMember[]) => void;
    markLabsLoaded: () => void;
    clearLabState: () => void;
}

export const useLabStore = create<LabState>()(
    persist(
        (set) => ({
            currentLabId: null,
            lastLabId: null,
            myLabs: [],
            labsLoaded: false,
            // Leaving a lab also records it, which covers users persisted before lastLabId existed.
            setCurrentLabId: (labId) => set((state) => ({
                currentLabId: labId,
                lastLabId: labId ?? state.currentLabId ?? state.lastLabId,
            })),
            setMyLabs: (labs) => set({ myLabs: labs, labsLoaded: true }),
            markLabsLoaded: () => set({ labsLoaded: true }),
            clearLabState: () => set({ currentLabId: null, lastLabId: null, myLabs: [], labsLoaded: false })
        }),
        {
            name: 'lab-storage',
            // Memberships (with roles) are persisted so the first render already knows the lab name
            // and whether the admin tab exists; the server copy replaces them once loaded.
            partialize: (state) => ({ currentLabId: state.currentLabId, lastLabId: state.lastLabId, myLabs: state.myLabs }),
        }
    )
);
