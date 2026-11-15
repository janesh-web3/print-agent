"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.taskStatus = exports.uninstallTask = exports.installTask = exports.lockDownFolder = exports.requireElevation = exports.isElevated = exports.requireWindows = exports.buildTaskXml = exports.TASK_NAME = void 0;
const node_child_process_1 = require("node:child_process");
const node_fs_1 = __importDefault(require("node:fs"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
/**
 * Running the agent as a Windows background job that starts by itself.
 *
 * The agent has to be there after a reboot, a power cut, or a Windows update,
 * with nobody logged in. Windows' Task Scheduler does exactly that and ships
 * with every PC, so there is no service wrapper to download, sign or keep up
 * to date. The task:
 *
 *   - starts at boot, before anyone logs in, as the built-in SYSTEM account;
 *   - is restarted a minute after it fails, up to 999 times;
 *   - is also re-checked every 5 minutes, so an agent that ended cleanly (a
 *     stray "stop") comes back. A task already running ignores the check, so
 *     it can never start a second agent.
 */
exports.TASK_NAME = 'RMS Print Agent';
const SYSTEM_SID = 'S-1-5-18';
const ADMINISTRATORS_SID = 'S-1-5-32-544';
const escapeXml = (value) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const buildTaskXml = ({ command, args, workingDirectory, principal = { kind: 'system' } }) => {
    const system = principal.kind === 'system';
    // Both triggers re-run every 5 minutes: if the agent is not running, this starts it.
    const repetition = '<Repetition><Interval>PT5M</Interval></Repetition>';
    const trigger = system
        ? `<BootTrigger>${repetition}<Enabled>true</Enabled><Delay>PT20S</Delay></BootTrigger>`
        : `<LogonTrigger>${repetition}<UserId>${escapeXml(principal.userId)}</UserId><Enabled>true</Enabled></LogonTrigger>`;
    const who = system
        ? `<UserId>${SYSTEM_SID}</UserId><RunLevel>HighestAvailable</RunLevel>`
        : `<UserId>${escapeXml(principal.userId)}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel>`;
    return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Receives kitchen, bar and bill tickets from the Restaurant Management System and prints them on this venue's printers.</Description>
  </RegistrationInfo>
  <Triggers>
    ${trigger}
  </Triggers>
  <Principals>
    <Principal id="Author">
      ${who}
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <RestartOnFailure>
      <Interval>PT1M</Interval>
      <Count>999</Count>
    </RestartOnFailure>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${escapeXml(command)}</Command>
      <Arguments>${escapeXml(args)}</Arguments>
      <WorkingDirectory>${escapeXml(workingDirectory)}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
`;
};
exports.buildTaskXml = buildTaskXml;
const run = (file, args, timeoutMs = 60_000) => new Promise((resolve, reject) => {
    (0, node_child_process_1.execFile)(file, args, { timeout: timeoutMs, windowsHide: true, encoding: 'utf8' }, (error, stdout, stderr) => {
        if (!error)
            return resolve({ code: 0, stdout, stderr });
        const code = error.code;
        if (typeof code === 'number')
            return resolve({ code, stdout, stderr });
        reject(new Error(`Could not run ${file}: ${error.message}`));
    });
});
const requireWindows = () => {
    if (process.platform !== 'win32')
        throw new Error('Installing the agent as a background job only works on Windows.');
};
exports.requireWindows = requireWindows;
/** Whether this prompt has administrator rights (the test Windows itself uses for `fsutil dirty`). */
const isElevated = async () => {
    if (process.platform !== 'win32')
        return false;
    return (await run('fsutil.exe', ['dirty', 'query', process.env.SystemDrive || 'C:'])).code === 0;
};
exports.isElevated = isElevated;
const ELEVATION_STEPS = 'Open the Start menu, search for "cmd", right-click it and choose "Run as administrator", then run the command again.';
const requireElevation = async (what) => {
    if (!(await (0, exports.isElevated)()))
        throw new Error(`${what} needs administrator rights. ${ELEVATION_STEPS}`);
};
exports.requireElevation = requireElevation;
/**
 * Restricts a folder to the SYSTEM account and administrators. The agent's
 * credentials live here, and by default a folder under ProgramData is readable
 * by every user of the PC. SIDs, not names, so it works on any language of Windows.
 */
const lockDownFolder = async (folder) => {
    (0, exports.requireWindows)();
    node_fs_1.default.mkdirSync(folder, { recursive: true });
    const { code, stderr } = await run('icacls.exe', [
        folder,
        '/inheritance:r',
        '/grant:r',
        `*${SYSTEM_SID}:(OI)(CI)F`,
        `*${ADMINISTRATORS_SID}:(OI)(CI)F`,
    ]);
    if (code !== 0)
        throw new Error(`Could not restrict access to ${folder}: ${stderr.trim() || `icacls exit code ${code}`}`);
};
exports.lockDownFolder = lockDownFolder;
/** Registers the task. `name` exists so a test can use a name of its own and leave the real one alone. */
const installTask = async (options, name = exports.TASK_NAME, { start = true } = {}) => {
    (0, exports.requireWindows)();
    // Task Scheduler wants UTF-16 with a byte-order mark.
    const file = node_path_1.default.join(node_os_1.default.tmpdir(), `print-agent-task-${process.pid}-${Date.now()}.xml`);
    node_fs_1.default.writeFileSync(file, `﻿${(0, exports.buildTaskXml)(options)}`, 'utf16le');
    try {
        const created = await run('schtasks.exe', ['/Create', '/TN', name, '/XML', file, '/F']);
        if (created.code !== 0)
            throw new Error(`Windows would not register the task: ${(created.stderr || created.stdout).trim()}`);
    }
    finally {
        node_fs_1.default.rmSync(file, { force: true });
    }
    if (start) {
        const started = await run('schtasks.exe', ['/Run', '/TN', name]);
        if (started.code !== 0)
            throw new Error(`The task was registered but would not start: ${(started.stderr || started.stdout).trim()}`);
    }
};
exports.installTask = installTask;
/** Stops and removes the task. Returns false if there was none. */
const uninstallTask = async (name = exports.TASK_NAME) => {
    (0, exports.requireWindows)();
    if ((await (0, exports.taskStatus)(name)) === undefined)
        return false;
    await run('schtasks.exe', ['/End', '/TN', name]); // fine if it is not running
    const deleted = await run('schtasks.exe', ['/Delete', '/TN', name, '/F']);
    if (deleted.code !== 0)
        throw new Error(`Could not remove the task: ${(deleted.stderr || deleted.stdout).trim()}`);
    return true;
};
exports.uninstallTask = uninstallTask;
const STATUS_SCRIPT = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$task = Get-ScheduledTask -TaskName $env:PRINT_AGENT_TASK -ErrorAction SilentlyContinue
if (-not $task) { exit 3 }
$info = $task | Get-ScheduledTaskInfo
$last = $null
if ($info.LastRunTime -and $info.LastRunTime.Year -gt 2000) { $last = $info.LastRunTime.ToString('o') }
[Console]::Out.Write((@{ state = [string]$task.State; lastRunTime = $last; lastResult = [int64]$info.LastTaskResult } | ConvertTo-Json -Compress))
`;
/** The task's state, or undefined if it is not installed. Locale-independent (no parsing of schtasks' labels). */
const taskStatus = async (name = exports.TASK_NAME) => {
    if (process.platform !== 'win32')
        return undefined;
    const result = await new Promise((resolve, reject) => {
        (0, node_child_process_1.execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-OutputFormat', 'Text', '-EncodedCommand', Buffer.from(STATUS_SCRIPT, 'utf16le').toString('base64')], { timeout: 30_000, windowsHide: true, encoding: 'utf8', env: { ...process.env, PRINT_AGENT_TASK: name } }, (error, stdout, stderr) => {
            if (!error)
                return resolve({ code: 0, stdout, stderr });
            const code = error.code;
            if (typeof code === 'number')
                return resolve({ code, stdout, stderr });
            reject(new Error(`Could not run PowerShell: ${error.message}`));
        });
    });
    if (result.code === 3)
        return undefined;
    if (result.code !== 0)
        throw new Error(`Could not read the task's state: ${result.stderr.trim() || `exit code ${result.code}`}`);
    const parsed = JSON.parse(result.stdout);
    return { state: parsed.state, lastRunTime: parsed.lastRunTime ?? undefined, lastResult: parsed.lastResult };
};
exports.taskStatus = taskStatus;
