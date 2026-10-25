# JunWRT: High-Performance 5G Firmware & Toolkit for AW1000 / AW1000 Ultra (MediaTek MT6890 / T750)

The 2026-10-15 firmware rebuild includes the current feature modules, Speed Test, Parental Control and Wi-Fi persistence repair. It restores the sanitized antenna-switch service that the older performance script disabled, reapplies packet steering after cellular reconnects and uses canonical WebUI sources instead of older flat deployment copies. The tester's NSA B28+n78 drop from about 300 Mbps to 50–70 Mbps is under investigation; restored throughput still needs a same-device test under load. See [the investigation and acceptance steps](CELLULAR_SPEED_INVESTIGATION.md).

The latest offline stability package is `output/JunWRT_AW1000_Firmware_20261015_stability3`. It preserves custom firewall rules during WebUI installation, prevents duplicate named Tailscale rules and concurrent installers, synchronizes legacy repair scripts, and checks vendor hashes and partition limits before atomic publication. Support rejects incomplete manifests, reads actual procd service state and propagates diagnostics archive failures. Licensing now removes only its owned rules, saves verified keys atomically and reports activation failures accurately; the page has exact command permissions and no unchecked-write fallback. Legacy WebUI migration restarts the firewall to rebuild persistent policy, so temporary rules should be persisted first. Both static gates bind results to the exact image/installer bytes. Read that package's `VALIDATION.md` for checks and tester acceptance; boot and cellular speed remain unverified because only files and tester feedback are available.

The WebUI installer includes **Modem → Speed Test**, a router-side cellular speed test that saves each result with the serving cell and ranks cells by speed (`junwrt-speedtest run` / `towers` over SSH). It runs only when started and uses up to about 260 MB of mobile data per test. While a transfer runs, the dial shows the link's real throughput, read from the cellular interface counters twice a second.

The WebUI installer also adds six opt-in **Modem** pages built from one module list (`junwrt_modules.py`):

- **Connection Guard** re-dials the cellular interface, then restarts the modem radio and optionally reboots when the connection stays down. Off by default.
- **Data Usage** counts the cellular bytes per day and warns before your monthly limit.
- **Notifications** sends Telegram, ntfy or webhook alerts for connection loss, cell changes, data limit, Guard actions, slow speed tests and received SMS.
- **Light Control** turns the front-panel lights off (the vendor lights switch, kept after a reboot), switches single lights off or dims them, and restores the factory behavior. Nothing changes until you press a button; it has not yet been run on a router.
- **Security** reports the factory password, WAN-exposed SSH, UPnP and open Wi-Fi, with two safe one-click fixes.
- **Support** shows the installed build, verifies the installed files against the installer's manifest and creates a redacted diagnostics bundle.

Run `tools\run_checks.ps1` to execute every test and both verification gates. The modules have not yet been run on a router; see AGENTS.md section 14 for what still needs a live check.

The WebUI installer also includes **Modem → Parental Control** for per-device MAC profiles, Child/Teen DNS filters and allowed internet schedules. It is opt-in, supports Light/Dark modes and preserves existing profiles. See [setup and AW1000 runtime acceptance requirements](PARENTAL_CONTROL.md); hardware NAT enforcement still needs router testing.

JunWRT is a customized, optimized, and zero-DRM OpenWrt build specifically engineered for the **AW1000 / AW1000 Ultra / V2 (MediaTek MT6890 / T750 ARM64)** 5G CPE router.

---

## 🌟 Key Fixes & Enhancements in JunWRT

### 1. 🛡️ Complete DRM & Random Reboot Elimination
- **De-fanged `mount_root`**: Binary-patched `/sbin/mount_root` with AArch64 `NOP` sled to completely eliminate the `/proc/ccci_*` verification trap that caused endless preinit bootloops.
- **Removed Authcode Web/Lua Layer**: Stripped `/usr/lib/lua/luci/controller/admin/authcode.lua`, `/usr/lib/lua/luci/view/authcode/`, and removed `luci-app-authcode` from opkg.
- **Removed Time-Bomb & Downloader**: Removed the reboot and remote-download logic from `/etc/init.d/arc_antenna_switch` while preserving its board-specific antenna GPIO and USB helpers under procd supervision.
- **Disabled `modem_watchdog` Reboots**: Replaced `/sbin/modem_watchdog` with a safe monitor that prevents forced reboots during heavy traffic or AT command latency.

