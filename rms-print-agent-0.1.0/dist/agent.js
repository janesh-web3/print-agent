"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PrintAgent = exports.DEFAULT_OPTIONS = void 0;
const printer_1 = require("./printer");
const serverLink_1 = require("./serverLink");
/** How soon to try again to tell the server an outcome it has not heard yet. */
const REPORT_RETRY_MS = 30_000;
exports.DEFAULT_OPTIONS = {
    maxJobAgeMs: 10 * 60 * 1000,
    backoffMs: (attempt) => Math.min(2_000 * 2 ** (attempt - 1), 30_000),
    keepFinishedMs: 7 * 24 * 60 * 60 * 1000,
    now: () => Date.now(),
    log: () => { },
};
class PrintAgent {
    queue;
    printer;
    link;
    options;
    running = false;
    again = false;
    wake;
    lastPrintedAt;
    lastError = null;
    constructor(queue, printer, link, options = {}) {
        this.queue = queue;
        this.printer = printer;
        this.link = link;
        this.options = { ...exports.DEFAULT_OPTIONS, ...options };
    }
    /** What the server is told about this agent at each heartbeat. */
    stats() {
        return {
            pendingJobs: this.queue.pendingCount(),
            lastPrintedAt: this.lastPrintedAt?.toISOString(),
            // The server refuses a longer message, and a refused heartbeat tells it nothing.
            lastError: this.lastError === null ? null : this.lastError.slice(0, 500),
        };
    }
    /** Connects to the server and starts printing what arrives. */
    start() {
        this.queue.prune(this.options.now() - this.options.keepFinishedMs);
        this.link.onJob((job) => {
            this.receive(job);
            this.kick();
        });
        this.link.onConnect(() => this.kick());
        this.link.start();
        // Tickets saved before a restart are due now, connected or not.
        this.kick();
    }
    stop() {
        clearTimeout(this.wake);
        this.link.stop();
    }
    /**
     * Saves a ticket the server sent. Returns false if it was already here.
     * Nothing is printed by this call; see processDue.
     */
    receive(job) {
        if (this.queue.add(job, this.options.now()))
            return true;
        // Seen before. If we had already finished it, the server may have missed
        // our report — say it again rather than print again.
        this.queue.markUnreported(job.jobId);
        return false;
    }
    /** Runs processDue now, and again if more arrives while it is working. */
    kick() {
        this.again = true;
        if (this.running)
            return;
        void this.run();
    }
    async run() {
        this.running = true;
        try {
            while (this.again) {
                this.again = false;
                await this.processDue();
            }
        }
        catch (error) {
            this.options.log(`Unexpected error while printing: ${error instanceof Error ? error.message : String(error)}`);
        }
        finally {
            this.running = false;
            this.scheduleWake();
        }
    }
    /** Prints every ticket that is due, then reports every outcome the server has not heard. */
    async processDue() {
        let queued = this.queue.nextDue(this.options.now());
        while (queued) {
            await this.attempt(queued);
            queued = this.queue.nextDue(this.options.now());
        }
        await this.reportOutstanding();
    }
    async attempt({ job, receivedAt }) {
        const { now, log, maxJobAgeMs, backoffMs } = this.options;
        if (now() - receivedAt > maxJobAgeMs) {
            const last = this.queue.get(job.jobId)?.lastError;
            const reason = last ? `Too old to print — last error: ${last}` : 'Too old to print';
            this.queue.markFailed(job.jobId, reason);
            this.lastError = reason;
            log(`Gave up on ${job.jobId}: ${reason}`);
            return;
        }
        try {
            await this.printer.print(job);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            // No point trying again: say so now, while someone can still act on it.
            if (error instanceof printer_1.PermanentPrintError) {
                this.queue.markFailed(job.jobId, message);
                this.lastError = message;
                log(`Gave up on ${job.jobId}: ${message}`);
                return;
            }
            const attempts = (this.queue.get(job.jobId)?.attempts ?? 0) + 1;
            this.queue.scheduleRetry(job.jobId, now() + backoffMs(attempts), message);
            this.lastError = message;
            log(`Print failed for ${job.jobId} (attempt ${attempts}): ${message}`);
            return;
        }
        this.queue.markPrinted(job.jobId);
        this.lastPrintedAt = new Date(now());
        this.lastError = null;
        log(`Printed ${job.jobId}`);
    }
    /** Tells the server how each finished ticket went. Whatever cannot be sent now stays for next time. */
    async reportOutstanding() {
        for (const queued of this.queue.unreported()) {
            const { job, outcome, lastError } = queued;
            try {
                if (outcome === 'PRINTED')
                    await this.link.reportPrinted(job.jobId);
                else
                    await this.link.reportFailed(job.jobId, lastError ?? 'Failed');
                this.queue.markReported(job.jobId, this.options.now());
            }
            catch (error) {
                if (error instanceof serverLink_1.ReportRejected) {
                    // The server will never accept this one; retrying forever helps nobody.
                    this.queue.markReported(job.jobId, this.options.now());
                    this.options.log(`Server rejected the report for ${job.jobId}: ${error.message}`);
                    continue;
                }
                // Offline, or the server is busy: stop here, the rest would fail too.
                this.options.log(`Could not report ${job.jobId} yet: ${error instanceof Error ? error.message : String(error)}`);
                return;
            }
        }
    }
    /** Wakes the agent when the next print retry falls due, or an unreported outcome is worth sending again. */
    scheduleWake() {
        clearTimeout(this.wake);
        const retryAt = this.queue.nextWakeAt();
        const reportAt = this.queue.unreported().length > 0 ? this.options.now() + REPORT_RETRY_MS : undefined;
        const at = retryAt === undefined ? reportAt : reportAt === undefined ? retryAt : Math.min(retryAt, reportAt);
        if (at === undefined)
            return;
        this.wake = setTimeout(() => this.kick(), Math.max(at - this.options.now(), 0));
        // A pending retry must not keep the process alive on its own.
        this.wake.unref?.();
    }
}
exports.PrintAgent = PrintAgent;
