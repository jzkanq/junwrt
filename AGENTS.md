# JunWRT Project Agent Instructions & Invariants

When working in this workspace or modifying the AW1000 OpenWrt firmware and installer scripts:

## 1. Wi-Fi SSID Invariant
* **2.4 GHz Default SSID**: `JunWRT 2.4G`
* **5 GHz Default SSID**: `JunWRT 5G` (80 MHz Wi-Fi 6, 1201 Mbps PHY rate, `Disable160RuMu=0x38`)
* Always synchronize these SSIDs across:
  - `mt7915.1.dat` (`SSID1=JunWRT 2.4G`)
  - `mt7915.2.dat` (`SSID1=JunWRT 5G`)
  - `/etc/config/wireless` UCI configurations
  - `/etc/uci-defaults/99-junwrt-setup` first-boot automation
  - `install_junwrt.sh` deployment script

## 2. WebUI & Modem Cockpit Architecture
* **Cockpit Dashboard (`3gdetail.js`)**:
  - Always preserve the custom Cockpit Dashboard (`3gdetail.js`) featuring `junwrtCockpitStyle` (currently about 37 KB with both layouts).
  - Never overwrite or regress it to the 50KB stock version.
  - `JunWRT Settings` may select `Standard` or `Signal & Antenna` for the cockpit only. Persist the choice in browser key `junwrt_cockpit_theme`; do not couple it to the global Light/Dark/Auto setting.
  - The `Signal & Antenna` cockpit design includes a live RSRP dial and live RX0–RX3 readings. Keep the standard cockpit as the default and preserve both layouts' telemetry IDs and update behavior.
* **Modem Sub-Page Surfaces**:
  - The 8 modem sub-pages (`cellscan.js`, `sim.js`, `lockband.js`, `imei.js`, `apn.js`, `ttl.js`, `atdebug.js`, `sms.js`) use clean white backgrounds (`#ffffff`) in Light Mode, eliminating stock green/cyan gradients.
  - In Dark Mode, those pages use neutral graphite gray surfaces; no white or pale surface may remain visible. Preserve factory controls, table layouts, form alignments, IDs, and endpoints.
* **LuCI CSS Import Invariant**:
  - Never add query parameters (such as `?v=...`) to CSS imports in LuCI JavaScript views (`L.resource()`), because this causes `SyntaxError: Failed to execute 'open' on 'XMLHttpRequest': Invalid URL`.
  - Use dedicated static filenames (e.g., `3ginfo-white.css` and `3ginfo-lite.css`).

## 3. Strict Unix Line Endings (LF)
* Every script, config file, and LuCI template inside the rootfs and deployment packages must strictly have Unix **LF (`\n`)** line endings (0 CRLF).
* On-the-fly CRLF sanitization must be applied to all vendor files extracted from stock archives.

## 4. DRM & Bootloop Protection
* In `/sbin/mount_root`, the 15 instructions at `0x9FC - 0xA34` must be patched with AArch64 `NOP` (`0x1F2003D5`).
* Boundary instructions at `0x9F8` (`f503002a`) and `0xA38` (`bf060071`) must remain intact.
* `luci-app-authcode` must remain completely purged from rootfs.

## 5. Network & Cellular Performance
* Keep generic OpenWrt `flow_offloading` disabled in `/etc/config/firewall` (enables `mtk_warp.ko` hardware NAT and avoids stalls in WireGuard, OpenVPN, Passwall, and OpenClash).
* Enforce TCP MSS clamping on the FORWARD chain in `/etc/firewall.user` with idempotency checks.
* Dynamic CPU frequency scaling (energy-saving idle + 2.0 GHz burst) and 4-core IRQ packet steering managed by `/etc/init.d/junspeedpatch`.

## 6. Automated Verification Gate
* Always run `python d:\JunWRT\verify_junwrt.py` and `deep_audit.py` before marking builds or installers complete.
* Require 100% of checks reported by the current audit scripts to pass, with 0 failures and 0 warnings. Check totals can change as the suites evolve; the 2026-09-24 run reported 82 checks in `verify_junwrt.py` and 42 in `deep_audit.py`. Update this note when the scripts report new totals.