### 2. ⚡ High-Speed Cellular Stack & Upload Speed Fix
- **Eliminated 8 Mbps Upload Bottleneck**: `/etc/firewall.user` clamps TCP MSS on the FORWARD chain and adds the rule only when it is missing:
  ```sh
  iptables -t mangle -C FORWARD -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu 2>/dev/null || \
  iptables -t mangle -A FORWARD -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu
  ```
- **Extended Kernel Buffers**: Injected `/etc/sysctl.d/99-junwrt-performance.conf` with 4 MB socket buffers (`rmem_max`/`wmem_max = 4194304`, `tcp_rmem = 4096 87380 4194304`, `tcp_wmem = 4096 65536 4194304`), `netdev_max_backlog = 10000`, `tcp_fastopen = 3` and `nf_conntrack_max = 65536`. TCP MTU probing stays off to protect cellular MSS.
- **Queueing & Congestion Control**: `fq_codel` is the default qdisc. Congestion control stays at the kernel default (cubic); BBR is not available in this 4.19 kernel, so it is not configured.

### 3. 🔥 Hardware NAT (MediaTek WARP) & Thermal Fix
- **Cellular Hotspot TTL**: The TTL page controls IPv4 TTL on client traffic forwarded from `br-lan` to the active cellular WAN; IPv6 Hop Limit is fixed at 64 for the carrier hotspot workaround. LAN Router Advertisements retain the required outer Hop Limit of 255. The service removes duplicate legacy rules and leaves hardware acceleration enabled.
- **Hardware NAT**: MediaTek `mtk_warp` hardware NAT remains available, preventing 90%+ CPU spikes and thermal throttling under gigabit traffic. OpenWrt's generic software and hardware flow offloading stay disabled (`flow_offloading=0`, `flow_offloading_hw=0`) because they stall WireGuard, OpenVPN, PassWall and OpenClash.

### 4. 📶 Native Modem Management CLI (`junwrt-modem`)
Pre-installed at `/usr/bin/junwrt-modem` for native modem control:
- `junwrt-modem info`: Real-time cellular registration, signal metrics (CESQ / RSRP / RSRQ / SINR), active carrier aggregation, 5G option mode, and IMEI.
- `junwrt-modem imei <15-digit IMEI>`: Read or write modem IMEI via `AT+EGMR=1,7,"..."`.
- `junwrt-modem lockband "<band_spec>"`: Lock LTE / 5G bands (e.g. `junwrt-modem lockband '4,1/3/7/28;5,78'`).
- `junwrt-modem unlockband`: Clear all band locks and restore full automatic band selection.
- `junwrt-modem 5gmode <sa|nsa|both|off>`: Switch 5G NR operation mode via `AT+E5GOPT`.
- `junwrt-modem at "<AT_COMMAND>"`: Direct AT command console.
- `junwrt-modem reset-nvdata`: Wipe `/mnt/vendor/nvdata/*` to clear corrupted carrier lock data.

### 5. 💾 Automated eMMC Extroot Storage Expansion
- Pre-installed at `/sbin/setup_extroot_p50.sh`.
- Automatically formats `/dev/mmcblk0p50` as ext4 (if unformatted), migrates current overlay data, and mounts it permanently as `/overlay`.

---

## 📦 Directory Structure

```
d:\JunWRT\
├── build_junwrt.py                    # Automated firmware rebuild pipeline
├── stock.tar                          # Extracted stock rootfs tarball
├── junwrt_root.squashfs               # Repacked JunWRT root filesystem
├── tools\                             # Native SquashFS tools (tar2sqfs, sqfs2tar)
└── output\JunWRT_AW1000_Firmware\     # Complete Flashing Package
    ├── root.squashfs                  # Modified JunWRT rootfs (XZ, 256k block size)
    ├── boot-verified.img              # Signed MediaTek Linux Kernel
    ├── modem-verified.img             # Signed 5G Baseband Firmware
    ├── dsp-verified.bin               # Signed DSP Firmware
    ├── MT6890_openwrt_scatter.xml     # SP Flash Tool scatter partition layout
    ├── MCF_OTA_1.img / MCF_OTA_2.img  # Modem Calibration & Carrier Profiles
    ├── SP_Flash_Tool\                 # MediaTek SP Flash Tool v5.2044
    └── FLASHING_GUIDE.md              # Step-by-step flashing instructions
```

---

## 🚀 Flashing Instructions

Refer to `output/JunWRT_AW1000_Firmware/FLASHING_GUIDE.md` for complete SP Flash Tool (BROM mode) and live SSH flashing steps.
