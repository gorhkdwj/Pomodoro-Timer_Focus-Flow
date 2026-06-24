import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { format, differenceInDays } from 'date-fns';

// Recompute the streak from the full log set (used after a cloud merge,
// where logs from multiple devices are combined out of order).
const recomputeStreak = (logs) => {
  const days = [...new Set(logs.map((l) => format(new Date(l.date), 'yyyy-MM-dd')))].sort();
  if (days.length === 0) return { currentStreak: 0, lastActiveDate: null };
  const last = days[days.length - 1];
  let streak = 1;
  let cursor = new Date(last);
  for (let i = days.length - 2; i >= 0; i--) {
    const prev = new Date(days[i]);
    const diff = differenceInDays(cursor, prev);
    if (diff === 1) { streak++; cursor = prev; }
    else if (diff === 0) continue;
    else break;
  }
  return { currentStreak: streak, lastActiveDate: last };
};

export const useLogStore = create(
  persist(
    (set, get) => ({
      logs: [],
      currentStreak: 0,
      lastActiveDate: null,

      addLog: (log) => set((state) => {
        // log expected to have: { date, type ('focus'|'break'), duration (seconds) }
        const todayStr = format(new Date(), 'yyyy-MM-dd');
        let newStreak = state.currentStreak;
        
        if (state.lastActiveDate !== todayStr) {
           if (!state.lastActiveDate) {
              newStreak = 1;
           } else {
              const diff = differenceInDays(new Date(), new Date(state.lastActiveDate));
              if (diff === 1) {
                newStreak += 1;
              } else if (diff > 1) {
                newStreak = 1; // streak broken
              }
           }
        }

        return {
          logs: [...state.logs, { ...log, id: Date.now() }],
          currentStreak: newStreak,
          lastActiveDate: todayStr
        };
      }),
      // Replace the entire log set (after a cloud merge) and recompute streak.
      setLogs: (logs) => set(() => ({ logs, ...recomputeStreak(logs) })),
      clearLogs: () => set({ logs: [], currentStreak: 0, lastActiveDate: null })
    }),
    {
      name: 'pomodoro-logs',
    }
  )
);
