import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Template } from '@/types/template';

interface TemplateStore {
  // State
  templates: Template[];
  defaultDailyTemplate: string | null; // template ID
  isLoading: boolean;

  // Actions
  setTemplates: (templates: Template[]) => void;
  addTemplate: (template: Template) => void;
  updateTemplateInStore: (id: string, template: Template) => void;
  removeTemplate: (id: string) => void;
  setDefaultDailyTemplate: (templateId: string | null) => void;
  setIsLoading: (loading: boolean) => void;
}

export const useTemplateStore = create<TemplateStore>()(
  persist(
    (set) => ({
      templates: [],
      defaultDailyTemplate: null,
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
        })),

      setDefaultDailyTemplate: (templateId) =>
        set({ defaultDailyTemplate: templateId }),

      setIsLoading: (loading) => set({ isLoading: loading }),
    }),
    {
      name: 'template-storage',
      partialize: (state) => ({
        defaultDailyTemplate: state.defaultDailyTemplate,
      }),
    }
  )
);
