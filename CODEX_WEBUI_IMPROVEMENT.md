# JunWRT WebUI & Universal Dark Mode Architecture: Codex Handover & Improvement Guide

This document is the authoritative engineering specification and context guide for OpenAI Codex (or other AI coding agents) to understand, maintain, refactor, and improve the **JunWRT WebUI Suite** on the **Arcadyan AW1000 Ultra** 5G CPE Router.

---

## 1. Executive Hardware & Software Overview

* **Hardware Appliance**: Arcadyan AW1000 Ultra (High-Performance Carrier-Grade 5G CPE).
* **SoC Platform**: MediaTek MT6890 / T750 (Quad-Core ARM Cortex-A55 @ 2.0 GHz, AArch64).
* **Baseband & Cellular Subsystem**: Fibocom FG360 5G NR Sub-6 modem connected via internal USB 3.0 / PCIe bus.
* **Wi-Fi Subsystem**: MediaTek MT7915 Wi-Fi 6 chipset (Dual-Band 2.4 GHz + 5 GHz 80MHz, 1201 Mbps PHY rate).
* **Operating System**: **OpenWrt 19.07.7** (`r11306-c4a6851c72`, target `mt6890/evb6890v1_64_cpe`).
* **Firewall Framework**: OpenWrt **`fw3` (iptables)** with `/etc/firewall.user` hooks (NOTE: This is NOT `fw4`/nftables).
* **Web Management Engine**: LuCI WebUI (client-side JavaScript MVC architecture, adapted/backported from LuCI modern branch) powered by `uhttpd` and `rpcd`.
* **Primary Theme**: Heavily customized `luci-theme-argon` with the **Modern Hardware Appliance Design System**, white Light Mode surfaces, and neutral graphite Dark Mode.

---

## 2. Inviolable Project Invariants (CRITICAL RULES)

Codex must strictly follow these rules under all circumstances:

1. **Target OpenWrt 19.07.7 / fw3 (iptables) Compatibility**:
   * Never introduce OpenWrt 22.03+ / 23.05+ `nftables` or `fw4` syntax.
   * Any firewall rules, routing hooks, and packet filter configurations must use standard Linux `iptables` / `ip6tables` and `/etc/firewall.user`.

2. **Strict Unix LF (`\n`) Line Endings (0 CRLF)**:
   * Every file inside `stock_rootfs/`, shell scripts, LuCI JavaScript views, Lua templates, and CSS stylesheets must strictly have Unix LF line endings.
   * CRLF will break BusyBox ash parsing, LuCI template evaluation, and causes deployment errors.

3. **ABSOLUTELY NO `.bin` FIRMWARE BUILDS**:
   * Do NOT run `build_junwrt.py` or generate raw NAND flash images (`.bin`).
   * WebUI development and deployment is strictly handled via the standalone hot-deployer script: `install_webui_only.sh`.

4. **Preserve Custom 27KB Cockpit Dashboard (`3gdetail.js`)**:
   * Never overwrite or regress `3gdetail.js` to the 50KB stock version.
   * Preserve all underlying telemetry IDs (`j_stat_op`, `j_stat_mode`, `j_stat_sig`, `j_rx_pwr`, `j_pbar_1` to `j_pbar_4`, `j_scc1_block`, `j_scc2_block`, `j_ca_status`, etc.) and XHR endpoints.

5. **Zero-Flicker Dark Mode Pre-Render Architecture**:
   * The early `<script>` in `<head>` inside `header.htm` that checks `localStorage.getItem('junwrt_theme')` must be preserved.
   * It immediately sets `data-theme="dark"` and `.dark-mode` on `document.documentElement` before the DOM renders to prevent any white-flash flicker (FOUC).

6. **Neutral Graphite Dark Palette**:
   * In Dark Mode, use page `#202124`, cards `#292a2d`, elevated surfaces `#35363a`, borders `#3f4044` / `#5a5d63`, and soft neutral text `#e8eaed` / `#c4c7cc` / `#9aa0a6`.
   * Blue is reserved for primary actions and restrained focus/link accents; it must not tint the overall shell.
   * In Light Mode, white (`#ffffff`) modem surfaces remain supported with slate borders (`#e2e8f0`).

