"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.JobQueue = void 0;
const node_fs_1 = __importDefault(require("node:fs"));
const node_module_1 = require("node:module");
const node_path_1 = __importDefault(require("node:path"));
// Loaded by hand: Vite (which runs the tests) does not know node:sqlite is a
// built-in module and strips the prefix. A plain require behaves the same in
// the compiled agent and under test.
const { DatabaseSync } = (0, node_module_1.createRequire)(__filename)('node:sqlite');
const toQueuedJob = (row) => ({
    job: JSON.parse(row.job),
    status: row.status,
    outcome: row.outcome ?? undefined,
    attempts: row.attempts,
    nextAttemptAt: row.next_attempt_at,
    receivedAt: row.received_at,
    reportedAt: row.reported_at ?? undefined,
    lastError: row.last_error ?? undefined,
});
class JobQueue {
    db;
    /** `filename` is a path, or ':memory:' for a queue that does not outlive the process. */
    constructor(filename) {
        if (filename !== ':memory:')
            node_fs_1.default.mkdirSync(node_path_1.default.dirname(node_path_1.default.resolve(filename)), { recursive: true });
        this.db = new DatabaseSync(filename);
        // WAL keeps a crash from corrupting the file; FULL makes each write reach
        // the disk before it is acknowledged, which is what a power cut needs.
        this.db.exec('PRAGMA journal_mode = WAL');
        this.db.exec('PRAGMA synchronous = FULL');
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        job_id          TEXT PRIMARY KEY,
        job             TEXT NOT NULL,
        status          TEXT NOT NULL,
        outcome         TEXT,
        attempts        INTEGER NOT NULL DEFAULT 0,
        next_attempt_at INTEGER NOT NULL,
        received_at     INTEGER NOT NULL,
        reported_at     INTEGER,
        last_error      TEXT
      );
      CREATE INDEX IF NOT EXISTS jobs_due ON jobs (status, next_attempt_at);
    `);
    }
    /** Stores a ticket. Returns false if this job id is already here — the server may send one twice. */
    add(job, now) {
        const result = this.db
            .prepare(`INSERT OR IGNORE INTO jobs (job_id, job, status, next_attempt_at, received_at)
         VALUES (?, ?, 'PENDING', ?, ?)`)
            .run(job.jobId, JSON.stringify(job), now, now);
        return Number(result.changes) === 1;
    }
    get(jobId) {
        const row = this.db.prepare('SELECT * FROM jobs WHERE job_id = ?').get(jobId);
        return row && toQueuedJob(row);
    }
    /** The oldest ticket that is waiting and due. */
    nextDue(now) {
        const row = this.db
            .prepare(`SELECT * FROM jobs WHERE status = 'PENDING' AND next_attempt_at <= ?
         ORDER BY received_at, rowid LIMIT 1`)
            .get(now);
        return row && toQueuedJob(row);
    }
    /** How many tickets are saved and not yet printed. */
    pendingCount() {
        const row = this.db.prepare(`SELECT COUNT(*) AS n FROM jobs WHERE status = 'PENDING'`).get();
        return Number(row.n);
    }
    /** When the earliest waiting ticket is next due, or undefined if none is waiting. */
    nextWakeAt() {
        const row = this.db
            .prepare(`SELECT MIN(next_attempt_at) AS at FROM jobs WHERE status = 'PENDING'`)
            .get();
        return row.at ?? undefined;
    }
    /** A print attempt failed; try again at `nextAttemptAt`. */
    scheduleRetry(jobId, nextAttemptAt, error) {
        this.db
            .prepare(`UPDATE jobs SET attempts = attempts + 1, next_attempt_at = ?, last_error = ? WHERE job_id = ?`)
            .run(nextAttemptAt, error, jobId);
    }
    markPrinted(jobId) {
        this.db
            .prepare(`UPDATE jobs SET status = 'DONE', outcome = 'PRINTED', attempts = attempts + 1, last_error = NULL WHERE job_id = ?`)
            .run(jobId);
    }
    markFailed(jobId, error) {
        this.db
            .prepare(`UPDATE jobs SET status = 'DONE', outcome = 'FAILED', last_error = ? WHERE job_id = ?`)
            .run(error, jobId);
    }
    markReported(jobId, now) {
        this.db.prepare('UPDATE jobs SET reported_at = ? WHERE job_id = ?').run(now, jobId);
    }
    /** The server told us again about a ticket we finished: make sure it hears the outcome. */
    markUnreported(jobId) {
        this.db.prepare(`UPDATE jobs SET reported_at = NULL WHERE job_id = ? AND status = 'DONE'`).run(jobId);
    }
    /** Finished tickets the server has not been told about yet, oldest first. */
    unreported() {
        const rows = this.db
            .prepare(`SELECT * FROM jobs WHERE status = 'DONE' AND reported_at IS NULL ORDER BY received_at, rowid`)
            .all();
        return rows.map(toQueuedJob);
    }
    /** Forgets tickets finished and reported before `cutoff`, so the file does not grow forever. */
    prune(cutoff) {
        const result = this.db
            .prepare(`DELETE FROM jobs WHERE status = 'DONE' AND reported_at IS NOT NULL AND reported_at < ?`)
            .run(cutoff);
        return Number(result.changes);
    }
    close() {
        this.db.close();
    }
}
exports.JobQueue = JobQueue;
