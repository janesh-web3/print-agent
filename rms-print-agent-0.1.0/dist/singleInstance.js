"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.acquireLock = exports.systemLockEnvironment = exports.AlreadyRunningError = void 0;
const node_child_process_1 = require("node:child_process");
const node_fs_1 = __importDefault(require("node:fs"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
/**
 * Only one agent may run per install.
 *
 * Two agents with the same token both receive every ticket from the server and
 * both print it: every ticket twice. It is easy to cause — an installer starts
 * the agent by hand to "check it" while the background job is already running —
 * so the second one refuses to start instead.
 *
 * The lock is a file naming the running agent. The hard part is telling a live
 * lock from a dead one. A power cut leaves the file behind, and after the
 * reboot Windows hands out process ids afresh, so "is process 4312 alive?" can
 * answer yes about some unrelated program. A lock is therefore taken over when:
 *
 *   - it was written before this computer started up, or
 *   - the process it names is gone, or
 *   - the process it names is not a Node program.
 *
 * Getting this wrong in the cautious direction would leave a venue with no
 * printing after every power cut, the one thing the agent exists to survive.
 */
class AlreadyRunningError extends Error {
    pid;
    constructor(pid) {
        super(`The print agent is already running here (process ${pid}). Only one may run at a time.`);
        this.pid = pid;
    }
}
exports.AlreadyRunningError = AlreadyRunningError;
const processExists = (pid) => {
    try {
        process.kill(pid, 0); // signal 0 checks existence without sending anything
        return true;
    }
    catch (error) {
        // EPERM means it exists but belongs to someone else, which still counts.
        return error.code === 'EPERM';
    }
};
/** On Windows ask which program owns the id; elsewhere an existing process is taken at its word. */
const isNodeImage = (pid) => {
    if (process.platform !== 'win32')
        return true;
    try {
        const out = (0, node_child_process_1.execFileSync)('tasklist.exe', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8', timeout: 10_000, windowsHide: true });
        return /"node(\.exe)?"/i.test(out);
    }
    catch {
        return true; // cannot tell: the safe answer here is "yes, it might be an agent"
    }
};
exports.systemLockEnvironment = {
    now: () => Date.now(),
    bootedAt: () => Date.now() - node_os_1.default.uptime() * 1000,
    isAlive: processExists,
    isNodeProcess: isNodeImage,
};
// A clock that reads a few seconds off must not make a lock written a moment
// ago look as if it predates boot.
const BOOT_SLACK_MS = 30_000;
const readLock = (file) => {
    try {
        const parsed = JSON.parse(node_fs_1.default.readFileSync(file, 'utf8'));
        if (Number.isInteger(parsed.pid) && typeof parsed.startedAt === 'number')
            return parsed;
    }
    catch {
        // unreadable or half-written: treated as stale
    }
    return undefined;
};
const holderStillRunning = (lock, env) => lock.startedAt >= env.bootedAt() - BOOT_SLACK_MS && env.isAlive(lock.pid) && env.isNodeProcess(lock.pid);
/** Takes the lock, or throws AlreadyRunningError. Returns a function that releases it. */
const acquireLock = (file, pid = process.pid, env = exports.systemLockEnvironment) => {
    node_fs_1.default.mkdirSync(node_path_1.default.dirname(file), { recursive: true });
    const mine = { pid, startedAt: env.now() };
    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            node_fs_1.default.writeFileSync(file, JSON.stringify(mine), { flag: 'wx' });
            return () => {
                // Only remove our own lock: after a takeover the file is someone else's.
                try {
                    if (readLock(file)?.pid === pid)
                        node_fs_1.default.rmSync(file, { force: true });
                }
                catch {
                    // already gone
                }
            };
        }
        catch (error) {
            if (error.code !== 'EEXIST')
                throw error;
        }
        const holder = readLock(file);
        if (holder && holder.pid !== pid && holderStillRunning(holder, env))
            throw new AlreadyRunningError(holder.pid);
        // Stale: the agent that wrote it is gone. Clear it and try once more.
        node_fs_1.default.rmSync(file, { force: true });
    }
    throw new Error(`Could not take the lock file ${file}.`);
};
exports.acquireLock = acquireLock;
