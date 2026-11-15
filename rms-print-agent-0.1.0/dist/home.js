"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.homePaths = exports.usesDefaultHome = exports.resolveHome = exports.DEFAULT_APP_FOLDER = void 0;
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
/**
 * Where the agent keeps everything that belongs to one install: what it was
 * enrolled as, its credentials, its printers, its queue and its log.
 *
 * On Windows that is C:\ProgramData\RMS Print Agent — outside any user's
 * profile, so it is the same folder whether the agent runs as the service
 * account at boot or as an administrator at a prompt, and it can be locked to
 * administrators (see lockDownHome). PRINT_AGENT_HOME moves it, which is how a
 * developer runs an agent without touching ProgramData.
 */
exports.DEFAULT_APP_FOLDER = 'RMS Print Agent';
const resolveHome = (env = process.env, platform = process.platform) => {
    const override = env.PRINT_AGENT_HOME?.trim();
    if (override)
        return node_path_1.default.resolve(override);
    if (platform === 'win32')
        return node_path_1.default.join(env.ProgramData?.trim() || 'C:\\ProgramData', exports.DEFAULT_APP_FOLDER);
    return node_path_1.default.join(node_os_1.default.homedir(), '.rms-print-agent');
};
exports.resolveHome = resolveHome;
/** True when the folder is the shared default, not one a developer pointed us at. */
const usesDefaultHome = (env = process.env) => !env.PRINT_AGENT_HOME?.trim();
exports.usesDefaultHome = usesDefaultHome;
const homePaths = (home) => ({
    home,
    settings: node_path_1.default.join(home, 'agent.json'),
    credentials: node_path_1.default.join(home, 'credentials.json'),
    printers: node_path_1.default.join(home, 'printers.json'),
    queue: node_path_1.default.join(home, 'queue.db'),
    logs: node_path_1.default.join(home, 'logs'),
    lock: node_path_1.default.join(home, 'agent.lock'),
});
exports.homePaths = homePaths;
