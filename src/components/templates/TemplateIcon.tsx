import React from 'react';
import {
  FileText,
  Users,
  Calendar,
  Folder,
  File,
  ListTodo,
  Lightbulb,
  BookOpen,
  Target,
  Star,
} from 'lucide-react';

interface TemplateIconProps {
  icon: string;
  size?: number;
  className?: string;
}

const iconMap: Record<string, React.ElementType> = {
  blank: FileText,
  users: Users,
  calendar: Calendar,
  folder: Folder,
  file: File,
  'list-todo': ListTodo,
  lightbulb: Lightbulb,
  'book-open': BookOpen,
  target: Target,
  star: Star,
};

export function TemplateIcon({ icon, size = 24, className = '' }: TemplateIconProps) {
  const IconComponent = iconMap[icon] || FileText;

  return <IconComponent size={size} className={className} />;
}

// Export available icons for dropdowns
export const availableIcons = [
  { value: 'blank', label: 'Document' },
  { value: 'users', label: 'Meeting' },
  { value: 'calendar', label: 'Calendar' },
  { value: 'folder', label: 'Project' },
  { value: 'file', label: 'File' },
  { value: 'list-todo', label: 'Tasks' },
  { value: 'lightbulb', label: 'Ideas' },
  { value: 'book-open', label: 'Journal' },
  { value: 'target', label: 'Goals' },
  { value: 'star', label: 'Important' },
];
