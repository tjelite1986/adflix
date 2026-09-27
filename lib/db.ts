import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "fs";
import path from "path";

// Resolve the data directory (mounted as a named volume in Docker).
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "adflix.db");

// Reuse a single connection across hot reloads in dev.
const globalForDb = globalThis as unknown as { db?: Database.Database };

function createDb(): Database.Database {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  const db = new Database(DB_PATH);
  // busy_timeout before the journal_mode switch: that switch takes a write
  // lock, and a second process opening a fresh file must wait for it rather
  // than fail with SQLITE_BUSY.
  db.pragma("busy_timeout = 30000");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  // BEGIN IMMEDIATE serializes the schema setup across processes (the server
  // and a job script can start at the same moment).
  db.exec("BEGIN IMMEDIATE");
  try {
    migrate(db);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return db;
}

function migrate(db: Database.Database) {
  db.exec(`
    -- Accounts are MIRRORED, not owned. Adflix has no login of its own: the
    -- session cookie is minted by elite-v2 and resolved there (lib/sso.ts).
    -- The row exists so per-user state (progress, likes) has something to
    -- reference. It carries no password.
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL DEFAULT 'user',
      username TEXT,
      display_name TEXT,
      avatar_url TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      synced_at TEXT
    );

    -- The video library. Shared, not per-user: the files under
    -- VIDEOS_ROOT/<channel> are the source of truth and a scan mirrors them
    -- here, so a row is always reproducible from disk. The channel column and
    -- its CHECK came over from elite-v2 unchanged; this app only writes
    -- 'adults'.
    CREATE TABLE IF NOT EXISTS videos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel TEXT NOT NULL CHECK (channel IN ('main', 'adults')),
      storage_key TEXT NOT NULL,         -- path within VIDEOS_ROOT/<channel>
      folder TEXT NOT NULL DEFAULT '',   -- containing subfolder ('' = root)
      title TEXT NOT NULL,
      description TEXT,
      poster_key TEXT,                   -- filename within VIDEOS_ROOT/.posters
      -- Scrub-preview storyboard: one JPEG holding cols*rows frames sampled
      -- every storyboard_interval seconds (YouTube-style hover thumbnails).
      storyboard_key TEXT,
      storyboard_cols INTEGER,
      storyboard_rows INTEGER,
      storyboard_interval REAL,
      storyboard_tile_w INTEGER,
      storyboard_tile_h INTEGER,
      duration REAL,
      width INTEGER,
      height INTEGER,
      size_bytes INTEGER,
      file_mtime TEXT,
      -- Codecs decide whether a browser can play the file at all. A DVD rip
      -- (mpeg2video + ac3 in mkv) is unplayable everywhere, so the scan flags
      -- it and the transcode job converts it to H.264/AAC in MP4.
      video_codec TEXT,
      audio_codec TEXT,
      playable INTEGER NOT NULL DEFAULT 1,
      transcode_status TEXT,            -- NULL | 'pending' | 'done' | 'failed'
      transcode_error TEXT,
      -- ThePornDB metadata (18+ channel only). meta_status distinguishes an
      -- automatic match from one a human picked, so a rerun never overwrites
      -- a manual correction.
      meta_source TEXT,                 -- NULL | 'tpdb'
      meta_id TEXT,
      meta_type TEXT,                   -- 'movie' | 'scene'
      meta_title TEXT,
      meta_date TEXT,
      meta_studio TEXT,
      meta_synopsis TEXT,
      meta_performers TEXT,             -- JSON array of names
      meta_tags TEXT,                   -- JSON array of names
      meta_poster_key TEXT,             -- filename within VIDEOS_ROOT/.posters
      meta_url TEXT,
      meta_status TEXT,                 -- NULL | 'auto' | 'manual' | 'none'
      meta_checked_at TEXT,
      -- Scene extras that only the API has (a .nfo sidecar carries neither):
      -- chapter markers [{title,start,end}] and the community rating.
      meta_markers TEXT,
      meta_rating REAL,
      -- Vision-model summary built from the storyboard sheet. Kept apart from
      -- description (hand-written) and meta_synopsis (TPDB/TMDB) so a re-run
      -- never overwrites either, and the UI can label who wrote what.
      ai_summary TEXT,
      ai_summary_tags TEXT,
      ai_summary_model TEXT,
      ai_summary_at TEXT,
      ai_summary_error TEXT,
      views INTEGER NOT NULL DEFAULT 0,
      added_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (channel, storage_key)
    );
    CREATE INDEX IF NOT EXISTS idx_videos_channel_added
      ON videos(channel, added_at DESC);
    CREATE INDEX IF NOT EXISTS idx_videos_folder ON videos(channel, folder);

    -- Per-user playback position, so a video resumes where it was left off.
    CREATE TABLE IF NOT EXISTS video_progress (
      video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      position REAL NOT NULL DEFAULT 0,  -- seconds
      percent INTEGER NOT NULL DEFAULT 0,
      finished_at TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (video_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_video_progress_user
      ON video_progress(user_id, updated_at DESC);

    -- Performers in the 18+ video library. Their own table (not users, not
    -- accounts): these are people a film credits, with no account and no
    -- content of their own beyond the videos they appear in.
    CREATE TABLE IF NOT EXISTS video_performers (
      slug TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      tpdb_id TEXT,
      bio TEXT,
      birthday TEXT,
      birthplace TEXT,
      nationality TEXT,
      height TEXT,
      measurements TEXT,
      hair_colour TEXT,
      eye_colour TEXT,
      career_start INTEGER,
      career_end INTEGER,
      gender TEXT,
      ethnicity TEXT,
      cupsize TEXT,
      weight TEXT,
      waist TEXT,
      hips TEXT,
      tattoos TEXT,
      piercings TEXT,
      fake_boobs INTEGER,
      same_sex_only INTEGER,
      astrology TEXT,
      deathday TEXT,
      full_name TEXT,
      disambiguation TEXT,
      rating REAL,
      aliases TEXT,                     -- JSON array
      links TEXT,                       -- JSON array of {key, value}
      image_key TEXT,                   -- filename within VIDEOS_ROOT/.posters
      checked_at TEXT,                  -- last TPDB enrichment attempt
      manual INTEGER NOT NULL DEFAULT 0, -- created by hand: never auto-pruned
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- The photo strip at the top of a profile. Stored locally because the app's
    -- CSP is img-src 'self'; ordered as the source ordered them.
    CREATE TABLE IF NOT EXISTS video_performer_images (
      performer_slug TEXT NOT NULL REFERENCES video_performers(slug) ON DELETE CASCADE,
      idx INTEGER NOT NULL,
      image_key TEXT NOT NULL,
      PRIMARY KEY (performer_slug, idx)
    );

    CREATE TABLE IF NOT EXISTS video_performer_links (
      video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
      performer_slug TEXT NOT NULL REFERENCES video_performers(slug) ON DELETE CASCADE,
      -- Added by hand on the watch page: a rematch or rescan must not drop it.
      manual INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (video_id, performer_slug)
    );
    CREATE INDEX IF NOT EXISTS idx_video_performer_links_slug
      ON video_performer_links(performer_slug);

    -- Vision summaries of one stretch of a video, asked for by hand ("what
    -- happens between 10:00 and 20:00"). Separate from the whole-video summary
    -- on the videos table: several can exist per video, they are cheap to
    -- re-ask, and deleting one must not disturb the other.
    CREATE TABLE IF NOT EXISTS video_segment_summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
      from_seconds REAL NOT NULL,
      to_seconds REAL NOT NULL,
      summary TEXT NOT NULL,
      tags TEXT,
      model TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_video_segments_video
      ON video_segment_summaries(video_id, from_seconds);

    CREATE TABLE IF NOT EXISTS video_likes (
      video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (video_id, user_id)
    );

    -- Background-job scheduler (lib/jobs-runtime.mjs owns the writes).
    CREATE TABLE IF NOT EXISTS job_schedules (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      enabled INTEGER NOT NULL DEFAULT 0,
      interval_seconds INTEGER NOT NULL,
      last_run_at TEXT,
      last_status TEXT,
      last_duration_ms INTEGER,
      last_output TEXT,
      next_run_at TEXT,
      running INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

function getDb(): Database.Database {
  if (!globalForDb.db) globalForDb.db = createDb();
  return globalForDb.db;
}

// Opened on first use, never at import time. `next build` imports every route
// module in parallel workers while collecting page data; a module-level open
// runs the migration once per worker against a fresh file and loses the lock
// race. The Proxy keeps every `db.prepare(...)` call site unchanged.
export const db = new Proxy({} as Database.Database, {
  get(_target, prop) {
    const real = getDb();
    const value = Reflect.get(real, prop, real);
    return typeof value === "function" ? value.bind(real) : value;
  },
});

// --- Types ---

export interface UserRow {
  id: number;
  email: string;
  role: "user" | "admin";
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  created_at: string;
  synced_at: string | null;
}

export type VideoChannel = "main" | "adults";

export interface VideoRow {
  id: number;
  channel: VideoChannel;
  storage_key: string;
  folder: string;
  title: string;
  description: string | null;
  poster_key: string | null;
  storyboard_key: string | null;
  storyboard_cols: number | null;
  storyboard_rows: number | null;
  storyboard_interval: number | null;
  storyboard_tile_w: number | null;
  storyboard_tile_h: number | null;
  duration: number | null;
  width: number | null;
  height: number | null;
  size_bytes: number | null;
  file_mtime: string | null;
  video_codec: string | null;
  audio_codec: string | null;
  playable: number;
  transcode_status: "pending" | "done" | "failed" | null;
  transcode_error: string | null;
  meta_source: string | null;
  meta_id: string | null;
  meta_type: "movie" | "scene" | null;
  meta_title: string | null;
  meta_date: string | null;
  meta_studio: string | null;
  meta_synopsis: string | null;
  meta_performers: string | null;
  meta_tags: string | null;
  meta_poster_key: string | null;
  meta_url: string | null;
  meta_status: "auto" | "manual" | "none" | null;
  meta_checked_at: string | null;
  meta_markers: string | null;
  meta_rating: number | null;
  ai_summary: string | null;
  ai_summary_tags: string | null;
  ai_summary_model: string | null;
  ai_summary_at: string | null;
  ai_summary_error: string | null;
  views: number;
  added_at: string;
}

export interface VideoProgressRow {
  video_id: number;
  user_id: number;
  position: number;
  percent: number;
  finished_at: string | null;
  updated_at: string;
}

export interface VideoPerformerRow {
  slug: string;
  name: string;
  tpdb_id: string | null;
  bio: string | null;
  birthday: string | null;
  birthplace: string | null;
  nationality: string | null;
  height: string | null;
  measurements: string | null;
  hair_colour: string | null;
  eye_colour: string | null;
  career_start: number | null;
  career_end: number | null;
  gender: string | null;
  ethnicity: string | null;
  cupsize: string | null;
  weight: string | null;
  waist: string | null;
  hips: string | null;
  tattoos: string | null;
  piercings: string | null;
  fake_boobs: number | null;
  same_sex_only: number | null;
  astrology: string | null;
  deathday: string | null;
  full_name: string | null;
  disambiguation: string | null;
  rating: number | null;
  aliases: string | null;
  links: string | null;
  image_key: string | null;
  checked_at: string | null;
  manual: number;
  created_at: string;
}

export interface VideoLikeRow {
  video_id: number;
  user_id: number;
  created_at: string;
}
