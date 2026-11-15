"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const config_1 = require("./config");
const enrol_1 = require("./enrol");
const home_1 = require("./home");
const logger_1 = require("./logger");
const windowsService_1 = require("./windowsService");
/**
 * The installer's tool: `print-agent <command>`.
 *
 *   enrol     trade the code an administrator generated for this PC's credentials
 *   install   start the agent at every boot, and now
 *   uninstall stop it and remove it from boot
 *   status    is it enrolled, installed and running?
 *   run       run the agent here, in this window (what the boot job runs)
 */
const USAGE = `RMS print agent

Usage:
  print-agent enrol --server <address> --code <code>   Connect this PC to a restaurant (run as administrator)
  print-agent install                                   Start the agent now and at every boot (run as administrator)
  print-agent uninstall                                 Stop the agent and remove it from boot (run as administrator)
  print-agent status                                    Show whether it is enrolled and running
  print-agent run                                       Run the agent in this window (for testing)

The enrolment code is made in the restaurant's settings, under print agents.
Printers are added in the restaurant's settings (Settings > Printing) and sent to this PC.`;
const flag = (args, name) => {
    const at = args.indexOf(name);
    return at >= 0 ? args[at + 1] : undefined;
};
const out = (line = '') => console.log(line);
const enrol = async (args) => {
    const serverUrl = flag(args, '--server');
    const code = flag(args, '--code');
    if (!serverUrl || !code)
        throw new Error('enrol needs --server <address> and --code <code>.\n\n' + USAGE);
    const home = (0, home_1.resolveHome)();
    // The credentials are about to be written. On a venue PC that folder must be
    // locked to administrators first, which only an administrator can do.
    if ((0, home_1.usesDefaultHome)() && process.platform === 'win32') {
        await (0, windowsService_1.requireElevation)('Enrolling (which saves this PC\'s credentials)');
        await (0, windowsService_1.lockDownFolder)(home);
    }
    const settings = await (0, enrol_1.enrolAgent)({ serverUrl, code, home, agentVersion: (0, config_1.readVersion)() });
    out(`Enrolled as "${settings.deviceName}" for ${settings.restaurantName || 'this restaurant'}.`);
    out(`Saved to ${home}`);
    out();
    out('Next: print-agent install. Then add the printers in the restaurant\'s settings (Settings > Printing).');
};
const install = async () => {
    (0, windowsService_1.requireWindows)();
    if (!(0, home_1.usesDefaultHome)()) {
        throw new Error('PRINT_AGENT_HOME is set. The boot job cannot see it, so it would look in the wrong folder. Unset it to install.');
    }
    await (0, windowsService_1.requireElevation)('Installing');
    const paths = (0, home_1.homePaths)((0, home_1.resolveHome)());
    if (!(0, config_1.readSettings)(paths.settings) || !node_fs_1.default.existsSync(paths.credentials)) {
        throw new Error('This agent has not been enrolled yet. Run: print-agent enrol --server <address> --code <code>');
    }
    await (0, windowsService_1.installTask)({
        command: process.execPath,
        args: `"${node_path_1.default.join(__dirname, 'index.js')}"`,
        workingDirectory: node_path_1.default.resolve(__dirname, '..'),
    });
    out(`Installed. The agent is running now and will start by itself every time this PC starts.`);
    if (!node_fs_1.default.existsSync(paths.printers))
        out(`Note: there is no printers.json yet, so tickets are written to the log, not printed:\n  ${paths.printers}`);
    out(`Log: ${node_path_1.default.join(paths.logs, 'agent.log')}`);
};
const uninstall = async () => {
    (0, windowsService_1.requireWindows)();
    await (0, windowsService_1.requireElevation)('Uninstalling');
    const removed = await (0, windowsService_1.uninstallTask)();
    out(removed ? 'Stopped, and removed from boot.' : 'The agent was not installed.');
    out(`Its settings, queue and log are kept in ${(0, home_1.resolveHome)()}. Delete that folder to remove them.`);
};
const status = async () => {
    const home = (0, home_1.resolveHome)();
    const paths = (0, home_1.homePaths)(home);
    const settings = (0, config_1.readSettings)(paths.settings);
    out(`RMS print agent ${(0, config_1.readVersion)()}`);
    out(`Folder:    ${home}`);
    out(`Enrolled:  ${settings ? `yes — "${settings.deviceName}" for ${settings.restaurantName || 'a restaurant'} (${settings.serverUrl})` : 'no'}`);
    out(`Token:     ${node_fs_1.default.existsSync(paths.credentials) ? 'saved' : 'missing'}`);
    out(`Printers:  ${node_fs_1.default.existsSync(paths.printers) ? 'printers.json found' : `no printers.json — tickets go to the log (${paths.printers})`}`);
    if (process.platform === 'win32') {
        const task = await (0, windowsService_1.taskStatus)();
        out(`Boot job:  ${task
            ? `${task.state}${task.lastRunTime ? `, last started ${task.lastRunTime}` : ''}${task.lastResult !== undefined ? `, last result ${task.lastResult}` : ''}`
            : `not installed (run: print-agent install)`}`);
    }
    const recent = new logger_1.RotatingLog(paths.logs).tail(8);
    if (recent.length > 0) {
        out();
        out('Recent log:');
        recent.forEach((line) => out(`  ${line}`));
    }
    out();
    out(`(Windows task name: ${windowsService_1.TASK_NAME})`);
};
const main = async () => {
    const [command, ...args] = process.argv.slice(2);
    const home = flag(args, '--home');
    if (home)
        process.env.PRINT_AGENT_HOME = home;
    switch (command) {
        case 'enrol':
        case 'enroll':
            return enrol(args);
        case 'install':
            return install();
        case 'uninstall':
            return uninstall();
        case 'status':
            return status();
        case 'run':
            require('./index');
            return;
        default:
            out(USAGE);
            process.exitCode = command ? 1 : 0;
    }
};
main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
});
