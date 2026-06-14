// ─── Automated SQLite backups ─────────────────────────────────────────────────
// Uses better-sqlite3's online backup API (safe to run while the app is serving
// traffic). Writes timestamped copies into BACKUP_DIR and rotates old ones.
// Disabled unless BACKUP_DIR is set.

const fs = require('fs');
const path = require('path');
const db = require('./db');
const { config } = require('./config');

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function runBackup() {
  const dir = config.backup.dir;
  if (!dir) return null;
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, `mes-${timestamp()}.db`);
  try {
    await db.backup(dest);          // returns a promise in better-sqlite3
    rotate(dir, config.backup.keep);
    console.log(`[backup] wrote ${dest}`);
    return dest;
  } catch (e) {
    console.error('[backup] failed:', e.message);
    return null;
  }
}

function rotate(dir, keep) {
  try {
    const files = fs.readdirSync(dir)
      .filter(f => f.startsWith('mes-') && f.endsWith('.db'))
      .sort();                       // ISO timestamps sort chronologically
    const excess = files.length - keep;
    for (let i = 0; i < excess; i++) {
      fs.unlinkSync(path.join(dir, files[i]));
    }
  } catch (e) {
    console.error('[backup] rotation failed:', e.message);
  }
}

// Kicks off a backup shortly after boot, then on a fixed interval.
function startBackups() {
  if (!config.backup.dir) return;
  const intervalMs = Math.max(1, config.backup.intervalHours) * 60 * 60 * 1000;
  setTimeout(() => { runBackup(); }, 10_000).unref();
  setInterval(() => { runBackup(); }, intervalMs).unref();
}

module.exports = { runBackup, startBackups };
