"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_fs_1 = __importDefault(require("node:fs"));
const agent_1 = require("./agent");
const config_1 = require("./config");
const escposPrinter_1 = require("./escposPrinter");
const home_1 = require("./home");
const jobQueue_1 = require("./jobQueue");
const logger_1 = require("./logger");
const printer_1 = require("./printer");
const printerConfig_1 = require("./printerConfig");
const printerSync_1 = require("./printerSync");
const serverLink_1 = require("./serverLink");
const singleInstance_1 = require("./singleInstance");
/**
 * The agent itself: what the background job runs, and what `print-agent run`
 * starts by hand.
 *
 * The venue's printers come from the server, which sends them on connect and
 * whenever they change; the agent keeps a copy in printers.json so it knows them
 * after a power cut before the internet is back. A hand-written printers.json
 * works too, until the server has printers of its own to send.
 *
 * With no printers at all, tickets fail at once with a clear reason. Only
 * PRINT_AGENT_DRY_RUN=true writes them to the log instead, for trying an
 * install out: a real venue must never have tickets quietly "printed" nowhere.
 *
 * Anything unexpected ends the process with a non-zero code on purpose: the
 * background job restarts a failed agent a minute later, which is the right
 * response to a bug nobody is around to see.
 */
/** The venue's printers if printers.json exists, otherwise the log. A file that is wrong stops the agent: printing nowhere quietly would be worse. */
const choosePrinter = (printersPath, log) => {
    if (!node_fs_1.default.existsSync(printersPath)) {
        if (process.env.PRINT_AGENT_DRY_RUN === 'true') {
            log('DRY RUN: tickets will be written to this log, not printed.');
            return new printer_1.ConsolePrinter(log);
        }
        log('No printers known yet. Waiting for the server to send them (Settings, under Printing).');
        return new printerSync_1.NoPrintersPrinter();
    }
    let raw;
    try {
        raw = JSON.parse(node_fs_1.default.readFileSync(printersPath, 'utf8'));
    }
    catch (error) {
        throw new Error(`${printersPath} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    const registry = (0, printerConfig_1.parsePrinterConfig)(raw);
    log(`Printing on: ${registry.names().join(', ')}`);
    return new escposPrinter_1.EscPosPrinter(registry);
};
const main = () => {
    // A .env file beside the agent is optional; real environment variables win.
    try {
        process.loadEnvFile();
    }
    catch {
        // no .env file — fine
    }
    // The log comes first, so that even a failure to start is written somewhere
    // someone can find it later.
    const paths = (0, home_1.homePaths)((0, home_1.resolveHome)());
    const log = (0, logger_1.createLogger)(paths.logs);
    const fail = (message) => {
        log(`FATAL: ${message}`);
        process.exit(1);
    };
    process.on('uncaughtException', (error) => fail(`Unexpected error: ${error.stack ?? error.message}`));
    process.on('unhandledRejection', (reason) => fail(`Unexpected error: ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}`));
    try {
        const config = (0, config_1.loadConfig)();
        log(`Print agent ${config.version} starting, server ${config.serverUrl}, home ${config.home}`);
        const release = (0, singleInstance_1.acquireLock)(paths.lock);
        const printer = new printerSync_1.SwitchablePrinter(choosePrinter(config.printersPath, log));
        const printers = new printerSync_1.PrinterSync(config.printersPath, printer, log);
        const queue = new jobQueue_1.JobQueue(config.dbPath);
        let agent;
        const link = new serverLink_1.SocketServerLink({
            url: config.serverUrl,
            token: config.token,
            agentVersion: config.version,
            stats: () => agent.stats(),
            log,
        });
        link.onConfig((incoming) => printers.apply(incoming));
        agent = new agent_1.PrintAgent(queue, printer, link, { log });
        agent.start();
        const shutdown = () => {
            log('Shutting down');
            agent?.stop();
            queue.close();
            release();
            // Exit 0 is a deliberate stop. Task Scheduler's 5-minute check starts it
            // again if that was not what the owner wanted.
            process.exit(0);
        };
        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);
    }
    catch (error) {
        if (error instanceof singleInstance_1.AlreadyRunningError)
            fail(error.message);
        fail(error instanceof Error ? error.message : String(error));
    }
};
main();
