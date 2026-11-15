"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PrinterSync = exports.printersOf = exports.SwitchablePrinter = exports.NoPrintersPrinter = void 0;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const escposPrinter_1 = require("./escposPrinter");
const printer_1 = require("./printer");
const printerConfig_1 = require("./printerConfig");
/**
 * Keeping the agent's printers in step with the server.
 *
 * The venue's printers are defined in the restaurant's settings, not by editing
 * files on this PC. The server sends them when the agent connects and whenever
 * they change. The agent uses them at once and keeps a copy in printers.json,
 * so that after a power cut it knows its printers before the internet is back.
 *
 * A printers.json written by hand still works for a PC the server has nothing
 * for. The server wins as soon as it has printers to send: an empty answer
 * means "nothing set up yet" and leaves a hand-written file alone.
 */
/**
 * What stands in when no printer is known at all. It fails every ticket on the
 * spot, with a reason a person can act on. The alternative, quietly printing
 * to a log and reporting "printed", would tell the server and the kitchen that
 * food orders reached a printer when none exists.
 */
class NoPrintersPrinter {
    async print(_job) {
        throw new printer_1.PermanentPrintError('No printers are set up for this restaurant yet. Add them in Settings, under Printing.');
    }
}
exports.NoPrintersPrinter = NoPrintersPrinter;
/** A printer that can be swapped for another while tickets are flowing through it. */
class SwitchablePrinter {
    current;
    constructor(current) {
        this.current = current;
    }
    use(printer) {
        this.current = printer;
    }
    print(job) {
        return this.current.print(job);
    }
}
exports.SwitchablePrinter = SwitchablePrinter;
/** The text of a printers file, always laid out the same way, so "did anything change?" is a string comparison. */
const canonical = (config) => JSON.stringify(config, null, 2);
const readFile = (file) => {
    try {
        return node_fs_1.default.readFileSync(file, 'utf8');
    }
    catch {
        return undefined;
    }
};
/** Written to a temp name first, so a power cut mid-write cannot leave half a file where the working one was. */
const writeAtomically = (file, contents) => {
    node_fs_1.default.mkdirSync(node_path_1.default.dirname(file), { recursive: true });
    const temp = `${file}.tmp`;
    node_fs_1.default.writeFileSync(temp, contents);
    node_fs_1.default.renameSync(temp, file);
};
const printersOf = (config) => {
    const printers = config?.printers;
    return printers && typeof printers === 'object' ? Object.keys(printers).length : 0;
};
exports.printersOf = printersOf;
class PrinterSync {
    file;
    printer;
    log;
    build;
    constructor(file, printer, log, build = (registry) => new escposPrinter_1.EscPosPrinter(registry)) {
        this.file = file;
        this.printer = printer;
        this.log = log;
        this.build = build;
    }
    /**
     * Handles the printers the server sent. A set the agent cannot use is
     * refused with a log line and the printers it already has stay in place: a
     * bad push must not take down printing that was working.
     */
    apply(config) {
        if ((0, exports.printersOf)(config) === 0)
            return; // nothing set up on the server: leave any local file alone
        let registry;
        try {
            registry = (0, printerConfig_1.parsePrinterConfig)(config);
        }
        catch (error) {
            this.log(`Ignored printers from the server, which this agent cannot use: ${error instanceof Error ? error.message : String(error)}`);
            return;
        }
        this.printer.use(this.build(registry));
        const text = canonical(config);
        if (readFile(this.file) !== text) {
            try {
                writeAtomically(this.file, text);
            }
            catch (error) {
                this.log(`Using the printers from the server, but could not save a copy for next time: ${error instanceof Error ? error.message : String(error)}`);
                return;
            }
            this.log(`Printers updated from the server: ${registry.names().join(', ')}`);
        }
    }
}
exports.PrinterSync = PrinterSync;
