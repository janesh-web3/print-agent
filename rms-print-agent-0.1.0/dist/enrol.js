"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.enrolAgent = void 0;
const config_1 = require("./config");
const credentials_1 = require("./credentials");
const home_1 = require("./home");
const TOKEN_PATTERN = /^pa_[0-9a-f]{64}$/;
const asString = (value) => (typeof value === 'string' ? value : '');
const enrolAgent = async ({ serverUrl, code, home, agentVersion, protector, fetchImpl = fetch }) => {
    let base;
    try {
        base = new URL(serverUrl);
        if (base.protocol !== 'http:' && base.protocol !== 'https:')
            throw new Error('not http');
    }
    catch {
        throw new Error(`The server address must be a web address like https://api.example.com, got "${serverUrl}".`);
    }
    const normalisedServer = `${base.protocol}//${base.host}`;
    let response;
    try {
        response = await fetchImpl(new URL('/api/print-agent/enrol', normalisedServer), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ code, agentVersion }),
            signal: AbortSignal.timeout(20_000),
        });
    }
    catch (error) {
        throw new Error(`Cannot reach the server at ${normalisedServer} (${error instanceof Error ? error.message : String(error)}). Check the address and the internet connection.`);
    }
    if (response.status === 401)
        throw new Error('That enrolment code is not valid, has expired, or was already used. Ask for a new one.');
    if (response.status === 429)
        throw new Error('Too many attempts from this address. Wait 15 minutes and try again.');
    if (!response.ok)
        throw new Error(`The server refused the enrolment (HTTP ${response.status}).`);
    const body = (await response.json().catch(() => undefined));
    const data = body?.data;
    const token = asString(data?.token);
    if (!data || !TOKEN_PATTERN.test(token))
        throw new Error('The server answered, but not with a token. Is this the right server address?');
    const paths = (0, home_1.homePaths)(home);
    (0, credentials_1.saveToken)(paths.credentials, token, protector);
    const settings = {
        serverUrl: normalisedServer,
        deviceId: asString(data.deviceId),
        deviceName: asString(data.deviceName),
        restaurantId: asString(data.restaurantId),
        restaurantName: asString(data.restaurantName),
        enrolledAt: new Date().toISOString(),
    };
    (0, config_1.writeSettings)(paths.settings, settings);
    return settings;
};
exports.enrolAgent = enrolAgent;
