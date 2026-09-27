#!/usr/bin/env node
// One-off: seed this app's database from elite-v2's, taking the 18+ video
// library (channel 'adults') and the per-user state attached to it.
//
//   node scripts/migrate-from-elitev2.mjs <source.db> [dest.db]
//
// The source MUST be a snapshot taken with SQLite's .backup, not a copied file:
// elite-v2 runs in WAL mode, and a plain `cp` of the .db without its -wal is a
// file that opens fine and reports zero rows.
//
// Ids are preserved. A progress row, a like, a performer link and a segment
// summary all reference a video id, and the posters on disk are named after
// them — renumbering would mean rewriting all of it.
//
// Accounts come across only when an adults row references them (progress or a
// like), as a mirror keyed by the same integer the session already carries
// (lib/sso.ts). No password or PIN hash: elite-v2 owns the login, and this app
// has no PIN. Everyone else gets their mirror row on first visit.
//
// Idempotent: every insert is INSERT OR IGNORE, so a re-run adds what is missing
// and touches nothing already here. It does NOT delete: a row removed in
// elite-v2 after the first run stays, because by then this app owns its library
// and a second migration is a top-up, not a mirror.

import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const SRC = process.argv[2];
const DEST =
  process.argv[3] ||
  path.join(process.env.DATA_DIR || "/app/data", "adflix.db");

const log = (m) => console.log(`[migrate] ${m}`);

if (!SRC || !fs.existsSync(SRC)) {
  console.error("usage: migrate-from-elitev2.mjs <source.db> [dest.db]");
  process.exit(1);
}

const db = new Database(DEST);
db.pragma("busy_timeout = 30000");
db.pragma("journal_mode = WAL");

// The destination schema is created by the app on first start. Running this
// before that has happened would build half a schema here and let the app's own
// migrate() disagree with it later, so refuse rather than guess.
const haveVideos = db
  .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='videos'")
  .get();
if (!haveVideos) {
  console.error(
    "The destination has no schema yet. Start the app once (it runs migrate() " +
      "on boot), then run this."
  );
  process.exit(1);
}

db.prepare("ATTACH DATABASE ? AS src").run(SRC);

// Foreign keys stay on: the copy order (users and videos before the rows that
// reference them) is what guarantees them, and turning the check off would only
// hide a real ordering mistake.
db.pragma("foreign_keys = ON");

// The column lists are the destination's, read at run time: the video tables
// were copied from elite-v2's schema verbatim, so every column here exists
// there too. A column elite-v2 later drops fails loudly rather than silently.
const columns = (table) =>
  db
    .prepare(`PRAGMA main.table_info(${table})`)
    .all()
    .map((r) => r.name)
    .join(", ");

const ADULT_VIDEO = "SELECT id FROM src.videos WHERE channel = 'adults'";

const counts = {};
function copy(label, sql) {
  const info = db.prepare(sql).run();
  counts[label] = info.changes;
  log(`${label}: ${info.changes}`);
}

function copyTable(table, where) {
  const cols = columns(table);
  copy(
    table,
    `INSERT OR IGNORE INTO main.${table} (${cols})
     SELECT ${cols} FROM src.${table} ${where}`
  );
}

const tx = db.transaction(() => {
  // Accounts first: progress and likes reference them. The handle comes from
  // user_profiles so a name renders before the person's first visit here
  // re-verifies the session.
  copy(
    "users",
    `INSERT OR IGNORE INTO main.users (id, email, role, username, display_name, created_at)
     SELECT u.id, u.email, u.role, p.username, p.display_name, u.created_at
       FROM src.users u
       LEFT JOIN src.user_profiles p ON p.user_id = u.id
      WHERE u.id IN (
        SELECT user_id FROM src.video_progress WHERE video_id IN (${ADULT_VIDEO})
        UNION
        SELECT user_id FROM src.video_likes WHERE video_id IN (${ADULT_VIDEO})
      )`
  );

  copyTable("videos", "WHERE channel = 'adults'");

  // Performers belong to the 18+ library as a whole, so all of them come
  // across — including hand-made ones not yet linked to any video.
  copyTable("video_performers", "");
  copyTable("video_performer_images", "");

  for (const table of [
    "video_performer_links",
    "video_progress",
    "video_likes",
    "video_segment_summaries",
  ]) {
    copyTable(table, `WHERE video_id IN (${ADULT_VIDEO})`);
  }
});

tx();

db.prepare("DETACH DATABASE src").run();
db.close();

log("done");
log(
  Object.entries(counts)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ")
);
