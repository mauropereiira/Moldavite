import { describe, expect, it } from 'vitest';
import passwordModal from './PasswordModal.tsx?raw';
import sidebarModals from '../sidebar/SidebarModals.tsx?raw';
import moveToFolderModal from '../sidebar/MoveToFolderModal.tsx?raw';
import bulkExportModal from '../sidebar/BulkExportModal.tsx?raw';
import trashPreviewModal from '../sidebar/TrashPreviewModal.tsx?raw';
import manageForgesModal from '../sidebar/ManageForgesModal.tsx?raw';
import pdfExportOptionsModal from '../editor/PdfExportOptionsModal.tsx?raw';
import tagsSection from '../sidebar/TagsSection.tsx?raw';
import settingsData from '../settings/SettingsData.tsx?raw';
import generalSection from '../settings/sections/GeneralSection.tsx?raw';
import quickSwitcher from '../quick-switcher/QuickSwitcher.tsx?raw';
import linkModal from '../editor/LinkModal.tsx?raw';
import imageModal from '../editor/ImageModal.tsx?raw';

const dialogFiles: Array<[string, string, number]> = [
  ['PasswordModal', passwordModal, 1],
  ['SidebarModals', sidebarModals, 5],
  ['MoveToFolderModal', moveToFolderModal, 1],
  ['BulkExportModal', bulkExportModal, 1],
  ['TrashPreviewModal', trashPreviewModal, 1],
  ['ManageForgesModal', manageForgesModal, 1],
  ['PdfExportOptionsModal', pdfExportOptionsModal, 1],
  ['TagsSection', tagsSection, 1],
  ['SettingsData', settingsData, 3],
  ['GeneralSection', generalSection, 4],
  ['QuickSwitcher', quickSwitcher, 1],
  ['LinkModal', linkModal, 1],
  ['ImageModal', imageModal, 1],
];

describe('modal accessibility contract', () => {
  it.each(dialogFiles)('%s uses the shared accessible dialog surface', (_name, source, count) => {
    const surfaces = source.match(/<DialogSurface\b[\s\S]*?>/g) ?? [];
    expect(surfaces).toHaveLength(count);
  });
});
