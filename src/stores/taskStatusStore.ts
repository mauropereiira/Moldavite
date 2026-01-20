import { create } from 'zustand';

interface TaskStatus {
  totalTasks: number;
  completedTasks: number;
}

interface TaskStatusState {
  /** Map of date string (YYYY-MM-DD) to task status */
  taskStatusByDate: Map<string, TaskStatus>;

  /** Updates task status for a specific date */
  setTaskStatus: (date: string, status: TaskStatus) => void;

  /** Removes task status for a specific date (when note is deleted/emptied) */
  removeTaskStatus: (date: string) => void;

  /** Checks if a date has incomplete tasks */
  hasIncompleteTasks: (date: string) => boolean;

  /** Clears all task status data */
  clearAll: () => void;
}

export const useTaskStatusStore = create<TaskStatusState>((set, get) => ({
  taskStatusByDate: new Map(),

  setTaskStatus: (date, status) =>
    set((state) => {
      const newMap = new Map(state.taskStatusByDate);
      if (status.totalTasks === 0) {
        // No tasks, remove entry
        newMap.delete(date);
      } else {
        newMap.set(date, status);
      }
      return { taskStatusByDate: newMap };
    }),

  removeTaskStatus: (date) =>
    set((state) => {
      const newMap = new Map(state.taskStatusByDate);
      newMap.delete(date);
      return { taskStatusByDate: newMap };
    }),

  hasIncompleteTasks: (date) => {
    const status = get().taskStatusByDate.get(date);
    if (!status) return false;
    return status.totalTasks > status.completedTasks;
  },

  clearAll: () => set({ taskStatusByDate: new Map() }),
}));
