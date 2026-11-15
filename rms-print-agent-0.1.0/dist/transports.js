"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.realTransports = exports.sendToWindowsPrinter = exports.checkWindowsPrinter = exports.queryNetworkPrinterStatus = exports.blockingReason = exports.parseStatusBytes = exports.sendToNetworkPrinter = void 0;
const node_child_process_1 = require("node:child_process");
const node_fs_1 = __importDefault(require("node:fs"));
const node_net_1 = __importDefault(require("node:net"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const printer_1 = require("./printer");
// ---------------------------------------------------------------------------
// Network printers: raw bytes on TCP (9100 for nearly every receipt printer)
// ---------------------------------------------------------------------------
const unreachable = (host, port, error) => new Error(`Cannot reach the printer at ${host}:${port} (${error.code ?? error.message})`);
/**
 * Sends a ticket to a network printer.
 *
 * Resolves once the bytes have been handed to the connection, not when paper
 * comes out: a network printer says nothing back. If the printer closes the
 * connection politely, or goes quiet, after taking the data, that is not a
 * failure — the ticket is already with it, and retrying would print a second
 * copy. A reset is different: see the error handler.
 */
const sendToNetworkPrinter = (host, port, data, { timeoutMs = 10_000, graceMs = 1_000 } = {}) => new Promise((resolve, reject) => {
    const socket = node_net_1.default.createConnection({ host, port });
    let sent = false;
    let settled = false;
    let grace;
    const settle = (error) => {
        if (settled)
            return;
        settled = true;
        clearTimeout(grace);
        socket.destroy();
        if (error)
            reject(error);
        else
            resolve();
    };
    socket.setTimeout(timeoutMs);
    socket.on('timeout', () => settle(sent ? undefined : new Error(`The printer at ${host}:${port} did not respond`)));
    socket.on('error', (error) => {
        // A printer that is done closes politely. One that RESETS the connection
        // is refusing us (typically busy with another client), so the ticket may
        // not have been taken and must be tried again.
        const refused = error.code === 'ECONNRESET' || error.code === 'EPIPE';
        settle(sent && !refused ? undefined : unreachable(host, port, error));
    });
    socket.on('close', () => settle(sent ? undefined : new Error(`The printer at ${host}:${port} closed the connection`)));
    socket.on('connect', () => {
        socket.end(data, () => {
            sent = true;
            // Give the printer a moment to take it in before we hang up.
            grace = setTimeout(() => settle(), graceMs);
        });
    });
});
exports.sendToNetworkPrinter = sendToNetworkPrinter;
const UNKNOWN_STATUS = {
    known: false,
    online: true,
    coverOpen: false,
    paperOut: false,
    paperLow: false,
    error: false,
};
/** ESC/POS real-time status requests (DLE EOT n) for: printer, offline cause, error cause, paper sensor. */
const STATUS_REQUESTS = Buffer.from([0x10, 0x04, 1, 0x10, 0x04, 2, 0x10, 0x04, 3, 0x10, 0x04, 4]);
/**
 * Reads the four status bytes a printer answers DLE EOT with.
 *
 * Every real reply has bits 0 and 7 clear and bits 1 and 4 set. A reply that
 * does not look like that is not a status byte at all (a printer that echoes
 * or garbles it), and is treated as "no answer" rather than as a fault.
 */
const parseStatusBytes = (bytes) => {
    if (bytes.length < 4)
        return UNKNOWN_STATUS;
    const [printer, offline, errors, paper] = [bytes[0], bytes[1], bytes[2], bytes[3]];
    if (![printer, offline, errors, paper].every((b) => (b & 0x93) === 0x12))
        return UNKNOWN_STATUS;
    return {
        known: true,
        online: (printer & 0x08) === 0,
        coverOpen: (offline & 0x04) !== 0,
        paperOut: (offline & 0x20) !== 0 || (paper & 0x60) !== 0,
        paperLow: (paper & 0x0c) !== 0,
        error: (offline & 0x40) !== 0 || (errors & 0x6c) !== 0,
    };
};
exports.parseStatusBytes = parseStatusBytes;
/**
 * Why a ticket should not be sent to this printer right now, if there is a
 * reason. A network printer takes the bytes whether or not it has paper, so
 * without this a ticket for an empty printer would count as printed.
 */
const blockingReason = (status) => {
    if (!status.known)
        return undefined;
    if (status.coverOpen)
        return 'The printer cover is open';
    if (status.paperOut)
        return 'The printer is out of paper';
    if (status.error)
        return 'The printer reports an error';
    if (!status.online)
        return 'The printer is offline';
    return undefined;
};
exports.blockingReason = blockingReason;
/** Asks a network printer how it is. Throws if it cannot be reached; resolves "unknown" if it simply does not answer. */
const queryNetworkPrinterStatus = (host, port, { timeoutMs = 1_500 } = {}) => new Promise((resolve, reject) => {
    const socket = node_net_1.default.createConnection({ host, port });
    const chunks = [];
    let connected = false;
    let settled = false;
    const settle = (result) => {
        if (settled)
            return;
        settled = true;
        socket.destroy();
        if (result instanceof Error)
            reject(result);
        else
            resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.on('connect', () => {
        connected = true;
        socket.write(STATUS_REQUESTS);
    });
    socket.on('data', (chunk) => {
        chunks.push(chunk);
        if (Buffer.concat(chunks).length >= 4)
            settle((0, exports.parseStatusBytes)(Buffer.concat(chunks)));
    });
    socket.on('timeout', () => settle(connected ? (0, exports.parseStatusBytes)(Buffer.concat(chunks)) : new Error(`The printer at ${host}:${port} did not respond`)));
    socket.on('error', (error) => settle(unreachable(host, port, error)));
    socket.on('close', () => settle(connected ? (0, exports.parseStatusBytes)(Buffer.concat(chunks)) : new Error(`The printer at ${host}:${port} closed the connection`)));
});
exports.queryNetworkPrinterStatus = queryNetworkPrinterStatus;
// ---------------------------------------------------------------------------
// USB printers: raw bytes through the Windows print spooler
// ---------------------------------------------------------------------------
/**
 * Windows hands a USB printer's bytes to its driver, which for a receipt
 * printer would try to render them as a page. The spooler's RAW data type
 * skips that and passes the bytes straight through — what ESC/POS needs.
 *
 * There is no built-in command for it, so a few lines of PowerShell call the
 * spooler (winspool.drv) directly. Nothing to install; PowerShell ships with
 * Windows. Names and file paths travel in environment variables, never pasted
 * into the script, so a printer called `O'Brien "Bar"` cannot break out of it.
 */
const EXIT_NOT_FOUND = 3;
const EXIT_NOT_READY = 4;
const PREAMBLE = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
`;
/** Is the printer installed, and does Windows think it is ready? Exits 3 or 4 if not. */
const CHECK_STEP = `
try {
  $printer = Get-Printer -Name $env:PRINT_AGENT_PRINTER -ErrorAction Stop
} catch {
  [Console]::Error.WriteLine('No printer named "' + $env:PRINT_AGENT_PRINTER + '" is installed in Windows')
  exit ${EXIT_NOT_FOUND}
}
$bad = @('Offline','PaperOut','PaperJam','PaperProblem','DoorOpen','Error','NotAvailable','UserIntervention')
$status = [string]$printer.PrinterStatus
if ($printer.WorkOffline -or $bad -contains $status) {
  $why = if ($printer.WorkOffline) { 'offline' } else { $status }
  [Console]::Error.WriteLine('Printer "' + $env:PRINT_AGENT_PRINTER + '" is not ready (' + $why + ')')
  exit ${EXIT_NOT_READY}
}
`;
const SEND_STEP = `
$source = @'
using System;
using System.Runtime.InteropServices;

public static class RawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DocInfo {
    [MarshalAs(UnmanagedType.LPWStr)] public string DocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string OutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string DataType;
  }

  [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern bool OpenPrinter(string name, out IntPtr handle, IntPtr defaults);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool ClosePrinter(IntPtr handle);
  [DllImport("winspool.drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern bool StartDocPrinter(IntPtr handle, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DocInfo doc);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool EndDocPrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool StartPagePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool EndPagePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool WritePrinter(IntPtr handle, byte[] bytes, int count, out int written);

  static void Check(bool ok, string step) {
    if (!ok) throw new Exception(step + " failed (Windows error " + Marshal.GetLastWin32Error() + ")");
  }

  public static void Send(string printer, byte[] bytes) {
    IntPtr handle;
    Check(OpenPrinter(printer, out handle, IntPtr.Zero), "OpenPrinter");
    try {
      DocInfo doc = new DocInfo();
      doc.DocName = "Ticket";
      doc.DataType = "RAW";
      Check(StartDocPrinter(handle, 1, doc), "StartDocPrinter");
      try {
        Check(StartPagePrinter(handle), "StartPagePrinter");
        int written;
        Check(WritePrinter(handle, bytes, bytes.Length, out written), "WritePrinter");
        if (written != bytes.Length) throw new Exception("Only " + written + " of " + bytes.Length + " bytes were accepted");
        Check(EndPagePrinter(handle), "EndPagePrinter");
      } finally {
        EndDocPrinter(handle);
      }
    } finally {
      ClosePrinter(handle);
    }
  }
}
'@
try {
  Add-Type -TypeDefinition $source
  [RawPrinter]::Send($env:PRINT_AGENT_PRINTER, [System.IO.File]::ReadAllBytes($env:PRINT_AGENT_FILE))
} catch {
  [Console]::Error.WriteLine($_.Exception.GetBaseException().Message)
  exit 2
}
`;
const CHECK_SCRIPT = PREAMBLE + CHECK_STEP;
const SEND_SCRIPT = PREAMBLE + CHECK_STEP + SEND_STEP;
const SEND_WITHOUT_CHECK_SCRIPT = PREAMBLE + SEND_STEP;
const requireWindows = () => {
    if (process.platform !== 'win32') {
        throw new printer_1.PermanentPrintError('USB printers (type "windows" in printers.json) only work on Windows');
    }
};
/**
 * PowerShell started with -EncodedCommand wraps some of its own chatter on
 * stderr as CLIXML ("#< CLIXML <Objs ...>"). Keep only the lines we wrote.
 */
const cleanStderr = (stderr) => stderr
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.startsWith('#< CLIXML') && !line.startsWith('<Objs'))
    .join(' ')
    .trim();
const runPowerShell = (script, env, timeoutMs) => new Promise((resolve, reject) => {
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    (0, node_child_process_1.execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-OutputFormat', 'Text', '-EncodedCommand', encoded], { env: { ...process.env, ...env }, timeout: timeoutMs, windowsHide: true }, (error, _stdout, stderr) => {
        if (!error)
            return resolve({ code: 0, stderr: '' });
        const failure = error;
        if (failure.killed)
            return reject(new Error('Windows did not answer in time'));
        if (typeof failure.code === 'number')
            return resolve({ code: failure.code, stderr: cleanStderr(stderr) });
        reject(new Error(`Could not run PowerShell (${failure.code ?? failure.message})`));
    });
});
/**
 * Looks at a Windows printer without printing: is it installed, and is it
 * ready? The spooler happily accepts a job for a printer that is unplugged or
 * out of paper and holds it, which would otherwise count as printed.
 */
const failureFor = (name, code, stderr) => {
    // A name that matches nothing will not start matching by itself.
    if (code === EXIT_NOT_FOUND)
        return new printer_1.PermanentPrintError(stderr || `No printer named "${name}" is installed in Windows`);
    if (code === EXIT_NOT_READY)
        return new Error(stderr || `Printer "${name}" is not ready`);
    return new Error(`Windows printer "${name}": ${stderr || `exit code ${code}`}`);
};
const checkWindowsPrinter = async (name, { timeoutMs = 20_000 } = {}) => {
    requireWindows();
    const { code, stderr } = await runPowerShell(CHECK_SCRIPT, { PRINT_AGENT_PRINTER: name }, timeoutMs);
    if (code !== 0)
        throw failureFor(name, code, stderr);
};
exports.checkWindowsPrinter = checkWindowsPrinter;
/**
 * Sends raw bytes to a Windows printer through the spooler, after checking in
 * the same PowerShell run that it is installed and ready.
 */
const sendToWindowsPrinter = async (name, data, 
// skipCheck exists so a test can drive the spooler step against a printer that
// does not exist, and watch it fail at OpenPrinter. Nothing else sets it.
{ timeoutMs = 30_000, skipCheck = false } = {}) => {
    requireWindows();
    const file = node_path_1.default.join(node_os_1.default.tmpdir(), `print-agent-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.bin`);
    node_fs_1.default.writeFileSync(file, data);
    try {
        const { code, stderr } = await runPowerShell(skipCheck ? SEND_WITHOUT_CHECK_SCRIPT : SEND_SCRIPT, { PRINT_AGENT_PRINTER: name, PRINT_AGENT_FILE: file }, timeoutMs);
        if (code !== 0)
            throw failureFor(name, code, stderr);
    }
    finally {
        node_fs_1.default.rmSync(file, { force: true });
    }
};
exports.sendToWindowsPrinter = sendToWindowsPrinter;
exports.realTransports = {
    sendToNetwork: (host, port, data) => (0, exports.sendToNetworkPrinter)(host, port, data),
    queryNetworkStatus: (host, port) => (0, exports.queryNetworkPrinterStatus)(host, port),
    sendToWindows: (name, data) => (0, exports.sendToWindowsPrinter)(name, data),
};