7. **Wi-Fi SSID Invariant**:
   * 2.4 GHz SSID: `JunWRT 2.4G`
   * 5 GHz SSID: `JunWRT 5G`

8. **LuCI Static Resource Invariant**:
   * Never append query parameters (such as `?v=...`) to CSS imports in LuCI JavaScript views (`L.resource()`), because LuCI executes an XMLHttpRequest which treats `?` as an invalid local URL path.

---

## 3. Directory Map & WebUI File Structure

All source files reside inside `d:\JunWRT\stock_rootfs\`:

```
d:\JunWRT\stock_rootfs\
├── etc\
│   ├── openwrt_release       <- Specifies DISTRIB_RELEASE='19.07.7', DISTRIB_TARGET='mt6890/evb6890v1_64_cpe'
│   ├── banner                <- Displays JunWRT 19.07.7, r11306-c4a6851c72
│   └── opkg\distfeeds.conf   <- Official 19.07.7 package feeds for MT6890
├── usr\
│   ├── lib\lua\luci\
│   │   ├── view\
│   │   │   ├── themes\argon\
│   │   │   │   ├── header.htm        <- Early theme detection script, nav bar toggle button
│   │   │   │   ├── footer.htm        <- Carrier branding, theme-reactive container
│   │   │   │   └── sysauth.htm       <- Clean login view with dark/light mode support
│   │   │   ├── passwall2\           <- PassWall 2 modern UI overrides
│   │   │   └── admin_mtk\           <- MTK Wi-Fi overview view
│   │   └── controller\
│   │       ├── mtkwifi.lua           <- MediaTek Wi-Fi controller
│   │       └── passwall2.lua         <- PassWall 2 routing controller
│   └── share\
│       ├── luci\menu.d\
│       │   ├── luci-app-3ginfo-lite.json   <- Modem menu hierarchy (Cockpit + 8 subpages + Settings)
│       │   └── luci-app-junwrt-license.json<- Licensing menu entry
│       └── 3ginfo-lite\
│           └── 3ginfo.sh             <- Shell backend extracting FG360 AT telemetry
└── www\luci-static\
    ├── argon\
    │   ├── css\
    │   │   ├── cascade.css           <- Argon base styles + Modern Hardware Appliance overrides
    │   │   └── dark.css              <- Argon dark stylesheet + neutral graphite overrides
    │   └── img\
    │       ├── argon.svg             <- Appliance SVG logo
    │       └── aw1000.png            <- Hardware photo for status page
    └── resources\
        ├── menu-argon.js             <- Theme switcher click handler + live sync dispatcher
        └── view\
            ├── modem\
            │   ├── 3gdetail.js       <- 27KB Real-Time Baseband Cockpit
            │   ├── 3ginfo-white.css  <- Light-white / dark-graphite appliance stylesheet
            │   ├── 3ginfo-lite.css   <- Synchronized clone of 3ginfo-white.css
            │   ├── junwrt_settings.js<- Theme selector (Light / Dark / Auto) & Telemetry
            │   ├── cellscan.js       <- Modern Cell Scan & Neighboring PCI Lock
            │   ├── lockband.js       <- 4G LTE & 5G NR Band Lock matrix
            │   ├── imei.js           <- IMEI repair & big-number hero card
            │   ├── sim.js            <- SIM card status & IMSI/ICCID telemetry
            │   ├── apn.js            <- APN carrier profile manager
            │   ├── ttl.js            <- Cellular TTL / HL bypass configuration
            │   ├── atdebug.js        <- AT command interactive terminal
            │   └── sms.js            <- SMS messaging client & modern table
            ├── passwall2\
            │   └── passwall2-modern-v2.css <- Cache-renewed PassWall 2 styles with Dark Mode dropdown fixes
            └── tailscale.js          <- Tailscale mesh VPN modern dashboard
