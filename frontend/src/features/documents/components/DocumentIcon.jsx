import { FileImage, FileSpreadsheet, FileText, FileType2, Folder, Presentation, File } from 'lucide-react';
import { fileKind } from '../lib/documentsData';
import { cn } from '@/lib/utils';

const ICONS = {
  pdf: FileType2,
  doc: FileText,
  sheet: FileSpreadsheet,
  slide: Presentation,
  image: FileImage,
  text: FileText,
  other: File,
};

/**
 * One icon language for both tabs. A folder is deliberately the only element
 * that carries the teal accent, so a folder can never be mistaken for a file at
 * a glance in either list or grid view.
 */
export function DocumentIcon({ node, size = 16 }) {
  if (node.kind === 'folder') {
    return <Folder size={size} strokeWidth={1.8} className="flex-none text-accent" aria-hidden="true" />;
  }
  const Icon = ICONS[fileKind(node.mimeType)] ?? File;
  return <Icon size={size} strokeWidth={1.7} className={cn('flex-none text-ink-faint')} aria-hidden="true" />;
}