## 7. JunWRT Modern Hardware Appliance Design System
Whenever improving, modernizing, or refactoring LuCI WebUI pages, status modules, or custom forms:
* **Card Container**:
  - Light Mode: pure white background (`#ffffff`), `border: 1px solid #e2e8f0`, `border-radius: 12px`, soft dual-layer shadow (`0 1px 3px rgba(15, 23, 42, 0.04), 0 4px 12px rgba(15, 23, 42, 0.03)`).
  - Dark Mode: use the neutral graphite tokens in Section 8. Blue-tinted navy surfaces are not allowed.
  - The separately selectable Signal & Antenna cockpit may use tighter 8px card corners and flatter graphite cards to match its radio-instrument layout.
  - Header: flex row with deep slate title (`#0f172a`), badge pills, and right-aligned action toolbar.
* **Typography & Grids**:
  - Replace pipe-delimited raw strings or old `cbi-section-table` styling with structured grid/flex layouts.
  - Sub-labels: uppercase 11px font, color `#94a3b8`, letter-spacing `0.04em`.
  - Values: monospace font (`ui-monospace, Consolas, monospace`), font-weight 600, color `#1e293b`.
* **High-Contrast Button Specification**:
  - Always enforce solid, high-contrast backgrounds with explicit text colors (never light tint outlines that conflict with LuCI's global `#fff` text rule):
    - **Primary / Enable / Save / Apply**: Solid Sky Blue (`#0284c7`, text `#ffffff`, hover `#0369a1`).
    - **Disable / Reset / Warning**: Solid Amber (`#f59e0b`, text `#ffffff`, hover `#d97706`).
    - **Remove / Delete / Disconnect**: Solid Crimson (`#ef4444`, text `#ffffff`, hover `#dc2626`).
    - **Config / Edit / Secondary**: Light Mode uses white (`#ffffff`, border `#cbd5e1`, text `#334155`, hover bg `#f1f5f9`). Dark Mode uses graphite gray surfaces, gray borders, and light text; do not leave white button panels in Dark Mode.
  - Button styling: `border-radius: 6px !important; font-size: 12px !important; font-weight: 600 !important; padding: 6px 14px !important;`.
* **Status Pills**:
  - Active / UP / Connected: `#e8f9f0` bg, `#10b981` text, `#a7f3d0` border.
  - Inactive / Disabled / Down: `#f8fafc` bg, `#94a3b8` text, `#e2e8f0` border.
  - Band Badges: 5 GHz in Sky Blue (`#f0f9ff` / `#0284c7`), 2.4 GHz in Purple/Indigo (`#faf5ff` / `#7c3aed`).
* **Preserve Functionality**:
  - Always preserve 100% of underlying element IDs, form names, XHR URLs, and controller endpoints so redesigns are purely cosmetic enhancements with zero logic breakage.

## 8. Dark Mode Architecture & LuCI Theme Invariants
* **Pre-Render Theme Initialization (Zero-Flicker)**:
  - In `usr/lib/lua/luci/view/themes/argon/header.htm`, always preserve the early script inside `<head>` reading `localStorage.getItem('junwrt_theme')`.
  - Must apply `data-theme="dark"` and class `dark-mode` immediately to `document.documentElement` before the DOM renders to prevent any white-flash flicker on page load.
  - Dynamically manage `argon-dark-css` stylesheet media attribute (`all` when dark, `none` when light).
* **Navigation Bar Quick Switcher**:
  - The `#junwrt-theme-toggle` button in the top navigation bar (`#indicators` flex row) must persist across header updates with Sun/Moon SVG icons and click handling bound via `menu-argon.js`.
* **Event Synchronization**:
  - When switching themes, dispatch the custom event `window.dispatchEvent(new CustomEvent('junwrt-theme-changed', { detail: { theme: mode } }))` to ensure all active views update in real-time.
* **Modem Subsection: "JunWRT Settings" (`admin/modem/junwrt-settings`)**:
  - Registered in `usr/share/luci/menu.d/luci-app-3ginfo-lite.json` (Order: 50).
  - Implemented in `www/luci-static/resources/view/modem/junwrt_settings.js` using `3ginfo-white.css`.
  - Must provide selectable appearance modes (`Light Mode`, `Dark Mode`, `Auto (Follow OS)`), instant toggle actions, and appliance telemetry info.
* **Neutral Gray Dark Palette**:
  - Use graphite gray surfaces: page `#202124`, card `#292a2d`, elevated `#35363a`, subtle border `#3f4044`, strong border `#5a5d63`.
  - Use soft neutral text: primary `#e8eaed`, secondary `#c4c7cc`, muted `#9aa0a6`. Do not use blue-tinted navy as a page, header, sidebar, or card background.
  - Reserve blue (`#0284c7`) for primary actions and restrained links/focus accents; it must not tint the overall shell.
* **Theme Styling Invariant**:
  - All modern sub-pages using `.ginfo-page` must support dual-mode styles: clean pure-white (`#ffffff`) surfaces in Light Mode, and neutral graphite (`#202124` container, `#292a2d` cards, `#3f4044` borders, `#e8eaed` text) in Dark Mode.
  - Exception: when `junwrt_cockpit_theme=radio`, `.jun-cockpit-radio` is an explicitly selected graphite cockpit surface in either global appearance mode; its nested cards and controls must remain graphite with readable text.
  - White surfaces are Light Mode only. In Dark Mode, audit active CSS, JavaScript inline styles, and templates for `white`, `#fff`, `#ffffff`, and `rgb(255, 255, 255)`; every background match must be overridden to graphite. White text on high-contrast action buttons remains allowed.

## 9. WebUI Change Notes & Surface Audit
* For every implementation change, review and refine this `AGENTS.md` in the same change so its rules stay current and contradictions are removed.
* For every LuCI visual change, search active UI sources for white background declarations and confirm they are either Light Mode styles or have an effective Dark Mode override. Record the result with the change.
* For every LuCI JavaScript view change, run `node --check` on each changed module and verify the generated installer contains the corrected source before release.
* Cockpit theme change note (2026-09-24): added a separate `Standard` / `Signal & Antenna` choice in JunWRT Settings, persisted per browser and applied only to Cellular Baseband Cockpit. The alternate design uses graphite surfaces in both global modes. Audit found its white action-button text is on solid high-contrast action buttons; no white card or page background is used by the alternate cockpit surface.
* JunWRT Settings syntax fix (2026-09-24): the cockpit-choice `Array.map()` renderer had an extra closing square bracket after the mapped expression, preventing the entire settings view from parsing. Keep the renderer closure balanced and run `node --check` for this view before building its installer payload.
* The modem cockpit CSS is duplicated inside `cellscan.js`, `sim.js`, `lockband.js`, `imei.js`, `atdebug.js`, and `sms.js`; keep those Dark Mode rules aligned with the shared `3ginfo-white.css` / `3ginfo-lite.css` styles. The APN, TTL, and JunWRT Settings views use `.ginfo-page` rules, including `junwrt-settings.css`.
* Wi-Fi overview change note (2026-09-24): refreshed `stock_rootfs/usr/lib/lua/luci/view/admin_mtk/mtk_wifi_overview.htm` with flatter radio/network sections, quieter labels, and left-aligned responsive controls; synchronized `WinSCP_Deploy_Modem/mtk_wifi_overview.htm`. Surface audit found the active white and pale fills belong to Light Mode cards, forms, and status/alert states; matching Dark Mode selectors replace them with graphite surfaces. White text remains limited to high-contrast actions. Existing form IDs/names, LuCI URLs, controller actions, and JavaScript handlers were preserved. Both templates have LF line endings; authenticated live rendering was unavailable at the router login screen.
* Keep `README.md`, the handover guide, audit rules, and installer messages mode-accurate: white is Light Mode styling and Dark Mode uses the graphite tokens above.
