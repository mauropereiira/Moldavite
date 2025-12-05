import { useEffect, useState } from 'react';
import { useTemplateStore } from '@/stores/templateStore';
import * as templatesApi from '@/lib/templates';
import type { SaveTemplateInput } from '@/types/template';

/**
 * Manages template operations including loading, creating, updating, and deleting templates.
 * Provides access to template list and default daily template configuration.
 * @returns Template management functions and state
 */
export function useTemplates() {
  const {
    templates,
    defaultDailyTemplate,
    isLoading,
    setTemplates,
    addTemplate,
    updateTemplateInStore,
    removeTemplate,
    setDefaultDailyTemplate,
    setIsLoading,
  } = useTemplateStore();

  const [loadError, setLoadError] = useState<string | null>(null);

  // Load templates on mount
  useEffect(() => {
    loadTemplates();
  }, []);

  /**
   * Loads all templates from the backend.
   * Called automatically on mount.
   */
  const loadTemplates = async () => {
    try {
      setIsLoading(true);
      setLoadError(null);
      const data = await templatesApi.listTemplates();
      setTemplates(data);
    } catch (error) {
      console.error('Failed to load templates:', error);
      setLoadError(error instanceof Error ? error.message : 'Failed to load templates');
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Creates a new template.
   * @param input - Template name and content
   * @returns The created template
   * @throws {Error} If template creation fails
   */
  const saveNewTemplate = async (input: SaveTemplateInput) => {
    try {
      const template = await templatesApi.saveTemplate(input);
      addTemplate(template);
      return template;
    } catch (error) {
      console.error('Failed to save template:', error);
      throw error;
    }
  };

  /**
   * Updates an existing template.
   * @param id - Template ID to update
   * @param input - Updated template name and content
   * @returns The updated template
   * @throws {Error} If template update fails
   */
  const updateExistingTemplate = async (id: string, input: SaveTemplateInput) => {
    try {
      const template = await templatesApi.updateTemplate(id, input);
      updateTemplateInStore(id, template);
      return template;
    } catch (error) {
      console.error('Failed to update template:', error);
      throw error;
    }
  };

  /**
   * Deletes a template.
   * @param id - Template ID to delete
   * @throws {Error} If template deletion fails
   */
  const deleteExistingTemplate = async (id: string) => {
    try {
      await templatesApi.deleteTemplate(id);
      removeTemplate(id);
    } catch (error) {
      console.error('Failed to delete template:', error);
      throw error;
    }
  };

  /**
   * Gets the processed content of a template with variables applied.
   * @param id - Template ID
   * @returns The processed template content
   * @throws {Error} If template retrieval fails
   */
  const getTemplateContent = async (id: string) => {
    try {
      return await templatesApi.applyTemplate(id);
    } catch (error) {
      console.error('Failed to get template content:', error);
      throw error;
    }
  };

  return {
    templates,
    defaultDailyTemplate,
    isLoading,
    loadError,
    loadTemplates,
    saveNewTemplate,
    updateExistingTemplate,
    deleteExistingTemplate,
    getTemplateContent,
    setDefaultDailyTemplate,
  };
}
