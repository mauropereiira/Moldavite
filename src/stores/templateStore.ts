/**
 * Template list/loading state and persisted default-daily-template selection.
 * Backend template records are authoritative; the persisted default is an id reference
 * and may be `null` when no automatic template is configured.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import {
  forgeNamespacedStorageWithLegacyFallback,
  onActiveForgeChange,
  readNamespacedWithLegacyFallback,
} from '@/lib/forgeStorage';
import type { Template } from '@/types/template';

const TEMPLATE_STORAGE_KEY = 'template-storage';

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

      addTemplate: (template) => set((state) => ({ templates: [...state.templates, template] })),

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

      setDefaultDailyTemplate: (templateId) => set({ defaultDailyTemplate: templateId }),

      setPinnedTemplateIds: (ids) => set({ pinnedTemplateIds: ids }),

      togglePinnedTemplate: (id) =>
        set((state) => ({
          pinnedTemplateIds: state.pinnedTemplateIds.includes(id)
            ? state.pinnedTemplateIds.filter((pid) => pid !== id)
            : [...state.pinnedTemplateIds, id],
        })),

      setIsLoading: (loading) => set({ isLoading: loading }),
    }),
    {
      // The key is namespaced by `forgeNamespacedStorageWithLegacyFallback` on
      // every access, not baked in here: this module is imported before the
      // active Forge is known.
      name: TEMPLATE_STORAGE_KEY,
      storage: createJSONStorage(() => forgeNamespacedStorageWithLegacyFallback),
      version: 0, // Hook for future migrations; no shape changes yet.
      partialize: (state) => ({
        defaultDailyTemplate: state.defaultDailyTemplate,
        pinnedTemplateIds: state.pinnedTemplateIds,
      }),
    }
  )
);

// Hydration ran at import time, when the cache could still name the Forge we
// just switched away from. Re-read under the corrected key as soon as the
// real active Forge is known — and reset to defaults when that Forge (and its
// legacy flat key) has no slice yet, because the default template and pins
// are per-Forge references and must never leak from one Forge to another.
onActiveForgeChange(() => {
  if (readNamespacedWithLegacyFallback(TEMPLATE_STORAGE_KEY) === null) {
    useTemplateStore.setState({ defaultDailyTemplate: null, pinnedTemplateIds: [] });
    return;
  }
  void useTemplateStore.persist.rehydrate();
});
