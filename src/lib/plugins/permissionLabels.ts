/** Plain-language host UI labels for manifest-declared plugin capabilities. */
export const PLUGIN_PERMISSION_LABELS: Record<string, string> = {
  commands: 'Add commands to the palette and slash menu',
  editor: 'Read and modify the active note',
  ui: 'Show notifications and trusted prompts',
  'notes.read': 'List notes and read unlocked Markdown content',
  'net.fetch': 'Make HTTPS requests through Moldavite',
  secrets: 'Store plugin-owned credentials in macOS Keychain',
};

export function pluginPermissionLabel(permission: string): string {
  return PLUGIN_PERMISSION_LABELS[permission] ?? permission;
}
