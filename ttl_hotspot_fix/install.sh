#!/bin/sh
set -eu

if [ "$(id -u)" != 0 ]; then
	echo "Run this installer as root on the router." >&2
	exit 1
fi

SOURCE_DIR="$(dirname "$0")"
if [ "${1:-}" != "--ttl-only" ] && [ -f "$SOURCE_DIR/../install_webui_only.sh" ]; then
	echo "Running the unified WebUI and TTL hotspot installer..."
	exec /bin/sh "$SOURCE_DIR/../install_webui_only.sh"
fi

for source_file in \
	"$SOURCE_DIR/etc/init.d/3ginfo_ttl" \
	"$SOURCE_DIR/etc/hotplug.d/iface/99-3ginfo-ttl" \
	"$SOURCE_DIR/www/luci-static/resources/view/modem/ttl.js"; do
	if [ ! -f "$source_file" ]; then
		echo "Missing deployment file: $source_file" >&2
		exit 1
	fi
done

BACKUP_DIR="/root/ttl-hotspot-fix-backup-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"

backup_file()
{
	source_path="$1"
	backup_path="$2"
	if [ -f "$source_path" ]; then
		mkdir -p "$BACKUP_DIR/$(dirname "$backup_path")"
		cp -p "$source_path" "$BACKUP_DIR/$backup_path"
	fi
}

backup_file /etc/init.d/3ginfo_ttl etc/init.d/3ginfo_ttl
backup_file /etc/hotplug.d/iface/99-3ginfo-ttl etc/hotplug.d/iface/99-3ginfo-ttl
backup_file /etc/firewall.d/3ginfo_ttl etc/firewall.d/3ginfo_ttl
backup_file /etc/config/firewall etc/config/firewall
backup_file /etc/config/ucitrack etc/config/ucitrack
backup_file /www/luci-static/resources/view/modem/ttl.js www/luci-static/resources/view/modem/ttl.js

mkdir -p /etc/init.d /etc/hotplug.d/iface /etc/firewall.d /www/luci-static/resources/view/modem
cp "$SOURCE_DIR/etc/init.d/3ginfo_ttl" /etc/init.d/3ginfo_ttl
cp "$SOURCE_DIR/etc/hotplug.d/iface/99-3ginfo-ttl" /etc/hotplug.d/iface/99-3ginfo-ttl
cp "$SOURCE_DIR/www/luci-static/resources/view/modem/ttl.js" /www/luci-static/resources/view/modem/ttl.js
chmod 0755 /etc/init.d/3ginfo_ttl /etc/hotplug.d/iface/99-3ginfo-ttl
chmod 0644 /www/luci-static/resources/view/modem/ttl.js

/etc/init.d/3ginfo_ttl enable
/etc/init.d/3ginfo_ttl reload

echo "TTL hotspot fix installed. Backup: $BACKUP_DIR"
echo "IPv4 uses the saved TTL value; IPv6 uses Hop Limit 64 on cellular WAN egress."
echo "LAN Router Advertisements are excluded. Hard-refresh LuCI to reload the TTL page."
