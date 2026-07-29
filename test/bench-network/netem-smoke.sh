#!/usr/bin/env sh
set -eu

profile="${NETEM_PROFILE:-home-wifi}"
iface="${NETEM_INTERFACE:-eth0}"
delay_ms="${NETEM_DELAY_MS:-20}"
jitter_ms="${NETEM_JITTER_MS:-5}"
loss_percent="${NETEM_LOSS_PERCENT:-0.1}"
bandwidth_mbit="${NETEM_BANDWIDTH_MBIT:-100}"
mtu="${NETEM_MTU:-1500}"
out_root="${NETEM_RESULT_ROOT:-/bench-results}"
timestamp="$(date -u +%Y%m%d-%H%M%S)"
out_dir="${out_root}/netem-smoke-${timestamp}"
out_file="${out_dir}/summary.json"

mkdir -p "$out_dir"

if ! ip link show "$iface" >/dev/null 2>&1; then
    echo "Network interface '$iface' was not found" >&2
    ip addr >&2
    exit 2
fi

ip link set dev "$iface" mtu "$mtu"
tc qdisc del dev "$iface" root >/dev/null 2>&1 || true
tc qdisc add dev "$iface" root netem \
    delay "${delay_ms}ms" "${jitter_ms}ms" \
    loss "${loss_percent}%" \
    rate "${bandwidth_mbit}mbit"

json_lines() {
    awk '
        {
            gsub(/\\/, "\\\\");
            gsub(/"/, "\\\"");
            printf "%s    \"%s\"", (NR == 1 ? "" : ",\n"), $0;
        }
    '
}

ip_addr="$(ip addr show "$iface" | json_lines)"
ip_route="$(ip route | json_lines)"
tc_qdisc="$(tc qdisc show dev "$iface" | json_lines)"

cat > "$out_file" <<EOF
{
  "simulationTier": 2,
  "mode": "netem-smoke",
  "profile": "$profile",
  "interface": "$iface",
  "netem": {
    "delayMs": $delay_ms,
    "jitterMs": $jitter_ms,
    "lossPercent": $loss_percent,
    "bandwidthMbit": $bandwidth_mbit,
    "mtu": $mtu
  },
  "ipAddr": [
$ip_addr
  ],
  "ipRoute": [
$ip_route
  ],
  "tcQdisc": [
$tc_qdisc
  ]
}
EOF

cat "$out_file"
echo "[netem-smoke] result file: $out_file"
