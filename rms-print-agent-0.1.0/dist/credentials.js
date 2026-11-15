"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadToken = exports.saveToken = exports.defaultProtector = exports.plainProtector = exports.dpapiProtector = void 0;
const node_child_process_1 = require("node:child_process");
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
/** Mixed into the encryption so a blob sealed for something else cannot be replayed here. */
const ENTROPY = 'rms-print-agent/v1';
const POWERSHELL_PREAMBLE = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Security
$entropy = [Text.Encoding]::UTF8.GetBytes($env:PRINT_AGENT_ENTROPY)
$scope = [Security.Cryptography.DataProtectionScope]::LocalMachine
$secret = [Console]::In.ReadToEnd()
`;
const PROTECT_SCRIPT = POWERSHELL_PREAMBLE +
    `
$sealed = [Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($secret), $entropy, $scope)
[Console]::Out.Write([Convert]::ToBase64String($sealed))
`;
const UNPROTECT_SCRIPT = POWERSHELL_PREAMBLE +
    `
$opened = [Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($secret.Trim()), $entropy, $scope)
[Console]::Out.Write([Text.Encoding]::UTF8.GetString($opened))
`;
/**
 * Runs a snippet with the secret on stdin, never on the command line or in the
 * environment where another process could read it.
 */
const runPowerShell = (script, input) => {
    try {
        return (0, node_child_process_1.execFileSync)('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-OutputFormat', 'Text', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { input, encoding: 'utf8', timeout: 30_000, windowsHide: true, env: { ...process.env, PRINT_AGENT_ENTROPY: ENTROPY }, stdio: ['pipe', 'pipe', 'pipe'] });
    }
    catch (error) {
        const detail = String(error.stderr ?? error.message).split(/\r?\n/).find((line) => line.trim() && !line.startsWith('#<'));
        throw new Error(`Windows data protection failed: ${detail ?? 'unknown error'}`);
    }
};
exports.dpapiProtector = {
    name: 'dpapi-machine',
    protect: (text) => runPowerShell(PROTECT_SCRIPT, text).trim(),
    unprotect: (blob) => runPowerShell(UNPROTECT_SCRIPT, blob),
};
exports.plainProtector = {
    name: 'none',
    protect: (text) => text,
    unprotect: (blob) => blob,
};
const defaultProtector = (platform = process.platform) => platform === 'win32' ? exports.dpapiProtector : exports.plainProtector;
exports.defaultProtector = defaultProtector;
const saveToken = (file, token, protector = (0, exports.defaultProtector)()) => {
    node_fs_1.default.mkdirSync(node_path_1.default.dirname(file), { recursive: true });
    const contents = { v: 1, protection: protector.name, data: protector.protect(token) };
    // Written to a temp name first, so a power cut mid-write cannot leave a
    // half-written file where the working credentials used to be.
    const temp = `${file}.tmp`;
    node_fs_1.default.writeFileSync(temp, JSON.stringify(contents), { mode: 0o600 });
    node_fs_1.default.renameSync(temp, file);
};
exports.saveToken = saveToken;
/**
 * The saved token, or undefined if this install was never enrolled. Throws, with
 * a message that says what to do, if the file is there but cannot be opened.
 */
const loadToken = (file, protector = (0, exports.defaultProtector)()) => {
    if (!node_fs_1.default.existsSync(file))
        return undefined;
    let contents;
    try {
        contents = JSON.parse(node_fs_1.default.readFileSync(file, 'utf8'));
    }
    catch {
        throw new Error(`${file} is damaged. Enrol this agent again with a new code.`);
    }
    if (contents.protection !== protector.name) {
        throw new Error(`${file} was saved with "${contents.protection}" protection, which this computer cannot open. Enrol this agent again with a new code.`);
    }
    try {
        return protector.unprotect(contents.data);
    }
    catch {
        // The usual cause: the file came from another computer, or Windows was reinstalled.
        throw new Error(`${file} cannot be opened on this computer. Enrol this agent again with a new code.`);
    }
};
exports.loadToken = loadToken;
