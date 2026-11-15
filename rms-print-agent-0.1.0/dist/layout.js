"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.layoutJob = exports.createLayout = exports.wrap = exports.money = void 0;
const QTY_W = 3;
/** Width of the label column in "Label: value" rows (the longest is "Table"/"Buyer"). */
const META_LABEL_W = 5;
/** `1,234.50` — grouped, 2 dp, no symbol. The column header carries the unit. */
const money = (value) => {
    const n = Number(value);
    return (Number.isFinite(n) ? n : 0).toLocaleString('en-IN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
};
exports.money = money;
/** Splits text to fit `width`, breaking on spaces where it can. */
const wrap = (text, width) => {
    const words = String(text == null ? '' : text).split(/\s+/).filter(Boolean);
    const lines = [];
    let current = '';
    for (const rawWord of words) {
        let word = rawWord;
        while (word.length > width) {
            if (current) {
                lines.push(current);
                current = '';
            }
            lines.push(word.slice(0, width));
            word = word.slice(width);
        }
        if (!current)
            current = word;
        else if (current.length + 1 + word.length <= width)
            current += ' ' + word;
        else {
            lines.push(current);
            current = word;
        }
    }
    if (current)
        lines.push(current);
    return lines.length > 0 ? lines : [''];
};
exports.wrap = wrap;
const formatClock = (date) => {
    const zone = { timeZone: 'Asia/Kathmandu' };
    const day = date.toLocaleDateString('en-GB', zone);
    const time = date.toLocaleTimeString('en-GB', { ...zone, hour: '2-digit', minute: '2-digit', hour12: false });
    return `${day} ${time}`;
};
/** The layout for one roll width. */
const createLayout = (columns) => {
    const WIDTH = columns;
    const HALF = Math.floor(columns / 2);
    const rule = (char = '-', width = WIDTH) => ({ t: char.repeat(width) });
    /** Label left, figure hard right. */
    const two = (left, right, width = WIDTH) => {
        const r = String(right);
        const l = String(left).slice(0, Math.max(0, width - r.length - 1));
        return { t: l + ' '.repeat(Math.max(1, width - l.length - r.length)) + r };
    };
    /**
     * QTY | ITEM | AMOUNT. The name wraps under itself so the qty and amount
     * columns stay a clean vertical stack however long the item is.
     */
    const itemRow = (qty, name, amount) => {
        const nameW = WIDTH - QTY_W - 1 - amount.length - 1;
        const parts = (0, exports.wrap)(name, nameW);
        const head = String(qty).padEnd(QTY_W).slice(0, QTY_W) + ' ' + parts[0].padEnd(nameW) + ' ' + amount;
        return [{ t: head, b: true }, ...parts.slice(1).map((line) => ({ t: ' '.repeat(QTY_W + 1) + line, b: true }))];
    };
    /** An indented detail line under an item, wrapped to what is left of the roll. */
    const detail = (text, indent = QTY_W + 1) => (0, exports.wrap)(text, WIDTH - indent).map((line) => ({ t: ' '.repeat(indent) + line }));
    /**
     * Shop details, then the ticket badge. A final bill passes no badge of its
     * own — the invoice title is the badge.
     */
    const header = (restaurant, badge, badgeNote) => {
        const segments = [rule('=')];
        if (restaurant?.name) {
            (0, exports.wrap)(restaurant.name.toUpperCase(), HALF).forEach((line) => segments.push({ t: line, c: true, h: true }));
            if (restaurant.address)
                (0, exports.wrap)(restaurant.address, WIDTH).forEach((line) => segments.push({ t: line, c: true }));
            if (restaurant.phone)
                segments.push({ t: `Tel: ${restaurant.phone}`, c: true });
            // Registered businesses print their PAN on the bill; unregistered ones
            // simply have no such line.
            if (restaurant.panNumber)
                segments.push({ t: `PAN No: ${restaurant.panNumber}`, c: true, b: true });
            segments.push(rule('='));
        }
        if (badge) {
            segments.push({ t: badge.toUpperCase(), c: true, b: true });
            if (badgeNote)
                segments.push({ t: badgeNote, c: true });
            segments.push(rule('='));
        }
        return segments;
    };
    /**
     * `Label: value`, labels padded so the values line up; empty values are left
     * out. A long value (a company name, an address) wraps under itself rather
     * than running off the roll — the buyer's name is something IRD wants read.
     */
    const meta = (rows) => {
        const indent = META_LABEL_W + 2;
        return rows
            .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== '')
            .flatMap(([label, value]) => (0, exports.wrap)(value, WIDTH - indent).map((part, index) => ({
            t: index === 0 ? `${label.padEnd(META_LABEL_W)}: ${part}` : ' '.repeat(indent) + part,
        })));
    };
    /** A full bill, with the IRD particulars the server worked out. */
    const buildBill = (bill) => {
        const { items, subtotal, tax, discount, total, invoice } = bill;
        const badgeNote = invoice
            ? [invoice.voided ? 'VOID' : null, (invoice.copyNumber ?? 0) > 0 ? `COPY OF ORIGINAL - ${invoice.copyNumber}` : null]
                .filter(Boolean)
                .join(' / ') || undefined
            : undefined;
        const lines = header(bill.restaurant, invoice?.title, badgeNote);
        lines.push(...meta(invoice
            ? [
                ['Inv', invoice.number],
                ['Table', bill.tableNo],
                ['Date', invoice.dateAD],
                ['Miti', invoice.dateBS],
                ['Buyer', invoice.buyerName],
                ['PAN', invoice.buyerPan],
                ['Addr', invoice.buyerAddress],
            ]
            : [
                ['Bill', bill.billNumber],
                ['Table', bill.tableNo],
                ['Date', formatClock(bill.printedAt)],
            ]));
        lines.push(rule('-'));
        lines.push({ t: 'QTY ITEM' + 'AMOUNT'.padStart(WIDTH - 8), b: true });
        lines.push(rule('-'));
        let units = 0;
        for (const item of items) {
            const unitPrice = item.itemPrice || item.price || 0;
            const addOnPrice = item.addOnPrice || 0;
            const quantity = item.quantity || 1;
            const lineTotal = item.totalPrice || quantity * (unitPrice + addOnPrice);
            units += quantity;
            lines.push(...itemRow(quantity, item.name || 'Unknown Item', (0, exports.money)(lineTotal)));
            // Variation and rate share one line: a separate "Variation:" line costs
            // as much paper as the item itself.
            const parts = [];
            if (item.selectedVariation)
                parts.push(item.selectedVariation);
            if ((quantity > 1 || addOnPrice > 0) && (unitPrice > 0 || addOnPrice > 0)) {
                parts.push(addOnPrice > 0
                    ? `${(0, exports.money)(unitPrice)} + ${(0, exports.money)(addOnPrice)} add-on x ${quantity}`
                    : `${(0, exports.money)(unitPrice)} x ${quantity}`);
            }
            if (parts.length > 0)
                lines.push(...detail(parts.join(' @ ')));
            // Legacy shape, only when the flat field is absent — otherwise the same
            // variation prints twice under different labels.
            if (!item.selectedVariation && item.variations?.length) {
                item.variations.forEach((v) => lines.push(...detail(`${v.name}: ${v.option}`)));
            }
            if (item.addOns?.length) {
                const names = item.addOns.map((a) => (typeof a === 'string' ? a : a.name)).join(', ');
                lines.push(...detail(`+ ${names}`));
            }
            if (item.notes)
                lines.push(...detail(`Note: ${item.notes}`));
        }
        lines.push(rule('-'));
        lines.push(two(`Items: ${items.length}`, `Qty: ${units}`));
        lines.push(rule('-'));
        lines.push(two('Subtotal', (0, exports.money)(subtotal)));
        // A room invoice takes its discount before VAT, as IRD requires.
        const discountFirst = Boolean(invoice?.discountBeforeTax);
        if (discountFirst && discount > 0) {
            lines.push(two('Discount', `-${(0, exports.money)(discount)}`));
            lines.push(two('Taxable amount', (0, exports.money)(subtotal - discount)));
        }
        if (tax > 0)
            lines.push(two(`${invoice ? 'VAT' : 'Tax'}${bill.taxRate ? ` (${bill.taxRate}%)` : ''}`, (0, exports.money)(tax)));
        // The discount block prints the gross total above the deduction so all
        // three figures are on the paper.
        if (discount > 0 && !discountFirst) {
            const gross = subtotal + tax;
            const percent = gross > 0 ? ((discount / gross) * 100).toFixed(1) : '0.0';
            lines.push(rule('-'));
            lines.push(two('Total before disc.', (0, exports.money)(gross)));
            lines.push(two(`Discount (${percent}%)`, `-${(0, exports.money)(discount)}`));
        }
        lines.push(rule('='));
        lines.push({ ...two('TOTAL', (0, exports.money)(total), HALF), h: true });
        lines.push(rule('='));
        if (discount > 0)
            lines.push({ t: `YOU SAVED Rs. ${(0, exports.money)(discount)}`, c: true, b: true });
        const payments = bill.payments.length > 0 ? bill.payments : [{ label: 'Cash' }];
        for (const payment of payments) {
            lines.push(payment.amount !== undefined && payments.length > 1
                ? two(payment.label, (0, exports.money)(payment.amount))
                : two('Payment', payment.label));
        }
        lines.push(rule('-'));
        lines.push({ t: 'Thank you for dining with us!', c: true, b: true });
        lines.push({ t: 'Please visit again', c: true });
        lines.push({ t: `Printed: ${formatClock(bill.printedAt)}`, c: true });
        lines.push(rule('='));
        return lines;
    };
    /**
     * A kitchen or bar ticket. No money at all, and the quantity leads every row
     * in brackets so a cook reading across a pass registers the count first.
     */
    const buildTicket = (order) => {
        const badge = order.ticket === 'COMBINED' ? 'Order Ticket' : order.ticket === 'BOT' ? 'Bar Order Ticket' : 'Kitchen Order Ticket';
        // "These are extras" belongs at the top, not four lines down. It rides
        // alongside the ticket kind so an extra round of drinks still reads as a Bar ticket.
        const badgeNote = [order.originNote, order.isAdditional ? 'ADDITIONAL ITEMS' : undefined, order.isReprint ? 'REPRINT' : undefined]
            .filter(Boolean)
            .join(' · ') || undefined;
        const lines = header(order.restaurant, badge, badgeNote);
        lines.push(...meta([
            ['Order', order.orderNumber],
            ['Table', order.tableNo || 'Takeaway'],
            ['Time', formatClock(order.printedAt)],
        ]));
        lines.push(rule('-'));
        let units = 0;
        let count = 0;
        /** One item block: quantity tag, name, then its modifiers indented under it. */
        const pushItem = (item, isFirst) => {
            if (!isFirst)
                lines.push(rule('-'));
            const quantity = item.quantity || 1;
            units += quantity;
            count += 1;
            const tag = `[${quantity}]`;
            const indent = tag.length + 1;
            const parts = (0, exports.wrap)(String(item.name || 'Unknown Item').toUpperCase(), WIDTH - indent);
            lines.push({ t: `${tag} ${parts[0]}`, b: true });
            parts.slice(1).forEach((line) => lines.push({ t: ' '.repeat(indent) + line, b: true }));
            if (item.selectedVariation)
                lines.push(...detail(`Variation: ${item.selectedVariation}`, indent));
            if (!item.selectedVariation && item.variations?.length) {
                item.variations.forEach((v) => lines.push(...detail(`${v.name}: ${v.option}`, indent)));
            }
            if (item.addOns?.length) {
                const names = item.addOns.map((a) => (typeof a === 'string' ? a : a.name)).join(', ');
                lines.push(...detail(`Add-ons: ${names}`, indent));
            }
            // The special instruction is the line that gets a dish sent back, so it
            // is shouted rather than italicised — a thermal head renders neither.
            if (item.notes) {
                detail(`** ${String(item.notes).toUpperCase()} **`, indent).forEach((line) => lines.push({ ...line, b: true }));
            }
        };
        if (order.ticket === 'COMBINED' && order.sections?.length) {
            // One printer, whole order on one slip: each station's block gets a
            // banner so the kitchen and the bar can find their own lines at a glance.
            order.sections.forEach((section, sectionIndex) => {
                if (sectionIndex > 0)
                    lines.push(rule('-'));
                lines.push({ t: `--- ${section.label.toUpperCase()} ---`, c: true, b: true });
                section.items.forEach((item, index) => pushItem(item, index === 0));
            });
        }
        else {
            order.items.forEach((item, index) => pushItem(item, index === 0));
        }
        lines.push(rule('-'));
        lines.push(two(`Items: ${count}`, `Qty: ${units}`));
        lines.push(rule('='));
        lines.push({ t: '*** END OF ORDER ***', c: true, b: true });
        lines.push({ t: `Printed: ${formatClock(order.printedAt)}`, c: true });
        lines.push(rule('='));
        return lines;
    };
    /**
     * A page to prove a printer works: the restaurant's header, a ruler as wide
     * as the roll (so a wrong width setting shows as a ruler that wraps or falls
     * short), and every style the real tickets use.
     */
    const buildTest = (test) => {
        const ruler = '1234567890'.repeat(Math.ceil(WIDTH / 10)).slice(0, WIDTH);
        return [
            ...header(test.restaurant, 'Printer test'),
            ...meta([
                ['Print', test.printerName],
                ['Time', formatClock(test.printedAt)],
                ['Width', `${WIDTH} columns`],
            ]),
            rule('-'),
            { t: ruler },
            { t: '#'.repeat(WIDTH) },
            rule('-'),
            { t: 'Normal text' },
            { t: 'Bold text', b: true },
            { t: 'Centred text', c: true },
            { t: 'TEST OK', c: true, h: true },
            rule('-'),
            ...(0, exports.wrap)('If you can read this clearly, and the ruler above fits on one line, this printer is set up correctly.', WIDTH).map((line) => ({ t: line })),
            rule('='),
        ];
    };
    return { buildBill, buildTicket, buildTest };
};
exports.createLayout = createLayout;
const toDate = (value) => {
    const date = typeof value === 'string' || typeof value === 'number' ? new Date(value) : new Date();
    return Number.isNaN(date.getTime()) ? new Date() : date;
};
const restaurantInfo = (settings) => settings
    ? { name: settings.restaurantName, address: settings.address, phone: settings.phone, panNumber: settings.panNumber }
    : undefined;