```

---

## 4. Dark Mode Architecture: How It Works

### A. Pre-Render Zero-Flicker Initialization
Located in `usr/lib/lua/luci/view/themes/argon/header.htm`:
```html
<link rel="stylesheet" href="<%=media%>/css/cascade.css?v=2.4.4">
<link rel="stylesheet" id="argon-dark-css" href="<%=media%>/css/dark.css?v=2.4.8" media="none">
<script>
    (function() {
        try {
            var savedTheme = localStorage.getItem('junwrt_theme') || 'auto';
            var isDark = false;
            if (savedTheme === 'dark') {
                isDark = true;
            } else if (savedTheme === 'light') {
                isDark = false;
            } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
                isDark = true;
            }
            if (isDark) {
                document.documentElement.setAttribute('data-theme', 'dark');
                document.documentElement.classList.add('dark-mode');
                var darkCss = document.getElementById('argon-dark-css');
                if (darkCss) darkCss.media = 'all';
            } else {
                document.documentElement.setAttribute('data-theme', 'light');
                document.documentElement.classList.remove('dark-mode');
            }
        } catch (e) {}
    })();
</script>
```
* **Why this matters**: In stock themes, JavaScript runs late after `<body>` is painted, causing a white flash. Our implementation runs synchronously in `<head>`, ensuring the first frame uses the selected theme.

### B. Navigation Bar Theme Toggle
* **Element**: `<button id="junwrt-theme-toggle" class="jun-theme-btn">` inside `header.htm`.
* **Behavior**: Displays SVG Moon icon in Light Mode, SVG Sun icon in Dark Mode.
* **Handler**: In `menu-argon.js`, click listener toggles `localStorage.getItem('junwrt_theme')`, switches `media="all"` or `media="none"` on `#argon-dark-css`, toggles `[data-theme="dark"]` and `.dark-mode` on `<html>`, and dispatches:
  ```javascript
  window.dispatchEvent(new CustomEvent('junwrt-theme-changed', { detail: { theme: nextTheme } }));
  ```

### C. Modem Subsection: "JunWRT Settings"
* Route: `admin/modem/junwrt-settings` (Order: 50 in `luci-app-3ginfo-lite.json`).
* Component: `www/luci-static/resources/view/modem/junwrt_settings.js`.
* Features:
  - Three visual mode selection cards: **Light Mode**, **Dark Mode**, **Auto (Follow System)**.
  - Active status pill with real-time feedback.
  - Quick action toggle button.
  - Hardware and network core technical telemetry specs table.

---

## 5. Build, Packaging & Deployment Pipeline

### The Hot-Deployer Script: `install_webui_only.sh`
* Built by: `d:\JunWRT\tools\build_install_webui_sh.py`
* What it does:
  1. Compiles all 59 custom WebUI files into an in-memory tarball (`tar.gz`).
  2. Ensures all text/script files have strict `\n` (0 CRLF).
  3. Base64-encodes the tarball directly into a standalone POSIX shell script.
  4. Automatically distributes the installer to:
     - `C:\Users\Jankin Liew\Downloads\install_webui_only.sh`
     - `d:\JunWRT\github_repo\install_webui_only.sh`
     - `d:\JunWRT\WinSCP_Deploy_Modem\install_webui_only.sh`
     - `d:\JunWRT\output\JunWRT_AW1000_Clean_Release\04_Live_SSH_Installer\install_webui_only.sh`

### How to Run the Installer Builder:
```powershell
python d:\JunWRT\tools\build_install_webui_sh.py
```

### Git Repository & Version Control:
* Path: `d:\JunWRT\github_repo`
* Remote: `origin/main` (`https://github.com/jzkanq/junwrt.git`)
* Command flow after modifying WebUI files:
  ```powershell
  python d:\JunWRT\tools\build_install_webui_sh.py
  cd d:\JunWRT\github_repo
  git add install_webui_only.sh
  git commit -m "feat(webui): update description"
  git push origin main
  ```

---

## 6. Target Areas for Codex Improvements

