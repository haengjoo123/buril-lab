import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface Lab {
    id: string;
    name: string;
    created_by: string;
    created_at: string;
}

export interface LabMember {
    id: string;
    lab_id: string;
    user_id: string;
    role: 'admin' | 'researcher' | 'student';
    joined_at: string;
    lab?: Lab;
}

interface LabState {
    currentLabId: string | null;
    myLabs: LabMember[];
    setCurrentLabId: (labId: string | null) => void;
    setMyLabs: (labs: LabMember[]) => void;
    clearLabState: () => void;
}

export const useLabStore = create<LabState>()(
    persist(
        (set) => ({
            currentLabId: null,
            myLabs: [],
            setCurrentLabId: (labId) => set({ currentLabId: labId }),
            setMyLabs: (labs) => set({ myLabs: labs }),
            clearLabState: () => set({ currentLabId: null, myLabs: [] })
        }),
        {
            name: 'lab-storage',
            partialize: (state) => ({ currentLabId: state.currentLabId }),
        }
    )
);