const originNote = (qrSource) => qrSource === 'ROOM' ? 'QR ORDER · ROOM SERVICE' : qrSource === 'TABLE' ? 'QR ORDER · GUEST' : undefined;
const TICKETS = new Set(['KOT', 'BOT', 'COMBINED']);
/**
 * Lays out the ticket the server sent. Throws if it is not something that can
 * be laid out (callers treat that as a ticket to give up on, not retry).
 */
const layoutJob = (job, columns) => {
    const p = job.payload;
    const layout = (0, exports.createLayout)(columns);
    if (job.ticket === 'TEST' || job.type === 'TEST') {
        return layout.buildTest({ printerName: job.printerName, restaurant: restaurantInfo(p.restaurantSettings), printedAt: toDate(p.timestamp) });
    }
    if (job.ticket === 'BILL' || job.type === 'BILL') {
        const payments = Array.isArray(p.paymentMethods) ? p.paymentMethods : [];
        return layout.buildBill({
            billNumber: p.billNumber ?? p.billId,
            tableNo: p.tableNumber,
            items: Array.isArray(p.items) ? p.items : [],
            subtotal: Number(p.subtotal ?? p.total ?? 0),
            tax: Number(p.tax ?? 0),
            taxRate: p.taxRate ? Number(p.taxRate) : undefined,
            discount: Number(p.discount ?? 0),
            total: Number(p.total ?? 0),
            payments: payments.map((m) => ({
                label: String(m.method ?? m.type ?? 'Cash'),
                amount: typeof m.amount === 'number' ? m.amount : undefined,
            })),
            restaurant: restaurantInfo(p.restaurantSettings),
            invoice: p.invoice,
            printedAt: toDate(p.timestamp),
        });
    }
    if (!TICKETS.has(job.ticket))
        throw new Error(`Unknown ticket kind "${job.ticket}"`);
    return layout.buildTicket({
        ticket: job.ticket,
        orderNumber: p.orderNumber,
        tableNo: p.tableNumber,
        isAdditional: job.type === 'ADDITIONAL',
        isReprint: p.isReprint === true,
        originNote: originNote(p.qrSource),
        items: Array.isArray(p.items) ? p.items : [],
        sections: Array.isArray(p.sections)
            ? p.sections.map((s) => ({ label: String(s.label ?? ''), items: Array.isArray(s.items) ? s.items : [] }))
            : undefined,
        restaurant: restaurantInfo(p.restaurantSettings),
        printedAt: toDate(p.timestamp),
    });
};
exports.layoutJob = layoutJob;