Codex should focus on the following high-value improvements while maintaining all invariants:

### 1. CSS Architecture & Custom Property Unification
* **Current State**: Styles are divided between `cascade.css`, `dark.css`, and `3ginfo-white.css`, with multiple `!important` color overrides.
* **Goal**: Establish a centralized CSS Custom Property system on `:root` and `[data-theme="dark"]`:
  - `--jw-bg-base`: `#ffffff` (light) / `#202124` (dark)
  - `--jw-bg-surface`: `#ffffff` (light) / `#292a2d` (dark)
  - `--jw-bg-elevated`: `#f8fafc` (light) / `#35363a` (dark)
  - `--jw-border-subtle`: `#e2e8f0` (light) / `#3f4044` (dark)
  - `--jw-border-strong`: `#cbd5e1` (light) / `#5a5d63` (dark)
  - `--jw-text-primary`: `#0f172a` (light) / `#e8eaed` (dark)
  - `--jw-text-secondary`: `#64748b` (light) / `#c4c7cc` (dark)
  - `--jw-accent`: `#0284c7` (both) / `--jw-accent-hover`: `#0369a1`
* Clean up duplicate override rules without breaking specificity.

### 2. High-DPI & Mobile (<768px) Responsive Ergonomics
* Ensure table layouts, action buttons, and telemetry grids gracefully collapse on mobile screens:
  - Cockpit 4-summary cards: 2x2 grid on tablets, 1-column stack on phones (<480px).
  - Band Lock matrix: Touch-friendly 44px min tap targets for band pill buttons.
  - AT Terminal: Responsive scrollable code container with sticky header bar.
  - SMS Inbox: Mobile list card view fallback for table columns.

### 3. Micro-Interactions & State Feedback
* Smooth 150ms transitions on color/background transitions when switching themes.
* Add subtle tactile active/focus ring states (`outline: 2px solid #0284c7; outline-offset: 2px;`) for keyboard navigation accessibility.
* Enhance button loading states with LuCI's `.spinning` icon during asynchronous XHR operations.

### 4. LuCI Form Component Polish
* Modernize remaining legacy LuCI CBI components (e.g. dynamic lists `.cbi-dynlist`, dropdowns `.cbi-dropdown`, modal overlays `.cbi-modal`) so they seamlessly match the hardware appliance card aesthetic.
* Ensure validation error states (`.cbi-input-invalid`) use solid high-contrast crimson (`#ef4444`) with dark mode legible text.

---

## 7. Ready-to-Use Codex Prompt Template

Copy and paste the prompt below directly into Codex when initiating an improvement task:

```text
You are an expert embedded systems WebUI developer and CSS architect working on the JunWRT project for the Arcadyan AW1000 Ultra 5G CPE (MediaTek MT6890 / T750 + MT7915 Wi-Fi 6).

The underlying OS is OpenWrt 19.07.7 (r11306-c4a6851c72) using fw3 (iptables).
You have read and must strictly follow CODEX_WEBUI_IMPROVEMENT.md.

CRITICAL INVARIANTS:
1. Target OpenWrt 19.07.7 / fw3 (iptables). Never introduce fw4/nftables syntax.
2. Every modified file must use strict Unix LF (\n) line endings (0 CRLF).
3. Do NOT generate or run any .bin firmware build commands. WebUI is deployed via install_webui_only.sh.
4. Preserve the 27KB Cockpit Dashboard in 3gdetail.js (do not regress or overwrite with 50KB stock version).
5. Preserve the zero-flicker pre-render script in header.htm.
6. In Dark Mode, use the neutral graphite palette in `AGENTS.md`; white surfaces are Light Mode only. In Light Mode, preserve pure white (#ffffff) appliance styling.
7. After editing files in stock_rootfs, build install_webui_only.sh with `python d:\JunWRT\tools\build_install_webui_sh.py` and commit/push to git in `d:\JunWRT\github_repo`.

TASK:
[Insert your specific task here: e.g. refactor CSS variables, polish mobile layout, improve AT debug terminal, etc.]
```
