const { writeFileSync } = require('node:fs');
const { RTCDataChannel } = require('werift');

const output = process.env.LIVESYNC_BENCH_DATACHANNEL_JSON;
if (!output) throw new Error('LIVESYNC_BENCH_DATACHANNEL_JSON is required');
const channels = new Set();
const originalSend = RTCDataChannel.prototype.send;
RTCDataChannel.prototype.send = function (...args) {
    channels.add(this);
    return originalSend.apply(this, args);
};
process.once('exit', () => {
    const rows = [...channels].map((channel) => ({ label: channel.label, payloadBytesSent: channel.bytesSent, messagesSent: channel.messagesSent }));
    const cpu = process.cpuUsage();
    writeFileSync(output, JSON.stringify({
        source: 'werift 0.24.4 RTCDataChannel counters; observed channels through a benchmark-only preload',
        scope: 'Application DataChannel payload; includes application retransmissions, excludes SCTP/DTLS/UDP/IP overhead, transport retransmissions, and relay signalling',
        payloadBytesSent: rows.reduce((sum, row) => sum + row.payloadBytesSent, 0),
        messagesSent: rows.reduce((sum, row) => sum + row.messagesSent, 0),
        processUsage: { userCpuMs: cpu.user / 1000, systemCpuMs: cpu.system / 1000, maxResidentSetKiB: process.resourceUsage().maxRSS },
        channels: rows,
    }, null, 2));
});
