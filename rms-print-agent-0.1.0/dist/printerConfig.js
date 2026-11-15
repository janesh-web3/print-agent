"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parsePrinterConfig = void 0;
const printer_1 = require("./printer");
const normalise = (name) => name.trim().toLowerCase();
const fail = (message) => {
    throw new Error(`printers.json: ${message}`);
};
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const parsePrinter = (label, raw) => {
    if (!isRecord(raw))
        return fail(`"${label}" must be an object.`);
    const columns = raw.columns === undefined ? 48 : raw.columns;
    if (typeof columns !== 'number' || !Number.isInteger(columns) || columns < 24 || columns > 80) {
        fail(`"${label}": columns must be a whole number from 24 to 80 (48 for an 80 mm roll, 32 for 58 mm).`);
    }
    const cut = raw.cut === undefined ? true : raw.cut;
    if (typeof cut !== 'boolean')
        fail(`"${label}": cut must be true or false.`);
    const shared = { columns: columns, cut: cut };
    if (raw.type === 'network') {
        const host = typeof raw.host === 'string' ? raw.host.trim() : '';
        if (!host)
            fail(`"${label}": a network printer needs a host, e.g. "192.168.1.50".`);
        const port = raw.port === undefined ? 9100 : raw.port;
        if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
            fail(`"${label}": port must be a number from 1 to 65535 (receipt printers use 9100).`);
        }
        const statusCheck = raw.statusCheck === undefined ? true : raw.statusCheck;
        if (typeof statusCheck !== 'boolean')
            fail(`"${label}": statusCheck must be true or false.`);
        return { ...shared, target: { type: 'network', host, port: port }, statusCheck: statusCheck };
    }
    if (raw.type === 'windows') {
        const name = typeof raw.name === 'string' ? raw.name.trim() : '';
        if (!name)
            fail(`"${label}": a Windows printer needs the name it has in Windows, e.g. "POS-80".`);
        // The spooler offers no status, so there is nothing to check first.
        return { ...shared, target: { type: 'windows', name }, statusCheck: false };
    }
    return fail(`"${label}": type must be "network" or "windows".`);
};
/** Reads printers.json. Throws a message an installer can act on. */
const parsePrinterConfig = (raw) => {
    if (!isRecord(raw) || !isRecord(raw.printers)) {
        return fail('expected an object with a "printers" section.');
    }
    const entries = Object.entries(raw.printers);
    if (entries.length === 0)
        fail('"printers" is empty — list at least one printer.');
    const printers = new Map();
    for (const [name, config] of entries) {
        const key = normalise(name);
        if (printers.has(key))
            fail(`"${name}" is listed twice (names are not case-sensitive).`);
        printers.set(key, { name, settings: parsePrinter(name, config) });
    }
    let fallback;
    if (raw.default !== undefined) {
        if (typeof raw.default !== 'string' || !printers.has(normalise(raw.default))) {
            fail(`"default" must name one of the listed printers, got ${JSON.stringify(raw.default)}.`);
        }
        fallback = normalise(raw.default);
    }
    else if (printers.size === 1) {
        fallback = [...printers.keys()][0];
    }
    return {
        names: () => [...printers.values()].map((p) => p.name),
        resolve: (name) => {
            const found = (name && printers.get(normalise(name))) || (fallback ? printers.get(fallback) : undefined);
            if (!found) {
                // Retrying cannot conjure up a printer the file does not list.
                throw new printer_1.PermanentPrintError(`No printer is set up for "${name ?? '(none)'}" and printers.json has no default printer.`);
            }
            return found;
        },
    };
};
exports.parsePrinterConfig = parsePrinterConfig;
