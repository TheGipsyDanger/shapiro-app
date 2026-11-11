export type SubjectCategory = 'STEM' | 'Bio' | 'Humanities' | 'Arts' | 'Cram';

export interface Subject {
  id: string;
  name: string;
  color: string;
  category: SubjectCategory;
  createdAt: number;
}

export interface SubjectWithStats extends Subject {
  blockCount: number;
  photoCount: number;
  totalMinutes: number;
}

export interface StudyBlock {
  id: string;
  subjectId: string;
  title: string;
  startTime: number;
  endTime: number;
  createdAt: number;
}

export interface StudyBlockWithSubject extends StudyBlock {
  subjectName: string;
  subjectColor: string;
  subjectCategory: SubjectCategory;
  photoCount: number;
}

export interface VaultPhoto {
  id: string;
  studyBlockId: string;
  filePath: string;
  capturedAt: number;
  fileSizeBytes: number;
}

export const SUBJECT_CATEGORIES: {
  key: SubjectCategory;
  label: string;
  defaultColor: string;
}[] = [
  { key: 'STEM', label: 'STEM', defaultColor: '#3B82F6' },
  { key: 'Bio', label: 'Bio / Pre-Med', defaultColor: '#10B981' },
  { key: 'Humanities', label: 'Humanities', defaultColor: '#F59E0B' },
  { key: 'Arts', label: 'Arts', defaultColor: '#A855F7' },
  { key: 'Cram', label: 'Cram', defaultColor: '#F43F5E' },
];

export const SUBJECT_PALETTE = [
  '#3B82F6', // STEM Blue
  '#10B981', // Pre-Med Emerald
  '#F59E0B', // Humanities Amber
  '#A855F7', // Arts Purple
  '#F43F5E', // Cram Rose
  '#06B6D4', // Cyan
  '#EC4899', // Pink
  '#84CC16', // Lime
] as const;

