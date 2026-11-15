"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createLogger = exports.RotatingLog = void 0;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
class RotatingLog {
    file;
    maxBytes;
    keep;
    constructor(directory, { maxBytes = 5 * 1024 * 1024, keep = 5 } = {}) {
        this.file = node_path_1.default.join(directory, 'agent.log');
        this.maxBytes = maxBytes;
        this.keep = keep;
        node_fs_1.default.mkdirSync(directory, { recursive: true });
    }
    write(line) {
        try {
            this.rotateIfNeeded(Buffer.byteLength(line) + 1);
            node_fs_1.default.appendFileSync(this.file, `${line}\n`);
        }
        catch {
            // Losing a log line is better than losing a ticket.
        }
    }
    rotateIfNeeded(incoming) {
        let size = 0;
        try {
            size = node_fs_1.default.statSync(this.file).size;
        }
        catch {
            return; // no file yet
        }
        if (size + incoming <= this.maxBytes)
            return;
        // agent.log.<keep> falls off the end; each other file moves up one.
        node_fs_1.default.rmSync(`${this.file}.${this.keep}`, { force: true });
        for (let n = this.keep - 1; n >= 1; n -= 1) {
            if (node_fs_1.default.existsSync(`${this.file}.${n}`))
                node_fs_1.default.renameSync(`${this.file}.${n}`, `${this.file}.${n + 1}`);
        }
        node_fs_1.default.renameSync(this.file, `${this.file}.1`);
    }
    /** The last `count` lines, for the status command. */
    tail(count) {
        try {
            return node_fs_1.default.readFileSync(this.file, 'utf8').split(/\r?\n/).filter(Boolean).slice(-count);
        }
        catch {
            return [];
        }
    }
}
exports.RotatingLog = RotatingLog;
/** A logger that writes to the console and, if given a directory, to the rotating file. */
const createLogger = (directory, options) => {
    const file = directory ? new RotatingLog(directory, options) : undefined;
    return (message) => {
        const line = `[${new Date().toISOString()}] ${message}`;
        console.log(line);
        file?.write(line);
    };
};
exports.createLogger = createLogger;
