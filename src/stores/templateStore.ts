import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Template } from '@/types/template';

interface TemplateStore {
  // State
  templates: Template[];
  defaultDailyTemplate: string | null; // template ID
  pinnedTemplateIds: string[]; // templates to show in "Start with template" picker
  isLoading: boolean;

  // Actions
  setTemplates: (templates: Template[]) => void;
  addTemplate: (template: Template) => void;
  updateTemplateInStore: (id: string, template: Template) => void;
  removeTemplate: (id: string) => void;
  setDefaultDailyTemplate: (templateId: string | null) => void;
  setPinnedTemplateIds: (ids: string[]) => void;
  togglePinnedTemplate: (id: string) => void;
  setIsLoading: (loading: boolean) => void;
}

export const useTemplateStore = create<TemplateStore>()(
  persist(
    (set) => ({
      templates: [],
      defaultDailyTemplate: null,
      pinnedTemplateIds: [],
      isLoading: false,

      setTemplates: (templates) => set({ templates }),

      addTemplate: (template) =>
        set((state) => ({ templates: [...state.templates, template] })),

      updateTemplateInStore: (id, template) =>
        set((state) => ({
          templates: state.templates.map((t) => (t.id === id ? template : t)),
        })),

      removeTemplate: (id) =>
        set((state) => ({
          templates: state.templates.filter((t) => t.id !== id),
          // Also remove from pinned if present
          pinnedTemplateIds: state.pinnedTemplateIds.filter((pid) => pid !== id),
        })),

      setDefaultDailyTemplate: (templateId) =>
        set({ defaultDailyTemplate: templateId }),

      setPinnedTemplateIds: (ids) =>
        set({ pinnedTemplateIds: ids }),

      togglePinnedTemplate: (id) =>
        set((state) => ({
          pinnedTemplateIds: state.pinnedTemplateIds.includes(id)
            ? state.pinnedTemplateIds.filter((pid) => pid !== id)
            : [...state.pinnedTemplateIds, id],
        })),

      setIsLoading: (loading) => set({ isLoading: loading }),
    }),
    {
      name: 'template-storage',
      partialize: (state) => ({
        defaultDailyTemplate: state.defaultDailyTemplate,
        pinnedTemplateIds: state.pinnedTemplateIds,
      }),
    }
  )
);
