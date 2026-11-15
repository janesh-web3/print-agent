"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PRINT_AGENT_EVENTS = void 0;
/**
 * Socket event names shared with the server. The server's copy is
 * PRINT_AGENT in backend/src/constants/socketEvents.ts; protocol.test.ts fails
 * if the two drift apart.
 */
exports.PRINT_AGENT_EVENTS = {
    JOB: 'printAgentJob',
    PRINTED: 'printAgentPrinted',
    FAILED: 'printAgentFailed',
    HEARTBEAT: 'printAgentHeartbeat',
    CONFIG: 'printAgentConfig',
};
