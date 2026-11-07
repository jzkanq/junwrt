# Reserved chains: remove only license-owned jumps/chains, never matching owner rules.
license_chain() {
	"$1" -w 5 -t "$2" -N "$3" 2>/dev/null || "$1" -w 5 -t "$2" -S "$3" >/dev/null 2>&1
}
license_rule() {
	local tool="$1" table="$2" chain="$3"
	shift 3
	"$tool" -w 5 -t "$table" -C "$chain" "$@" 2>/dev/null || \
		"$tool" -w 5 -t "$table" -A "$chain" "$@" 2>/dev/null
}
license_jump() {
	"$1" -w 5 -t "$2" -C "$3" -j "$4" 2>/dev/null || \
		"$1" -w 5 -t "$2" -I "$3" 1 -j "$4" 2>/dev/null
}
license_release_chain() {
	local tool="$1" table="$2" parent="$3" chain="$4"
	"$tool" -w 5 -t "$table" -S "$parent" >/dev/null 2>&1 || return 1
	while "$tool" -w 5 -t "$table" -C "$parent" -j "$chain" 2>/dev/null; do
		"$tool" -w 5 -t "$table" -D "$parent" -j "$chain" 2>/dev/null || return 1
	done
	if "$tool" -w 5 -t "$table" -S "$chain" >/dev/null 2>&1; then
		"$tool" -w 5 -t "$table" -F "$chain" 2>/dev/null || return 1
		"$tool" -w 5 -t "$table" -X "$chain" 2>/dev/null || return 1
	fi
}
license_rule_lock() {
	local mode="$1" result retries=10
	shift
	mkdir -p /var/run || return 1
	command -v flock >/dev/null 2>&1 || return 1
	exec 7>/var/run/junwrt-license.rules.lock || return 1
	# The vendor BusyBox flock supports -n; retry only in the firewall reload path.
	until flock -n 7; do
		if [ "$mode" != reload ] || [ "$retries" -eq 0 ]; then
			exec 7>&-
			return 1
		fi
		retries=$((retries - 1))
		sleep 1
	done
	"$@"
	result=$?
	flock -u 7 || result=1
	exec 7>&-
	return "$result"
}
license_lock_body() {
	local tool reject wan_dev failed=0
	for tool in iptables ip6tables; do
		[ "$tool" != ip6tables ] || command -v "$tool" >/dev/null 2>&1 || continue
		case "$tool" in iptables) reject=icmp-port-unreachable ;; *) reject=icmp6-port-unreachable ;; esac
		license_chain "$tool" filter JUN_LIC_F || { failed=1; continue; }
		license_chain "$tool" filter JUN_LIC_I || { failed=1; continue; }
		license_rule "$tool" filter JUN_LIC_F -i br-lan -j REJECT --reject-with "$reject" || failed=1
		for wan_dev in ccmni0 ccmni1 ccmni2 wwan0 eth1 eth0 rndis0; do
			license_rule "$tool" filter JUN_LIC_F -o "$wan_dev" -j REJECT --reject-with "$reject" || failed=1
		done
		license_rule "$tool" filter JUN_LIC_I -i br-lan -p udp --dport 53 -j REJECT --reject-with "$reject" || failed=1
		license_rule "$tool" filter JUN_LIC_I -i br-lan -p tcp --dport 53 -j REJECT --reject-with tcp-reset || failed=1
		license_jump "$tool" filter FORWARD JUN_LIC_F || failed=1
		license_jump "$tool" filter INPUT JUN_LIC_I || failed=1
	done
	license_chain iptables nat JUN_LIC_N || failed=1
	license_rule iptables nat JUN_LIC_N -i br-lan -p tcp --dport 80 -j DNAT --to-destination 192.168.1.1:80 || failed=1
	license_jump iptables nat PREROUTING JUN_LIC_N || failed=1
	[ "$failed" = 0 ]
}
license_unlock_body() {
	local tool failed=0
	for tool in iptables ip6tables; do
		[ "$tool" != ip6tables ] || command -v "$tool" >/dev/null 2>&1 || continue
		license_release_chain "$tool" filter FORWARD JUN_LIC_F || failed=1
		license_release_chain "$tool" filter INPUT JUN_LIC_I || failed=1
	done
	license_release_chain iptables nat PREROUTING JUN_LIC_N || failed=1
	[ "$failed" = 0 ]
}
