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
    lab?: Lab;
}

interface LabState {
    currentLabId: string | null;
    /** Most recently selected lab, so switching back from personal space returns to it. */
    lastLabId: string | null;
    myLabs: LabMember[];
    setCurrentLabId: (labId: string | null) => void;
    setMyLabs: (labs: LabMember[]) => void;
    clearLabState: () => void;
}

export const useLabStore = create<LabState>()(
    persist(
        (set) => ({
            currentLabId: null,
            lastLabId: null,
            myLabs: [],
            // Leaving a lab also records it, which covers users persisted before lastLabId existed.
            setCurrentLabId: (labId) => set((state) => ({
                currentLabId: labId,
                lastLabId: labId ?? state.currentLabId ?? state.lastLabId,
            })),
            setMyLabs: (labs) => set({ myLabs: labs }),
            clearLabState: () => set({ currentLabId: null, lastLabId: null, myLabs: [] })
        }),
        {
            name: 'lab-storage',
            partialize: (state) => ({ currentLabId: state.currentLabId, lastLabId: state.lastLabId }),
        }
    )
);
