/**
 * VidCraft AI - SQLite Database
 * Database initialization and query helpers using better-sqlite3
 */

import Database, { Database as DatabaseType } from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { env } from '../config/env';

const dbDir = path.dirname(env.DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db: DatabaseType = new Database(env.DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function initializeDatabase(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      phone TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      nickname TEXT DEFAULT '',
      avatar_url TEXT,
      membership TEXT DEFAULT 'free',
      credits INTEGER DEFAULT 3,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS verification_codes (
      id TEXT PRIMARY KEY,
      phone TEXT NOT NULL,
      code TEXT NOT NULL,
      type TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used INTEGER DEFAULT 0,
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS video_projects (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT DEFAULT '',
      original_prompt TEXT NOT NULL,
      enhanced_prompt TEXT,
      style_template TEXT DEFAULT 'cinematic',
      aspect_ratio TEXT DEFAULT '16:9',
      voice_config TEXT DEFAULT '{"enabled":false}',
      music_config TEXT DEFAULT '{"enabled":false}',
      status TEXT DEFAULT 'draft',
      duration INTEGER,
      video_url TEXT,
      thumbnail_url TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS storyboards (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      scene_index INTEGER NOT NULL,
      prompt TEXT NOT NULL,
      duration INTEGER DEFAULT 5,
      camera_type TEXT,
      movement TEXT,
      video_clip_url TEXT,
      thumbnail_url TEXT,
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES video_projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS generation_tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      progress INTEGER DEFAULT 0,
      current_step TEXT DEFAULT 'queued',
      estimated_remaining INTEGER,
      error_message TEXT,
      started_at TEXT,
      completed_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES video_projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS token_blacklist (
      token_hash TEXT PRIMARY KEY,
      expires_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_blacklist_expires ON token_blacklist(expires_at);
    CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
    CREATE INDEX IF NOT EXISTS idx_projects_user_id ON video_projects(user_id);
    CREATE INDEX IF NOT EXISTS idx_projects_status ON video_projects(status);
    CREATE INDEX IF NOT EXISTS idx_storyboards_project ON storyboards(project_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_project ON generation_tasks(project_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON generation_tasks(status);
    CREATE INDEX IF NOT EXISTS idx_verification_phone ON verification_codes(phone, type);
  `);

  // Preserve existing installations while adding per-code guess limits.
  const columns = db.pragma('table_info(verification_codes)') as { name: string }[];
  if (!columns.some((column) => column.name === 'attempts')) {
    db.exec('ALTER TABLE verification_codes ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0');
  }
}

initializeDatabase();

export default db;
