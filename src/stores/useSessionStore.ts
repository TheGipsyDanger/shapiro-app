import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { getActiveStudyBlockFromDb } from '@/db/database';
import type { StudyBlockWithSubject } from '@/types/domain';

export const ONBOARDED_STORAGE_KEY = 'has_onboarded';

interface ActiveSubjectSummary {
  id: string;
  name: string;
  color: string;
}

interface SessionState {
  currentBlockId: string | null;
  activeBlock: StudyBlockWithSubject | null;
  activeSubject: ActiveSubjectSummary | null;
  remainingSeconds: number;
  isJitOpen: boolean;
  scheduleVersion: number;
  hasOnboarded: boolean | null;

  refreshActiveSession: () => Promise<StudyBlockWithSubject | null>;
  openJitSheet: () => void;
  closeJitSheet: () => void;
  setTick: (remaining: number) => void;
  bumpScheduleVersion: () => void;
  loadOnboardingState: () => Promise<boolean>;
  completeOnboarding: () => Promise<void>;
  resetOnboarding: () => Promise<void>;
}

export const useSessionStore = create<SessionState>((set) => ({
  currentBlockId: null,
  activeBlock: null,
  activeSubject: null,
  remainingSeconds: 0,
  isJitOpen: false,
  scheduleVersion: 0,
  hasOnboarded: null,

  refreshActiveSession: async () => {
    const now = Date.now();
    const block = getActiveStudyBlockFromDb(now);

    if (!block) {
      set({
        currentBlockId: null,
        activeBlock: null,
        activeSubject: null,
        remainingSeconds: 0,
        isJitOpen: true,
      });
      return null;
    }

    const remainingSeconds = Math.max(0, Math.ceil((block.endTime - now) / 1000));
    set({
      currentBlockId: block.id,
      activeBlock: block,
      activeSubject: {
        id: block.subjectId,
        name: block.subjectName,
        color: block.subjectColor,
      },
      remainingSeconds,
      isJitOpen: false,
    });
    return block;
  },

  openJitSheet: () => set({ isJitOpen: true }),
  closeJitSheet: () => set({ isJitOpen: false }),
  setTick: (remainingSeconds) => set({ remainingSeconds }),
  bumpScheduleVersion: () => set((state) => ({ scheduleVersion: state.scheduleVersion + 1 })),

  loadOnboardingState: async () => {
    const value = await AsyncStorage.getItem(ONBOARDED_STORAGE_KEY);
    const onboarded = value === 'true';
    set({ hasOnboarded: onboarded });
    return onboarded;
  },

  completeOnboarding: async () => {
    await AsyncStorage.setItem(ONBOARDED_STORAGE_KEY, 'true');
    set({ hasOnboarded: true });
  },

  resetOnboarding: async () => {
    await AsyncStorage.removeItem(ONBOARDED_STORAGE_KEY);
    set({ hasOnboarded: false });
  },
}));
