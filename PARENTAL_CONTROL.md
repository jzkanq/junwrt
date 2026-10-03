# JunWRT Parental Control

Run `sh /tmp/install_parental_control.sh` as root after copying the scoped installer to the router, then open **Modem → Parental Control**. The scoped installer backs up existing sources/configuration and restarts only this service and rpcd. The full `install_webui_only.sh` also includes these assets. No device is restricted until you save an enabled profile. Existing profiles survive installer upgrades.

1. **Basic info:** select a DHCP device or enter its MAC and name. Keep the device's Wi-Fi MAC stable. Editing keeps its MAC identity; remove and add a profile to change the device.
2. **Filter level:** Child (suggested age 6–12) uses CleanBrowsing Family; Teen (13–17) uses CleanBrowsing Adult. Ages are suggested presets, not age verification. Time-only applies no filter. Games/social apps are not generally blocked, and individual-app permissions are not available. Provider descriptions: https://cleanbrowsing.org/filters .
3. **Time control:** choose allowed days and start/end times in the router timezone. End time is exclusive. An overnight window belongs to its start day: Saturday 22:00–06:00 ends Sunday morning. Other days are blocked. Turn off the schedule for all-day access; disable device control to remove restrictions.

The procd service evaluates schedules every five seconds and restores owned chains after firewall restarts. MAC rules precede established-session acceptance; DNS redirects precede other NAT rules. Schedule blocking covers IPv4/IPv6 forwarding; Wi-Fi, DHCP, router DNS and LuCI remain available. Forwarding back to `br-lan` stays available; other LAN bridges are subject to the policy.

Filtered devices use forced plain IPv4 DNS (TCP/UDP 53), have TCP/UDP 853 blocked and forwarded IPv6 disabled to prevent an unfiltered IPv6 path. Their DNS uses CleanBrowsing instead of the router Ad Blocker. Global dnsmasq settings are unchanged.

HTTPS private DNS, VPNs, router proxies on permitted management ports, changed MACs and mobile data can bypass controls. DNS filtering is not a daily usage quota or complete content protection. Scheduled devices fail closed when the router year is earlier than 2025; this is a clock sanity check, not verification of NTP synchronization. Configure router time and NTP correctly.

**AW1000 runtime acceptance is required.** MediaTek hardware NAT may bypass firewall processing, including existing accelerated connections. The page warns when `mtk_warp` is loaded; the implementation does not unload vendor modules or change global offload defaults. Successful rule installation does not establish accelerated-traffic enforcement. The firmware generator includes the new assets, but the firmware image has not been rebuilt.

## Router acceptance

- Use a spare client and keep a separate administrator device available. Save a profile and wait for **Rules applied**.
- Check filtered DNS and an unmanaged device's existing DNS behavior.
- Run a long download, video and VPN; cross the end boundary. New and existing IPv4/IPv6 internet sessions must stop within five seconds while Wi-Fi and LuCI remain available. Repeat with hardware NAT active; a surviving session is an enforcement failure.
- Test the next allowed boundary, overnight/week rollover, firewall reload, network reconnect and reboot. Verify an unmanaged device stays online.
- Check manual external DNS, DNS over TLS, HTTPS private DNS and a changed MAC against the documented limits. Remove the profile and confirm access returns.
- Check Light, Dark and Auto on desktop/mobile.

## Validation

Save/UI repair (2026-10-02): named profiles now use the native UCI `set(config, section, type)` API. The CLI regression covers create/read/edit/delete and failed writes. The page has separate Basic info / Filter level / Time control rows, day presets, larger text, high-contrast actions and feedback beside the form. Its static `parental-control-v2.css` filename avoids the old browser cache. Desktop Dark and mobile Light were reviewed locally with the real Argon cascade; the preview uses simulated device data and does not establish router enforcement.

`tools/test_parental_control.py` executes the actual policy with Lua 5.1 via the local `lupa` test dependency. Both firmware gates check the canonical installer, deployment-copy identity, LF endings, menu/ACL and JS syntax. White card/input/secondary surfaces and pale notices have explicit graphite Dark Mode overrides; white action-button text is intentional. Existing views and global theme assets are unchanged.
