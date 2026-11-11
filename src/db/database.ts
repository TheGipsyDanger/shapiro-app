import * as SQLite from 'expo-sqlite';
import { generateId } from '@/utils/id';
import { deleteVaultFile } from '@/utils/vaultStorage';
import type {
  StudyBlock,
  StudyBlockWithSubject,
  Subject,
  SubjectCategory,
  SubjectWithStats,
  VaultPhoto,
} from '@/types/domain';

export class ScheduleConflictError extends Error {
  conflictingBlock: {
    id: string;
    title: string;
    startTime: number;
    endTime: number;
  };

  constructor(block: { id: string; title: string; startTime: number; endTime: number }) {
    super(`Time conflict with "${block.title}"`);
    this.name = 'ScheduleConflictError';
    this.conflictingBlock = block;
  }
}

let dbInstance: SQLite.SQLiteDatabase | null = null;
let initialized = false;

export function getDb(): SQLite.SQLiteDatabase {
  if (!dbInstance) {
    dbInstance = SQLite.openDatabaseSync('shapiro.db');
    dbInstance.execSync('PRAGMA foreign_keys = ON;');
  }
  return dbInstance;
}

export function initializeDatabase(): void {
  if (initialized) return;
  const db = getDb();

  db.execSync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS subjects (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      color TEXT NOT NULL,
      category TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS study_blocks (
      id TEXT PRIMARY KEY NOT NULL,
      subject_id TEXT NOT NULL,
      title TEXT NOT NULL,
      start_time INTEGER NOT NULL,
      end_time INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_study_blocks_time
    ON study_blocks (start_time, end_time);

    CREATE TABLE IF NOT EXISTS vault_photos (
      id TEXT PRIMARY KEY NOT NULL,
      study_block_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      captured_at INTEGER NOT NULL,
      file_size_bytes INTEGER NOT NULL,
      FOREIGN KEY (study_block_id) REFERENCES study_blocks(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_vault_photos_block
    ON vault_photos (study_block_id);
  `);

  const countRow = db.getFirstSync<{ count: number }>('SELECT COUNT(*) as count FROM subjects');
  if (!countRow || countRow.count === 0) {
    const now = Date.now();
    const defaults: { name: string; color: string; category: SubjectCategory }[] = [
      { name: 'Calculus III', color: '#3B82F6', category: 'STEM' },
      { name: 'Organic Chem', color: '#10B981', category: 'Bio' },
      { name: 'Constitutional Law', color: '#F59E0B', category: 'Humanities' },
      { name: 'Studio Design', color: '#A855F7', category: 'Arts' },
      { name: 'Finals Cram', color: '#F43F5E', category: 'Cram' },
    ];

    db.withTransactionSync(() => {
      for (let i = 0; i < defaults.length; i += 1) {
        const item = defaults[i];
        db.runSync(
          'INSERT INTO subjects (id, name, color, category, created_at) VALUES (?, ?, ?, ?, ?)',
          [generateId('subj'), item.name, item.color, item.category, now + i]
        );
      }
    });
  }

  initialized = true;
}

// --- Subjects ---

export function getSubjects(): Subject[] {
  const db = getDb();
  const rows = db.getAllSync<{
    id: string;
    name: string;
    color: string;
    category: SubjectCategory;
    created_at: number;
  }>('SELECT id, name, color, category, created_at FROM subjects ORDER BY created_at ASC');

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    color: r.color,
    category: r.category,
    createdAt: r.created_at,
  }));
}

export function getSubjectsWithStats(): SubjectWithStats[] {
  const db = getDb();
  const rows = db.getAllSync<{
    id: string;
    name: string;
    color: string;
    category: SubjectCategory;
    created_at: number;
    block_count: number;
    photo_count: number;
    total_ms: number;
  }>(`
    SELECT
      s.id,
      s.name,
      s.color,
      s.category,
      s.created_at,
      COUNT(DISTINCT sb.id) AS block_count,
      COUNT(DISTINCT vp.id) AS photo_count,
      COALESCE(SUM(CASE WHEN sb.id IS NOT NULL THEN sb.end_time - sb.start_time ELSE 0 END), 0) AS total_ms
    FROM subjects s
    LEFT JOIN study_blocks sb ON sb.subject_id = s.id
    LEFT JOIN vault_photos vp ON vp.study_block_id = sb.id
    GROUP BY s.id
    ORDER BY s.created_at ASC
  `);

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    color: r.color,
    category: r.category,
    createdAt: r.created_at,
    blockCount: r.block_count ?? 0,
    photoCount: r.photo_count ?? 0,
    totalMinutes: Math.round((r.total_ms ?? 0) / 60_000),
  }));
}

export function createSubject(input: {
  name: string;
  color: string;
  category: SubjectCategory;
}): Subject {
  const db = getDb();
  const subject: Subject = {
    id: generateId('subj'),
    name: input.name.trim(),
    color: input.color,
    category: input.category,
    createdAt: Date.now(),
  };

  db.runSync(
    'INSERT INTO subjects (id, name, color, category, created_at) VALUES (?, ?, ?, ?, ?)',
    [subject.id, subject.name, subject.color, subject.category, subject.createdAt]
  );

  return subject;
}

export function updateSubject(
  id: string,
  input: { name: string; color: string; category: SubjectCategory }
): void {
  const db = getDb();
  db.runSync('UPDATE subjects SET name = ?, color = ?, category = ? WHERE id = ?', [
    input.name.trim(),
    input.color,
    input.category,
    id,
  ]);
}

export function deleteSubject(id: string): void {
  const db = getDb();
  const photoRows = db.getAllSync<{ file_path: string }>(
    `SELECT vp.file_path
     FROM vault_photos vp
     INNER JOIN study_blocks sb ON sb.id = vp.study_block_id
     WHERE sb.subject_id = ?`,
    [id]
  );

  db.runSync('DELETE FROM subjects WHERE id = ?', [id]);

  for (const row of photoRows) {
    deleteVaultFile(row.file_path);
  }
}

// --- Study Blocks & Conflict Engine ---

export function findSqlConflict(
  startTime: number,
  endTime: number,
  ignoreId?: string | null
): { id: string; title: string; startTime: number; endTime: number } | null {
  const db = getDb();
  const row = db.getFirstSync<{
    id: string;
    title: string;
    start_time: number;
    end_time: number;
  }>(
    `SELECT id, title, start_time, end_time
     FROM study_blocks
     WHERE (? < end_time) AND (? > start_time)
       AND (? IS NULL OR id != ?)
     LIMIT 1`,
    [startTime, endTime, ignoreId ?? null, ignoreId ?? null]
  );

  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    startTime: row.start_time,
    endTime: row.end_time,
  };
}

function mapStudyBlockRow(r: {
  id: string;
  subject_id: string;
  title: string;
  start_time: number;
  end_time: number;
  created_at: number;
  subject_name: string;
  subject_color: string;
  subject_category: SubjectCategory;
  photo_count: number;
}): StudyBlockWithSubject {
  return {
    id: r.id,
    subjectId: r.subject_id,
    title: r.title,
    startTime: r.start_time,
    endTime: r.end_time,
    createdAt: r.created_at,
    subjectName: r.subject_name,
    subjectColor: r.subject_color,
    subjectCategory: r.subject_category,
    photoCount: r.photo_count ?? 0,
  };
}

export function getStudyBlocksForRange(
  rangeStartMs: number,
  rangeEndMs: number
): StudyBlockWithSubject[] {
  const db = getDb();
  const rows = db.getAllSync<{
    id: string;
    subject_id: string;
    title: string;
    start_time: number;
    end_time: number;
    created_at: number;
    subject_name: string;
    subject_color: string;
    subject_category: SubjectCategory;
    photo_count: number;
  }>(
    `SELECT
       sb.id,
       sb.subject_id,
       sb.title,
       sb.start_time,
       sb.end_time,
       sb.created_at,
       s.name AS subject_name,
       s.color AS subject_color,
       s.category AS subject_category,
       (SELECT COUNT(*) FROM vault_photos vp WHERE vp.study_block_id = sb.id) AS photo_count
     FROM study_blocks sb
     INNER JOIN subjects s ON s.id = sb.subject_id
     WHERE sb.end_time > ? AND sb.start_time < ?
     ORDER BY sb.start_time ASC`,
    [rangeStartMs, rangeEndMs]
  );

  return rows.map(mapStudyBlockRow);
}

export function getUpcomingBlocks(fromMs: number): StudyBlockWithSubject[] {
  const db = getDb();
  const rows = db.getAllSync<{
    id: string;
    subject_id: string;
    title: string;
    start_time: number;
    end_time: number;
    created_at: number;
    subject_name: string;
    subject_color: string;
    subject_category: SubjectCategory;
    photo_count: number;
  }>(
    `SELECT
       sb.id,
       sb.subject_id,
       sb.title,
       sb.start_time,
       sb.end_time,
       sb.created_at,
       s.name AS subject_name,
       s.color AS subject_color,
       s.category AS subject_category,
       (SELECT COUNT(*) FROM vault_photos vp WHERE vp.study_block_id = sb.id) AS photo_count
     FROM study_blocks sb
     INNER JOIN subjects s ON s.id = sb.subject_id
     WHERE sb.end_time > ?
     ORDER BY sb.start_time ASC`,
    [fromMs]
  );

  return rows.map(mapStudyBlockRow);
}

export function getActiveStudyBlockFromDb(nowMs = Date.now()): StudyBlockWithSubject | null {
  const db = getDb();
  const row = db.getFirstSync<{
    id: string;
    subject_id: string;
    title: string;
    start_time: number;
    end_time: number;
    created_at: number;
    subject_name: string;
    subject_color: string;
    subject_category: SubjectCategory;
    photo_count: number;
  }>(
    `SELECT
       sb.id,
       sb.subject_id,
       sb.title,
       sb.start_time,
       sb.end_time,
       sb.created_at,
       s.name AS subject_name,
       s.color AS subject_color,
       s.category AS subject_category,
       (SELECT COUNT(*) FROM vault_photos vp WHERE vp.study_block_id = sb.id) AS photo_count
     FROM study_blocks sb
     INNER JOIN subjects s ON s.id = sb.subject_id
     WHERE ? >= sb.start_time AND ? < sb.end_time
     LIMIT 1`,
    [nowMs, nowMs]
  );

  return row ? mapStudyBlockRow(row) : null;
}

export function getStudyBlockById(blockId: string): StudyBlockWithSubject | null {
  const db = getDb();
  const row = db.getFirstSync<{
    id: string;
    subject_id: string;
    title: string;
    start_time: number;
    end_time: number;
    created_at: number;
    subject_name: string;
    subject_color: string;
    subject_category: SubjectCategory;
    photo_count: number;
  }>(
    `SELECT
       sb.id,
       sb.subject_id,
       sb.title,
       sb.start_time,
       sb.end_time,
       sb.created_at,
       s.name AS subject_name,
       s.color AS subject_color,
       s.category AS subject_category,
       (SELECT COUNT(*) FROM vault_photos vp WHERE vp.study_block_id = sb.id) AS photo_count
     FROM study_blocks sb
     INNER JOIN subjects s ON s.id = sb.subject_id
     WHERE sb.id = ?
     LIMIT 1`,
    [blockId]
  );

  return row ? mapStudyBlockRow(row) : null;
}

export function createStudyBlock(input: {
  subjectId: string;
  title: string;
  startTime: number;
  endTime: number;
}): StudyBlock {
  if (input.startTime >= input.endTime) {
    throw new Error('Invalid time window: startTime must precede endTime');
  }

  const db = getDb();
  const block: StudyBlock = {
    id: generateId('blk'),
    subjectId: input.subjectId,
    title: input.title.trim(),
    startTime: input.startTime,
    endTime: input.endTime,
    createdAt: Date.now(),
  };

  db.withTransactionSync(() => {
    const conflict = findSqlConflict(block.startTime, block.endTime, null);
    if (conflict) {
      throw new ScheduleConflictError(conflict);
    }

    db.runSync(
      `INSERT INTO study_blocks (id, subject_id, title, start_time, end_time, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [block.id, block.subjectId, block.title, block.startTime, block.endTime, block.createdAt]
    );
  });

  return block;
}

export function updateStudyBlock(
  id: string,
  input: {
    subjectId: string;
    title: string;
    startTime: number;
    endTime: number;
  }
): void {
  if (input.startTime >= input.endTime) {
    throw new Error('Invalid time window: startTime must precede endTime');
  }

  const db = getDb();
  db.withTransactionSync(() => {
    const conflict = findSqlConflict(input.startTime, input.endTime, id);
    if (conflict) {
      throw new ScheduleConflictError(conflict);
    }

    db.runSync(
      `UPDATE study_blocks
       SET subject_id = ?, title = ?, start_time = ?, end_time = ?
       WHERE id = ?`,
      [input.subjectId, input.title.trim(), input.startTime, input.endTime, id]
    );
  });
}

export function extendStudyBlock(id: string, extraMs: number): StudyBlockWithSubject | null {
  const db = getDb();
  db.withTransactionSync(() => {
    const current = getStudyBlockById(id);
    if (!current) {
      throw new Error('Study block not found');
    }

    const baseEnd = Math.max(current.endTime, Date.now());
    const newEndTime = baseEnd + extraMs;
    const conflict = findSqlConflict(current.startTime, newEndTime, id);
    if (conflict) {
      throw new ScheduleConflictError(conflict);
    }

    db.runSync('UPDATE study_blocks SET end_time = ? WHERE id = ?', [newEndTime, id]);
  });

  return getStudyBlockById(id);
}

export function deleteStudyBlock(id: string): void {
  const db = getDb();
  const photos = db.getAllSync<{ file_path: string }>(
    'SELECT file_path FROM vault_photos WHERE study_block_id = ?',
    [id]
  );

  db.runSync('DELETE FROM study_blocks WHERE id = ?', [id]);

  for (const photo of photos) {
    deleteVaultFile(photo.file_path);
  }
}

// --- Vault Photos ---

export function getVaultPhotosForBlock(studyBlockId: string): VaultPhoto[] {
  const db = getDb();
  const rows = db.getAllSync<{
    id: string;
    study_block_id: string;
    file_path: string;
    captured_at: number;
    file_size_bytes: number;
  }>(
    `SELECT id, study_block_id, file_path, captured_at, file_size_bytes
     FROM vault_photos
     WHERE study_block_id = ?
     ORDER BY captured_at DESC`,
    [studyBlockId]
  );

  return rows.map((r) => ({
    id: r.id,
    studyBlockId: r.study_block_id,
    filePath: r.file_path,
    capturedAt: r.captured_at,
    fileSizeBytes: r.file_size_bytes,
  }));
}

export function insertVaultPhoto(input: {
  studyBlockId: string;
  filePath: string;
  fileSizeBytes: number;
  capturedAt?: number;
}): VaultPhoto {
  const db = getDb();
  const photo: VaultPhoto = {
    id: generateId('vp'),
    studyBlockId: input.studyBlockId,
    filePath: input.filePath,
    capturedAt: input.capturedAt ?? Date.now(),
    fileSizeBytes: input.fileSizeBytes,
  };

  db.runSync(
    `INSERT INTO vault_photos (id, study_block_id, file_path, captured_at, file_size_bytes)
     VALUES (?, ?, ?, ?, ?)`,
    [photo.id, photo.studyBlockId, photo.filePath, photo.capturedAt, photo.fileSizeBytes]
  );

  return photo;
}

export function deleteVaultPhoto(photoId: string): void {
  const db = getDb();
  const row = db.getFirstSync<{ file_path: string }>(
    'SELECT file_path FROM vault_photos WHERE id = ?',
    [photoId]
  );

  db.runSync('DELETE FROM vault_photos WHERE id = ?', [photoId]);

  if (row?.file_path) {
    deleteVaultFile(row.file_path);
  }
}

