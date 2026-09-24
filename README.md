# JunWRT — AW1000 Modern Cellular WebUI & Hot-Deployer

[![Platform](https://img.shields.io/badge/Platform-OpenWrt%20%7C%20AW1000-blue.svg)](https://openwrt.org)
[![Shell](https://img.shields.io/badge/Language-POSIX%20Shell-green.svg)](https://www.gnu.org/software/bash/)
[![License](https://img.shields.io/badge/License-Commercial%20Proprietary-red.svg)](#activation--licensing)

Modern, high-contrast, pure-white WebUI theme and real-time Cellular Cockpit for AW1000 5G OpenWrt routers.

---

## ⚡ 1-Line Quick Installation (No WinSCP Required)

Connect to your router via SSH (PuTTY, Terminal, or Command Prompt) and run this single command:

```sh
wget -qO /tmp/install.sh https://raw.githubusercontent.com/jzkanq/junwrt/main/install_webui_only.sh && sh /tmp/install.sh
```

> **Note:** Internet access on the router is required for this command. The installer does not reboot the router, but it reloads networking and restarts Tailscale and LuCI services, which can briefly interrupt access.

---

## 📖 Newbie Step-by-Step Tutorial

### Step 1: Open SSH Terminal
1. Open **PuTTY** on Windows (or Terminal on macOS/Linux).
2. Host Name: 192.168.1.1 (or your router\'s LAN IP).
3. Port: 22 | Connection type: SSH.
4. Click **Open**.
5. Log in as `root` with your router password.

### Step 2: Paste the 1-Line Installer Command
Copy and right-click in PuTTY to paste:
```sh
wget -qO /tmp/install.sh https://raw.githubusercontent.com/jzkanq/junwrt/main/install_webui_only.sh && sh /tmp/install.sh
```
Press **Enter**. You will see the slant JunWRT banner and installation progress.

### Step 3: Clear Browser Cache & Access WebUI
1. Open your browser and navigate to http://192.168.1.1.
2. Press **Ctrl + Shift + R** (or Cmd + Shift + R on Mac) to perform a hard refresh and purge old LuCI cached files.
3. Enjoy the JunWRT Cockpit with white Light Mode and graphite-gray Dark Mode styling.

---

## 🔑 Activation & Licensing

JunWRT comes with built-in commercial machine-tied licensing:

1. In the WebUI, go to **System** &rarr; **Activation**.
2. Copy your unique **Machine ID** (e.g. AW1K-XXXX-XXXX-XXXX-XXXX).
3. Send your Machine ID to your JunWRT vendor/administrator to issue your License Key.
4. Paste your License Key into the box and click **Activate System**.

---

## 🚀 Key Features

* **⚡ Real-Time Cellular Cockpit Dashboard (3gdetail.js)**:
  - Live signal gauges (RSRP, RSRQ, SINR, RSSI, CQI).
  - Carrier Aggregation (CA) band tracking (Primary + Secondary Component Carriers).
  - Cell ID, eNodeB / gNodeB, Bandwidth, and PCI live monitoring.
* **🎨 Light / Dark Modern Hardware Appliance UI**:
  - Crisp white Light Mode and neutral graphite-gray Dark Mode across all modem sub-pages (Cell Scan, SIM, Band Lock, IMEI, APN, TTL, AT Debug, SMS).
  - High-contrast solid buttons and status badges.
  - Zero eye strain, eliminating dated stock gradients.
* **🛡️ PassWall 2 Modern UI & 1-Click Link Import**:
  - Completely restyled with modern card layout, clean typography, and status badges.
  - 1-Click **"Add Node via Link"** modal supporting `vless://`, `vmess://`, `ss://`, `ssr://`, and `trojan://` sharing URLs.
* **🌐 Tailscale Mesh VPN Engine**:
  - **1-Click Auth Key Login**: Paste your `tskey-auth-...` key and connect instantly in 1–2 seconds.
  - **Sub-Second Web Login**: Fast non-blocking auth URL generation with zero 30s freezes.
  - **Anti-OOM Protection**: Capped at 48MB RAM (`GOMEMLIMIT=48MiB`, `GOGC=15`), preventing daemon memory ballooning and kernel OOM kills.
  - **Direct WireGuard P2P**: Native OpenWrt fw3 (`iptables`) mode with WAN UDP port 41641 open, bypassing slow DERP relay servers.
* **🔒 Configuration scope**:
  - Does not change Wi-Fi SSIDs, Wi-Fi passwords, or modem AT settings.
  - Sets the hostname and LuCI theme, configures Tailscale firewall rules, and reloads networking and related services.
  - Back up the router configuration before installation.
* **💻 Custom Slant Terminal Banner**:
  - Includes custom slant ASCII banner and automatically synchronizes the system hostname to JunWRT.

---

## 📋 Compatibility

* **Hardware**: AW1000 5G Wi-Fi 6 Router (MediaTek MT7981 / MT7915).
* **Firmware**: OpenWrt 21.02 / 23.05 based AW1000 builds with standard LuCI and 3ginfo/modem modules.

---

## 🛠 Manual Offline Installation (Optional)

If your router does not have internet access, you can download install_webui_only.sh to your PC, upload it via WinSCP to /tmp/, and execute:

```sh
sh /tmp/install_webui_only.sh
```

---

## Dark Mode Surface Repair (WebUI Assets Only)

Dark-mode and PassWall 2 surface fixes are included in the existing `install_webui_only.sh`, so users can keep using the same download command and filename. The script packages the updated Argon theme, modem styles, PassWall 2 stylesheet, and its view references alongside the existing JunWRT WebUI bundle. It runs the installer’s normal JunWRT suite setup and does not flash firmware.

After installation, hard-refresh LuCI with **Ctrl + Shift + R** (or **Cmd + Shift + R** on macOS).
