"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EscPosPrinter = void 0;
const escpos_1 = require("./escpos");
const layout_1 = require("./layout");
const printer_1 = require("./printer");
const transports_1 = require("./transports");
/**
 * Prints tickets on the venue's real printers.
 *
 * Failures split two ways, and the agent treats them differently: a printer
 * that is off, out of paper or unreachable throws a plain Error and the ticket
 * is retried; a ticket that can never print (no such printer in printers.json,
 * a ticket that cannot be laid out) throws PermanentPrintError and is given up
 * on at once.
 */
class EscPosPrinter {
    printers;
    transports;
    constructor(printers, transports = transports_1.realTransports) {
        this.printers = printers;
        this.transports = transports;
    }
    async print(job) {
        const { name, settings } = this.printers.resolve(job.printerName);
        let data;
        try {
            data = (0, escpos_1.encodeEscPos)((0, layout_1.layoutJob)(job, settings.columns), { cut: settings.cut });
        }
        catch (error) {
            throw new printer_1.PermanentPrintError(`Could not lay out the ticket: ${error instanceof Error ? error.message : String(error)}`);
        }
        const { target } = settings;
        if (target.type === 'network') {
            if (settings.statusCheck) {
                const reason = (0, transports_1.blockingReason)(await this.transports.queryNetworkStatus(target.host, target.port));
                if (reason)
                    throw new Error(`${reason} (${name})`);
            }
            await this.transports.sendToNetwork(target.host, target.port, data);
            return;
        }
        // Checks the printer is installed and ready, then sends: one PowerShell start.
        await this.transports.sendToWindows(target.name, data);
    }
}
exports.EscPosPrinter = EscPosPrinter;
