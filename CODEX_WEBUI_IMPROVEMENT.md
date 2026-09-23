# JunWRT WebUI & Universal Dark Mode Architecture: Codex Handover & Improvement Guide

This document is the authoritative engineering specification and context guide for OpenAI Codex (or other AI coding agents) to understand, maintain, refactor, and improve the **JunWRT WebUI Suite** on the **Arcadyan AW1000 Ultra** 5G CPE Router.

---

## 1. Executive Hardware & Software Overview

* **Hardware Appliance**: Arcadyan AW1000 Ultra (High-Performance 5G CPE).
* **SoC Platform**: MediaTek MT6890 / T750 (Quad-Core ARM Cortex-A55 @ 2.0 GHz, AArch64).
* **Baseband & Cellular Subsystem**: Fibocom FG360 5G NR Sub-6 modem connected via internal USB 3.0 / PCIe bus.
* **Wi-Fi Subsystem**: MediaTek MT7915 Wi-Fi 6 chipset (Dual-Band 2.4 GHz + 5 GHz 80MHz, 1201 Mbps PHY rate).
* **Operating System**: OpenWrt 23.05 Carrier-Grade Custom Distribution.
* **Web Management Engine**: LuCI WebUI (LuCI JavaScript client-side MVC architecture) powered by `uhttpd` and `rpcd`.
* **Primary Theme**: Heavily customized `luci-theme-argon` with a custom **Modern Hardware Appliance Design System** and **Universal Forced OLED Pure Black Dark Mode**.

---

## 2. Inviolable Project Invariants (CRITICAL RULES)

Codex must strictly follow these rules under all circumstances:

1. **Strict Unix LF (`\n`) Line Endings (0 CRLF)**:
   * Every file inside `stock_rootfs/`, shell scripts, LuCI JavaScript views, Lua templates, and CSS stylesheets must strictly have Unix LF line endings.
   * CRLF will break BusyBox ash parsing, LuCI template evaluation, and causes deployment errors.

2. **ABSOLUTELY NO `.bin` FIRMWARE BUILDS**:
   * Do NOT run `build_junwrt.py` or generate raw NAND flash images (`.bin`).
   * WebUI development and deployment is strictly handled via the standalone hot-deployer script: `install_webui_only.sh`.

3. **Preserve Custom 27KB Cockpit Dashboard (`3gdetail.js`)**:
   * Never overwrite or regress `3gdetail.js` to the 50KB stock version.
   * Preserve all underlying telemetry IDs (`j_stat_op`, `j_stat_mode`, `j_stat_sig`, `j_rx_pwr`, `j_pbar_1` to `j_pbar_4`, `j_scc1_block`, `j_scc2_block`, `j_ca_status`, etc.) and XHR endpoints.

4. **Zero-Flicker Dark Mode Pre-Render Architecture**:
   * The early `<script>` in `<head>` inside `header.htm` that checks `localStorage.getItem('junwrt_theme')` must be preserved.
   * It immediately sets `data-theme="dark"` and `.dark-mode` on `document.documentElement` before the DOM renders to prevent any white-flash flicker (FOUC).

5. **Universal Forced OLED Pure Black Palette (`#000000`)**:
   * In Dark Mode:
     - Main viewport, body, header, sidebar, footer: `#000000` (pitch black).
     - Cards, containers, sections: `#0a0a0a` or `#0f0f0f` with `#222222` borders.
     - Form inputs, selects, textareas, terminal consoles: `#121212` with `#262626` borders.
     - Table headers: `#121212`, zebra striping: `#0d0d0d`, hover: `#141414`.
     - Neutral / Secondary buttons: `#141414` (border `#2a2a2a`, text `#f5f5f5`, hover `#222222` with Sky Blue accent).
   * In Light Mode:
     - All modem sub-pages and cards must remain pure white (`#ffffff`) with subtle slate borders (`#e2e8f0`).

6. **Wi-Fi SSID Invariant**:
   * 2.4 GHz SSID: `JunWRT 2.4G`
   * 5 GHz SSID: `JunWRT 5G`

7. **LuCI Static Resource Invariant**:
   * Never append query parameters (such as `?v=...`) to CSS imports in LuCI JavaScript views (`L.resource()`), because LuCI executes an XMLHttpRequest which treats `?` as an invalid local URL path.

---

## 3. Directory Map & WebUI File Structure

All source files reside inside `d:\JunWRT\stock_rootfs\`:

```
d:\JunWRT\stock_rootfs\
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
    │   │   └── dark.css              <- Argon dark stylesheet + Universal OLED black overrides
    │   └── img\
    │       ├── argon.svg             <- Appliance SVG logo
    │       └── aw1000.png            <- Hardware photo for status page
    └── resources\
        ├── menu-argon.js             <- Theme switcher click handler + live sync dispatcher
        └── view\
            ├── modem\
            │   ├── 3gdetail.js       <- 27KB Real-Time Baseband Cockpit
            │   ├── 3ginfo-white.css  <- Pure white / OLED black modern appliance stylesheet
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
            │   └── passwall2-modern.css <- Dark mode compatible PassWall 2 styles
            └── tailscale.js          <- Tailscale mesh VPN modern dashboard
```

---

## 4. Dark Mode Architecture: How It Works

### A. Pre-Render Zero-Flicker Initialization
Located in `usr/lib/lua/luci/view/themes/argon/header.htm`:
```html
<link rel="stylesheet" href="<%=media%>/css/cascade.css?v=2.4.3">
<link rel="stylesheet" id="argon-dark-css" href="<%=media%>/css/dark.css?v=2.4.3" media="none">
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
* **Why this matters**: In stock themes, JavaScript runs late after `<body>` is painted, causing a blinding white flash. Our implementation runs synchronously in `<head>`, ensuring the browser paints the very first frame in OLED black.

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
  - `--jw-bg-base`: `#ffffff` (light) / `#000000` (dark)
  - `--jw-bg-surface`: `#ffffff` (light) / `#0a0a0a` (dark)
  - `--jw-bg-elevated`: `#f8fafc` (light) / `#121212` (dark)
  - `--jw-border-subtle`: `#e2e8f0` (light) / `#1f1f1f` (dark)
  - `--jw-border-strong`: `#cbd5e1` (light) / `#262626` (dark)
  - `--jw-text-primary`: `#0f172a` (light) / `#f8fafc` (dark)
  - `--jw-text-secondary`: `#64748b` (light) / `#a3a3a3` (dark)
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

You have read and must strictly follow CODEX_WEBUI_IMPROVEMENT.md.
CRITICAL INVARIANTS:
1. Every modified file must use strict Unix LF (\n) line endings (0 CRLF).
2. Do NOT generate or run any .bin firmware build commands. WebUI is deployed via install_webui_only.sh.
3. Preserve the 27KB Cockpit Dashboard in 3gdetail.js (do not regress or overwrite with 50KB stock version).
4. Preserve the zero-flicker pre-render script in header.htm.
5. In Dark Mode, enforce universal forced OLED pitch-black (#000000 background, #0a0a0a cards, #121212 inputs, #222222 borders). In Light Mode, preserve pure white (#ffffff) appliance styling.
6. After editing files in stock_rootfs, build install_webui_only.sh with `python d:\JunWRT\tools\build_install_webui_sh.py` and commit/push to git in `d:\JunWRT\github_repo`.

TASK:
[Insert your specific task here: e.g. refactor CSS variables, polish mobile layout, improve AT debug terminal, etc.]
```
