"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SocketServerLink = exports.ReportRejected = void 0;
const socket_io_client_1 = require("socket.io-client");
const protocol_1 = require("./protocol");
/**
 * The server heard the report and said no, and saying it again will not help
 * (the job does not exist, or the report was malformed). Distinct from a
 * network failure, which is worth retrying.
 */
class ReportRejected extends Error {
}
exports.ReportRejected = ReportRejected;
/** Server replies that mean "do not send this again". Anything else may pass. */
const PERMANENT_REJECTIONS = new Set(['Unknown job', 'Invalid report']);
/** How long to wait before knocking again after the server refuses the connection. */
const REFUSED_RETRY_MS = 30_000;
const isAgentJob = (value) => {
    const job = value;
    return (typeof job === 'object' &&
        job !== null &&
        typeof job.jobId === 'string' &&
        job.jobId.length > 0 &&
        typeof job.payload === 'object' &&
        job.payload !== null);
};
class SocketServerLink {
    options;
    socket;
    heartbeat;
    refusedRetry;
    jobHandlers = [];
    connectHandlers = [];
    configHandlers = [];
    constructor(options) {
        this.options = options;
    }
    onJob(handler) {
        this.jobHandlers.push(handler);
    }
    onConnect(handler) {
        this.connectHandlers.push(handler);
    }
    onConfig(handler) {
        this.configHandlers.push(handler);
    }
    start() {
        const { url, token, heartbeatMs = 30_000 } = this.options;
        const log = this.options.log ?? (() => { });
        const socket = (0, socket_io_client_1.io)(url, {
            auth: { deviceToken: token },
            // WebSocket first; long-polling if the venue's network or the server's
            // host will not carry one (shared hosting and some proxies do not), the
            // same fallback the staff screens have. Without it an agent behind such a
            // host enrols over plain HTTP and then never receives a ticket.
            transports: ['websocket', 'polling'],
            tryAllTransports: true,
            reconnection: true,
            reconnectionDelay: 1_000,
            reconnectionDelayMax: 30_000,
        });
        this.socket = socket;
        const sendHeartbeat = () => {
            socket.emit(protocol_1.PRINT_AGENT_EVENTS.HEARTBEAT, { agentVersion: this.options.agentVersion, ...this.options.stats?.() });
        };
        socket.on('connect', () => {
            log('Connected to the server');
            sendHeartbeat(); // so the server knows how we are the moment we are back, not 30s later
            this.connectHandlers.forEach((handler) => handler());
        });
        socket.on('disconnect', (reason) => log(`Disconnected from the server (${reason})`));
        socket.on('connect_error', (error) => {
            log(`Could not connect: ${error.message}`);
            // socket.io retries by itself after a network drop, but not after the
            // server refuses the handshake. A refusal can be momentary (the server
            // restarting, its database away), so keep knocking, slowly.
            if (!socket.active) {
                clearTimeout(this.refusedRetry);
                this.refusedRetry = setTimeout(() => socket.connect(), REFUSED_RETRY_MS);
            }
        });
        socket.on(protocol_1.PRINT_AGENT_EVENTS.CONFIG, (config) => {
            this.configHandlers.forEach((handler) => handler(config));
        });
        socket.on(protocol_1.PRINT_AGENT_EVENTS.JOB, (job) => {
            if (!isAgentJob(job)) {
                log('Ignored a malformed ticket from the server');
                return;
            }
            this.jobHandlers.forEach((handler) => handler(job));
        });
        this.heartbeat = setInterval(() => {
            if (socket.connected)
                sendHeartbeat();
        }, heartbeatMs);
    }
    stop() {
        clearInterval(this.heartbeat);
        clearTimeout(this.refusedRetry);
        this.socket?.disconnect();
    }
    reportPrinted(jobId) {
        return this.report(protocol_1.PRINT_AGENT_EVENTS.PRINTED, { jobId });
    }
    reportFailed(jobId, reason) {
        return this.report(protocol_1.PRINT_AGENT_EVENTS.FAILED, { jobId, reason: reason.slice(0, 500) });
    }
    async report(event, payload) {
        const { ackTimeoutMs = 10_000 } = this.options;
        if (!this.socket?.connected)
            throw new Error('Not connected to the server');
        const response = (await this.socket.timeout(ackTimeoutMs).emitWithAck(event, payload));
        if (response?.ok)
            return;
        const reason = response?.error ?? 'No reply';
        throw PERMANENT_REJECTIONS.has(reason) ? new ReportRejected(reason) : new Error(reason);
    }
}
exports.SocketServerLink = SocketServerLink;
