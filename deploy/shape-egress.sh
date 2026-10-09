#!/usr/bin/env bash
set -euo pipefail
device="${1:-}"
if [[ -z "$device" || ! "$device" =~ ^[a-zA-Z0-9_.:-]+$ || ! -d "/sys/class/net/$device" ]]; then
  echo "Usage: sudo bash shape-egress.sh <interface> [--apply]" >&2; exit 2
fi
apply="${2:-}"
run() { if [[ "$apply" == "--apply" ]]; then "$@"; else printf '%q ' "$@"; printf '\n'; fi; }
if [[ "$apply" == "--apply" ]]; then
  [[ "$EUID" == 0 ]] || { echo "Root privileges required" >&2; exit 1; }
  # Do not overwrite an existing custom traffic policy.
  if tc qdisc show dev "$device" | grep -Eq 'htb|tbf|cake|netem'; then
    echo "Existing traffic policy found; integrate the classes manually." >&2; exit 1
  fi
fi
run tc qdisc add dev "$device" root handle 1: htb default 10
run tc class add dev "$device" parent 1: classid 1:1 htb rate 5mbit ceil 5mbit
run tc class add dev "$device" parent 1:1 classid 1:10 htb rate 1500kbit ceil 5mbit prio 0
run tc class add dev "$device" parent 1:1 classid 1:20 htb rate 3500kbit ceil 3500kbit prio 1
run iptables -t mangle -A OUTPUT -p udp --sport 3478 -j MARK --set-mark 20
run iptables -t mangle -A OUTPUT -p udp --sport 49160:49200 -j MARK --set-mark 20
run iptables -t mangle -A OUTPUT -p tcp --sport 3478 -j MARK --set-mark 20
run tc filter add dev "$device" parent 1: protocol ip prio 1 handle 20 fw flowid 1:20
# IPv6 must obey the same aggregate ceiling.
run ip6tables -t mangle -A OUTPUT -p udp --sport 3478 -j MARK --set-mark 20
run ip6tables -t mangle -A OUTPUT -p udp --sport 49160:49200 -j MARK --set-mark 20
run ip6tables -t mangle -A OUTPUT -p tcp --sport 3478 -j MARK --set-mark 20
run tc filter add dev "$device" parent 1: protocol ipv6 prio 1 handle 20 fw flowid 1:20
