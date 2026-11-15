"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadConfig = exports.readVersion = exports.writeSettings = exports.readSettings = void 0;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const credentials_1 = require("./credentials");
const home_1 = require("./home");
const readSettings = (file) => {
    try {
        return JSON.parse(node_fs_1.default.readFileSync(file, 'utf8'));
    }
    catch {
        return undefined;
    }
};
exports.readSettings = readSettings;
const writeSettings = (file, settings) => {
    node_fs_1.default.mkdirSync(node_path_1.default.dirname(file), { recursive: true });
    node_fs_1.default.writeFileSync(file, JSON.stringify(settings, null, 2));
};
exports.writeSettings = writeSettings;
const readVersion = () => {
    try {
        const manifest = JSON.parse(node_fs_1.default.readFileSync(node_path_1.default.join(__dirname, '..', 'package.json'), 'utf8'));
        return manifest.version ?? 'unknown';
    }
    catch {
        return 'unknown';
    }
};
exports.readVersion = readVersion;
const NOT_ENROLLED = 'This agent has not been enrolled yet. Run: print-agent enrol --server <server address> --code <enrolment code>';
const checkUrl = (serverUrl) => {
    try {
        const { protocol } = new URL(serverUrl);
        if (protocol !== 'http:' && protocol !== 'https:')
            throw new Error('not http');
    }
    catch {
        throw new Error(`The server address must be a web address like https://api.example.com, got "${serverUrl}".`);
    }
};
/** Throws a message an installer can act on if something required is missing. */
const loadConfig = (env = process.env, protector) => {
    const home = (0, home_1.resolveHome)(env);
    const paths = (0, home_1.homePaths)(home);
    const serverUrl = env.PRINT_AGENT_SERVER_URL?.trim() || (0, exports.readSettings)(paths.settings)?.serverUrl;
    if (!serverUrl)
        throw new Error(NOT_ENROLLED);
    checkUrl(serverUrl);
    const token = env.PRINT_AGENT_TOKEN?.trim() || (0, credentials_1.loadToken)(paths.credentials, protector);
    if (!token)
        throw new Error(NOT_ENROLLED);
    return {
        serverUrl,
        token,
        dbPath: env.PRINT_AGENT_DB?.trim() || paths.queue,
        printersPath: env.PRINT_AGENT_PRINTERS?.trim() || paths.printers,
        home,
        version: (0, exports.readVersion)(),
    };
};
exports.loadConfig = loadConfig;
