"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.encodeEscPos = exports.toPrintableAscii = void 0;
/**
 * Turns laid-out lines into the bytes an ESC/POS thermal printer understands.
 *
 * ESC/POS is the command set nearly every receipt printer speaks (Epson
 * started it; Xprinter, Rongta, Star in ESC/POS mode and the rest copy it).
 * Only the long-standing commands are used, so cheap clones work too.
 */
const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;
const INIT = [ESC, 0x40]; // ESC @  reset the printer
const ALIGN = (mode) => [ESC, 0x61, mode]; // ESC a n  0 left, 1 centre
const BOLD = (on) => [ESC, 0x45, on ? 1 : 0]; // ESC E n
const SIZE = (double) => [GS, 0x21, double ? 0x11 : 0x00]; // GS ! n  double width + height
const FEED = (lines) => [ESC, 0x64, lines]; // ESC d n  feed n lines
const CUT = [GS, 0x56, 66, 0]; // GS V 66 0  feed to the cutter, then partial cut
/**
 * Text the printer's built-in character set can print: plain ASCII.
 *
 * Receipt printers have no Unicode. A few typographic characters that turn up
 * in menus are mapped to their ASCII look-alikes, accents are dropped (é -> e),
 * and anything else (Devanagari, emoji) becomes "?". Printing it as "?" is
 * deliberate: a visibly wrong name gets noticed, a silently missing one does not.
 */
const LOOKALIKES = {
    '‘': "'", '’': "'", '“': '"', '”': '"',
    '–': '-', '—': '-', '•': '*', '·': '-',
    '×': 'x', '…': '...', '₹': 'Rs.', ' ': ' ',
};
const toPrintableAscii = (text) => text
    .replace(/[‘’“”–—•·×…₹ ]/g, (c) => LOOKALIKES[c])
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[^\x20-\x7e]/g, '?');
exports.toPrintableAscii = toPrintableAscii;
const encodeEscPos = (segments, { cut }) => {
    const bytes = [...INIT];
    let centred = false;
    let bold = false;
    let big = false;
    // Only send a style command when the style changes: it keeps the job short
    // and avoids relying on how a clone handles repeated commands.
    const style = (segment) => {
        const wantCentre = Boolean(segment.c);
        const wantBold = Boolean(segment.b || segment.h);
        const wantBig = Boolean(segment.h);
        if (wantCentre !== centred)
            bytes.push(...ALIGN(wantCentre ? 1 : 0));
        if (wantBold !== bold)
            bytes.push(...BOLD(wantBold));
        if (wantBig !== big)
            bytes.push(...SIZE(wantBig));
        centred = wantCentre;
        bold = wantBold;
        big = wantBig;
    };
    for (const segment of segments) {
        style(segment);
        bytes.push(...Buffer.from((0, exports.toPrintableAscii)(segment.t), 'ascii'), LF);
    }
    // Leave the printer as we found it.
    style({ t: '' });
    bytes.push(...FEED(cut ? 4 : 6));
    if (cut)
        bytes.push(...CUT);
    return Buffer.from(bytes);
};
exports.encodeEscPos = encodeEscPos;
