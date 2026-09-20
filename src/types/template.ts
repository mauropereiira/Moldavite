export interface Template {
  id: string;
  name: string;
  description: string;
  icon: string;
  isDefault: boolean;
  content: string;
}

export interface SaveTemplateInput {
  name: string;
  description: string;
  icon: string;
  content: string;
}
