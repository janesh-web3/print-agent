"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConsolePrinter = exports.PermanentPrintError = void 0;
/**
 * A ticket that can never print, however many times it is tried: its printer
 * is not configured, or it cannot be laid out. The agent gives up on it at once
 * and says why, instead of retrying it for ten minutes.
 */
class PermanentPrintError extends Error {
}
exports.PermanentPrintError = PermanentPrintError;
/**
 * Writes the ticket to a log instead of a printer. Stands in until the real
 * ESC/POS printers land, and doubles as a dry run for checking an install:
 * if tickets show up here, the whole path from the server to the agent works.
 */
class ConsolePrinter {
    log;
    constructor(log = console.log) {
        this.log = log;
    }
    async print(job) {
        const payload = job.payload;
        const reference = payload.orderNumber ?? payload.billNumber ?? job.eventId;
        this.log(`--- ${job.ticket} ${job.type} #${reference} · table ${payload.tableNumber ?? '-'} · ${job.printerName ?? 'default printer'}`);
        for (const item of payload.items ?? []) {
            this.log(`    ${item.quantity ?? 1} x ${item.name ?? 'Item'}${item.notes ? `  (${item.notes})` : ''}`);
        }
    }
}
exports.ConsolePrinter = ConsolePrinter;
