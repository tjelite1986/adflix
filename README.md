# Adflix

A film library for the adult channel: a browsable grid of full-length videos,
a player that resumes where you left off, performer profiles enriched from
ThePornDB, scrub-preview storyboards and a transcode queue for files a browser
cannot play.

It was the `/videos18` section of elite-v2 until 2026-09-27, when it was copied
out into this app — the same move `/shorts18` (adshortis) and `/posts`
(elitogram) made before it. Unlike those, elite-v2 keeps its copy: both run side
by side, each with its own database and its own copy of the files.

Nothing here names the machine it runs on: hostnames, the media root and the
address of the app it borrows its login from all come from the environment.

---

## What it is

| | |
|---|---|
| Stack | Next 15 (App Router), React 19, Tailwind, better-sqlite3 |
| Database | one SQLite file, `DATA_DIR/adflix.db` |
| Media | on disk, under `VIDEOS_ROOT/adults` and `VIDEOS_ROOT/.posters` — never in the database |
| Accounts | none of its own; sign-in is elite-v2's (see [Sign-in](#sign-in)) |
| Dev | `npm run dev` → :3022 |

### Pages

| Path | |
|---|---|
| `/` | redirects to `/videos` |
| `/videos` | the library as a grid, by folder |
| `/videos/<id>` | the player, metadata, performers, segment summaries |
| `/videos/analysis` | vision summaries, when they are switched on (see below) |
| `/performers`, `/performer/<slug>` | performers, and one performer's films |
| `/settings` | background jobs and library tools (admin) |

---

## Sign-in

There are no accounts here. elite-v2 scopes its session cookie to the parent
domain, so a browser signed in there arrives here already signed in. The token
behind that cookie is posted to elite-v2's `POST /api/auth/verify`
(`ELITE_VERIFY_URL`, over the internal network), and the answer is mirrored into
the local `users` table so progress and likes have a row to reference. No
password is stored here.

A visitor without a session gets a page with a link to elite-v2's login
(`ELITE_APP_URL`), not a redirect: "signed out" and "the sign-in host is
unreachable" are different situations.

---

## Environment

| Variable | |
|---|---|
| `DATA_DIR` | where `adflix.db` and its backups live (default `./data`) |
| `VIDEOS_ROOT` | media root; the library is `VIDEOS_ROOT/adults`, posters `VIDEOS_ROOT/.posters` |
| `APP_URL` | this app's public origin |
| `ELITE_APP_URL` | elite-v2's public origin (the login link) |
| `ELITE_VERIFY_URL` | elite-v2's verify endpoint, reachable from the container |
| `IMPORT_CRON_SECRET` | shared secret for the loopback job endpoints |
| `TPDB_API_KEY` | ThePornDB, for film and performer metadata |
| `TMDB_API_KEY` | optional, metadata fallback |
| `VIDEOS_KEEP_ORIGINALS` | keep the source file after a transcode |
| `VIDEO_AI_SUMMARY_CHANNELS` | set to `adults` to allow vision summaries; empty = off |
| `VIDEO_AI_PROVIDER`, `VIDEO_AI_MODEL`, `VIDEO_AI_EFFORT` | which vision model writes them |
| `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY` | the key for that provider |
| `BACKUP_DIR`, `BACKUP_KEEP` | nightly database backups |

Vision summaries are opt-in on purpose: an API key alone must not send this
library to a third party.

---

## Background jobs

Scheduled work runs inside the server process (`lib/jobs-runtime.mjs`) and is
managed from `/settings`. Every job starts **disabled** so a migration cannot
race a scan; once it is done, `scripts/enable-jobs.mjs` turns them all on and
spreads jobs that share an interval (or toggle them one by one in `/settings`).

| Job | |
|---|---|
| `videos-scan` | mirror `VIDEOS_ROOT/adults` into the database, build posters and storyboards |
| `videos-transcode` | convert files a browser cannot play to H.264/AAC MP4 |
| `videos-metadata` | match films and performers against ThePornDB |
| `videos-summary` | vision summaries (only when enabled, see above) |
| `db-maintenance`, `db-backup` | `PRAGMA optimize` / WAL checkpoint, and a nightly `.backup` |

---

## Migrating from elite-v2

```sh
# snapshot with the backup API — a plain cp of a WAL database loses rows
docker exec elitev2 node -e 'new (require("better-sqlite3"))("/app/data/elitev2.db",{readonly:true}).backup("/tmp/snap.db")'
docker cp elitev2:/tmp/snap.db ./snap.db

# start adflix once so it creates its schema, then:
node scripts/migrate-from-elitev2.mjs ./snap.db ./data/adflix.db
```

It copies every `channel='adults'` video with its ids intact, all performers
with their images and links, progress, likes, segment summaries and the
accounts those rows reference. It is idempotent and never deletes: a re-run is
a top-up. The files themselves are copied separately (rsync of `adults/` and
`.posters/`).

New files dropped into elite-v2's library after the copy do **not** reach this
app; they have to land in `VIDEOS_ROOT/adults` here too.

---

## Development

```sh
npm install
npm run dev         # :3022
npm run typecheck
npm run lint
python3 scripts/make-icons.py   # regenerate the PWA icons (Pillow)
```

CI runs typecheck, lint and a Docker build on every push. It does not deploy:
the image is built on the host that runs it.
