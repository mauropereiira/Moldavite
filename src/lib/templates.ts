/**
 * Typed IPC wrappers for template CRUD, expansion, and note creation.
 * Template ids and note paths remain backend-validated; this module performs no
 * local path construction beyond forwarding the caller's addressed target.
 */

import { safeInvoke as invoke } from './ipc';
import type { Template, SaveTemplateInput } from '@/types/template';

export async function listTemplates(): Promise<Template[]> {
  return await invoke<Template[]>('list_templates');
}

/**
 * Creates a new template.
 * @param input - Template name and content
 * @returns The created template with generated ID
 */
export async function saveTemplate(input: SaveTemplateInput): Promise<Template> {
  return await invoke<Template>('save_template', { input });
}

export async function updateTemplate(id: string, input: SaveTemplateInput): Promise<Template> {
  return await invoke<Template>('update_template', { id, input });
}

export async function deleteTemplate(id: string): Promise<void> {
  await invoke('delete_template', { id });
}

/**
 * Processes a template with variable substitutions.
 * @param templateId - The template ID to apply
 * @returns The processed template content with variables replaced
 */
export async function applyTemplate(templateId: string): Promise<string> {
  return await invoke<string>('apply_template', { templateId });
}
