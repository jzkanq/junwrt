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
  - Always preserve the custom Cockpit Dashboard (`3gdetail.js`) featuring `junwrtCockpitStyle` (currently about 40 KB with both layouts).
  - Never overwrite or regress it to the 50KB stock version.
  - `JunWRT Settings` may select `Standard` or `Signal Diagnostics` for the cockpit only. Persist the choice in browser key `junwrt_cockpit_theme`; do not couple it to the global Light/Dark/Auto setting.
  - The `Signal Diagnostics` cockpit uses a responsive three-column layout with live signal, connection, and antenna data, including RX0–RX3 readings. Keep the standard cockpit as the default and preserve both layouts' telemetry IDs and update behavior.
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
* The TTL page controls IPv4 TTL on client traffic forwarded from `br-lan` to the active cellular WAN; IPv6 Hop Limit remains fixed at 64 for the hotspot workaround. Preserve LAN Router Advertisements at outer Hop Limit 255, remove duplicate legacy rules idempotently, and keep hardware acceleration enabled. Keep the rootfs service, WAN hotplug hook, build source, and WinSCP deployment copies synchronized.

## 6. Automated Verification Gate
* Always run `python d:\JunWRT\verify_junwrt.py` and `deep_audit.py` before marking builds or installers complete.
* Require 100% of checks reported by the current audit scripts to pass, with 0 failures and 0 warnings. Check totals can change as the suites evolve; the 2026-09-24 run reported 83 checks in `verify_junwrt.py` and 43 in `deep_audit.py`. Update this note when the scripts report new totals.

## 7. JunWRT Modern Hardware Appliance Design System
Whenever improving, modernizing, or refactoring LuCI WebUI pages, status modules, or custom forms:
* **Card Container**:
  - Light Mode: pure white background (`#ffffff`), `border: 1px solid #e2e8f0`, `border-radius: 12px`, soft dual-layer shadow (`0 1px 3px rgba(15, 23, 42, 0.04), 0 4px 12px rgba(15, 23, 42, 0.03)`).
  - Dark Mode: use the neutral graphite tokens in Section 8. Blue-tinted navy surfaces are not allowed.
  - The separately selectable Signal Diagnostics cockpit may use compact 5px cards and a responsive three-column layout. Use light neutral surfaces in Light Mode and graphite surfaces in Dark Mode.
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
  - These pale status and band fills are Light Mode styling. Dark Mode uses graphite fills with readable status text; inline pale gradient backgrounds must remove the gradient image as well as replace the background color.
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
  - When `junwrt_cockpit_theme=radio`, `.jun-cockpit-radio` is an explicitly selected layout that follows the global appearance: light neutral surfaces in Light Mode and graphite surfaces in Dark Mode. Keep nested cards, controls, and telemetry readable in both modes.
  - White surfaces are Light Mode only. In Dark Mode, audit active CSS, JavaScript inline styles, and templates for `white`, `#fff`, `#ffffff`, and `rgb(255, 255, 255)`; every background match must be overridden to graphite. White text on high-contrast action buttons remains allowed.

## 9. WebUI Change Notes & Surface Audit
* For every implementation change, review and refine this `AGENTS.md` in the same change so its rules stay current and contradictions are removed.
* For every LuCI visual change, search active UI sources for white background declarations and confirm they are either Light Mode styles or have an effective Dark Mode override. Record the result with the change.
* For every LuCI JavaScript view change, run `node --check` on each changed module and verify the generated installer contains the corrected source before release.
* Cockpit theme update (2026-09-24): the separate `junwrt_cockpit_theme=radio` option is labeled `Signal Diagnostics` and uses a responsive three-column telemetry layout. It remains independent of the global theme preference; Light Mode uses light neutral surfaces and Dark Mode uses graphite. Preserve existing telemetry IDs and live update behavior, keep installer and rootfs view sources synchronized, and verify every light surface has an effective Dark Mode override.
* JunWRT Settings syntax fix (2026-09-24): the cockpit-choice `Array.map()` renderer had an extra closing square bracket after the mapped expression, preventing the entire settings view from parsing. Keep the renderer closure balanced and run `node --check` for this view before building its installer payload.
* The modem cockpit CSS is duplicated inside `cellscan.js`, `sim.js`, `lockband.js`, `imei.js`, `atdebug.js`, and `sms.js`; keep those Dark Mode rules aligned with the shared `3ginfo-white.css` / `3ginfo-lite.css` styles. The APN, TTL, and JunWRT Settings views use `.ginfo-page` rules, including `junwrt-settings.css`.
* Wi-Fi overview change note (2026-09-24): refreshed `stock_rootfs/usr/lib/lua/luci/view/admin_mtk/mtk_wifi_overview.htm` with flatter radio/network sections, quieter labels, and left-aligned responsive controls; synchronized `WinSCP_Deploy_Modem/mtk_wifi_overview.htm`. Surface audit found the active white and pale fills belong to Light Mode cards, forms, and status/alert states; matching Dark Mode selectors replace them with graphite surfaces. White text remains limited to high-contrast actions. Existing form IDs/names, LuCI URLs, controller actions, and JavaScript handlers were preserved. Both templates have LF line endings; authenticated live rendering was unavailable at the router login screen.
* Wi-Fi mobile usability update (2026-09-25): the live `/admin/mtk/wifi` route was reviewed and the compact layout now gives radio/network action buttons 44px tap targets, uses a two-column radio action group, keeps network fields easy to scan, and wraps long technical values on narrow screens. Mobile styles reuse the existing Light/Dark surface tokens; the white form and secondary-control fills remain covered by graphite Dark Mode overrides. Action-group IDs, forms, URLs, controller endpoints, and handlers are unchanged. Keep the rootfs and WinSCP templates byte-identical and LF-only; the WebUI installer carries the rootfs template.
* PassWall client change note (2026-09-24): added `passwall-modern.css` for the legacy PassWall status/configuration page and linked it from `passwall/global/status.htm`; added both files to `tools/build_install_webui_sh.py`. The Light Mode card, tab, form, table, and input surfaces are white or pale neutral, with Dark Mode overrides to graphite. Existing PassWall CBI field names, IDs, polling, and connectivity actions were left intact. The stylesheet uses a static LuCI resource URL without query parameters.
* Lock Band contrast update (2026-09-24): preserve the responsive grid, routes, IDs, data attributes, modem commands, and configuration behavior. Live review exposed pale chips and low-contrast inline slate labels in Dark Mode; page-scoped graphite styles now take precedence, and dark.css covers compact no-space inline styles plus modem cockpit chips, controls, and text. Light Mode remains white; stylesheet URLs stay static without query parameters. Keep rootfs and WinSCP view copies byte-synchronized and LF-only.
* Dark Mode surface repair (2026-09-24): the live route audit found white loading panels, `#eee` firewall rows, white system/network containers, pale form rows and interface badges, pastel status fills, blue inline labels below contrast, and PassWall 2 buttons/icons retaining Light Mode colors. A visual inline-gradient fixture confirmed that replacing `background-color` alone left a pale gradient visible, so the final dark cascade also clears light inline background images and repeating white hatch fills. `dark.css` loads last after LuCI adds page styles, sets readable content text, and overrides inline light/pale fills, common table cells, form containers, dialogs, interface badges, plugin cards, and tab surfaces while restoring solid action colors and semantic status text. PassWall 2 has matching page-scoped button, value, and icon rules; login and both modem cockpit layouts use graphite. Light, Dark, Auto, instant switching, IDs, form names, endpoints, and handlers remain intact. The only remaining gradients in the shared modem stylesheet belong to the explicit login-background chooser and its swatches.
* Dark Mode audit and rollout (2026-09-24): `verify_junwrt.py` checks the late dark stylesheet, contrast/surface rules, theme templates, PassWall 2, and modem overrides; `deep_audit.py` checks the firmware baseline and the canonical installer overlay. Both audits use the bundled `sqfs2tar.exe` reader and pass 83/43 checks respectively with 0 failures and 0 warnings. `tools/build_install_webui_sh.py` includes the dark-mode and PassWall 2 assets in the established `install_webui_only.sh` download workflow. `tools/build_darkmode_webui_sh.py` also creates a rollback-capable dark-only installer for deployments that need a backup of the 11 changed assets and no network or service configuration changes.
* Login background fix (2026-09-24): Dark Mode keeps the graphite fallback color but must preserve the selected login background. The login template's dark `.login-page` rules must not set `background-image: none !important`, which hid all four presets and the uploaded custom image. The rootfs template ships inside the canonical `install_webui_only.sh`; both audit scripts read and check the installer payload so they verify the WebUI asset users actually install without requiring a firmware image rebuild.
* Live cache-bypass audit (2026-09-24): browsers still received cached `dark.css?v=2.4.3` after the WebUI-only deployment. The Argon header cache token is now `2.4.8`; bump it whenever the bundled global dark cascade changes. For stylesheet links and JavaScript `L.resource()` imports, use static filenames and never append query parameters.
* Post-refresh surface follow-up (2026-09-24): live `iptables` review found the shared poll-status badge retained a pale green fill because the global cascade used a more specific header selector; its active tab panel also used a pale background through `data-tab`. The dark cascade now uses a higher-specificity override for the poll badge and includes `[data-tab]` containers in the graphite surface rule. Keep these cases in future route audits.
* Full-route dark follow-up (2026-09-24): live review found LuCI package/DHCP tabs and opkg progress tracks retained pale fills, `span.open` disclosure arrows were nearly white, and unused modem signal bars were pale gray. The OpenClash page injected a blue gradient banner after the shared styles and used slate-gray IP/test cards. `dark.css` now overrides those active rules with graphite surfaces, neutral empty bars, and readable tab text; selected tabs and progress fill retain the approved sky-blue action accent. The OpenClash banner is graphite with a blue edge, while its icon container, cards, toggle, and avatar fallback use neutral graphite. Light Mode rules remain outside dark selectors. The stylesheet URL cache token is now `2.4.7`; future CSS changes must bump the header token and repeat the live route check.
* PassWall 2 sub-page follow-up (2026-09-24): the internal Node List and rule-node editor exposed pale latency links and white custom dropdown displays after the initial route sweep. Dark-only rules in `passwall2-modern.css` and its cache-renamed copy, `passwall2-modern-v2.css`, make the links and dropdowns graphite, retain readable status colors, and keep selected dropdown options sky blue. All four PassWall 2 views import the new static filename without a query string because the browser retained the old unversioned CSS after a hard reload. Test the open dropdown as well as the closed field; the WebUI installer updates the CSS and its view references. It allows the new cache-renamed stylesheet to be absent on first install, backs up every existing target, and records newly created files so its rollback helper removes them.
* Keep `README.md`, the handover guide, audit rules, and installer messages mode-accurate: white is Light Mode styling and Dark Mode uses the graphite tokens above.
* Tailscale runtime repair (2026-09-25): AW1000 runtime logs showed `/usr/sbin/tailscale` symlinked to a `tailscaled` build without the embedded CLI, while `tailscale0` itself was present. The WebUI installer and Tailscale hot-deployer must install a version-matched standalone ARM64 CLI as `/usr/bin/tailscale` from Tailscale's static archive, then use that path for status/login/settings. Keep the CLI bootstrap, helper, RPC backends, settings init service, generated installer payload, and hot-deployer synchronized. The helper waits for daemon readiness and passes auth keys/login-server values as argument vectors without `eval`; all shell sources must remain LF-only.
* TTL hotspot bypass repair (2026-09-26): the previous global POSTROUTING Hop Limit rule changed LAN Router Advertisements from outer Hop Limit 255 to 64, which clients reject. The TTL service now sets the configurable IPv4 TTL and fixed IPv6 Hop Limit 64 only on client traffic forwarded from `br-lan` to the active cellular WAN, removes duplicate legacy rules in both FORWARD and POSTROUTING, and reapplies them after WAN ifup/ifdown and firewall reloads. Keep the TTL page, rootfs service, WAN hotplug hook, firmware builder, and WinSCP copies aligned. The targeted `WinSCP_Deploy_Modem/ttl_hotspot_fix` bundle backs up touched files and firewall/ucitrack config before applying the fix. Hardware acceleration remains enabled; do not apply Hop Limit mangling to `br-lan`.

* Combined installer integration (2026-09-26): the canonical WebUI installer ships the same TTL service and WAN hotplug hook as the targeted hotspot bundle, backs up affected TTL and firewall files, then enables and reloads the service. The ttl_hotspot_fix/install.sh runs the sibling install_webui_only.sh when present; pass --ttl-only for the standalone deployment. Keep the WebUI installer, generator, Git deploy copy, and WinSCP package synchronized.

## 10. JunWRT DNS Ad Blocker
* Keep the dedicated `Services → Ad Blocker` LuCI page, RPC backend, ACL, init service, and `/usr/bin/junwrt-adblock` helper synchronized with the WebUI installer and firmware package sources.
* DNS ad blocking is opt-in and must default to disabled. It uses dnsmasq `addnhosts` with its own `/etc/junwrt-adblock/hosts` file; enabling adds only that file to the dnsmasq list, and disabling removes only that entry.
* Fetch blocklists over HTTPS, accept hosts-format input or one-domain-per-line input, validate domains, and preserve the last working list if download or validation fails. Refresh dnsmasq after updating an active list.
* The page must state that clients need to use JunWRT for DNS; private DNS, VPN DNS, or external resolvers may bypass filtering. Keep page surfaces white in Light Mode and graphite in Dark Mode with no query string on the stylesheet URL.
* Ad Blocker addition (2026-09-25): added a standalone DNS blocklist page, a default StevenBlack unified hosts source, domain-count/last-update status, source editing, refresh, and enable/disable controls. The firmware build packages the service and config; `install_webui_only.sh` installs the UI/RPC/service sources while preserving existing user settings and leaving protection disabled. Keep rootfs and `WinSCP_Deploy_Modem` page copies synchronized and LF-only.
* Ad Blocker enable repair (2026-09-25): the enable/update actions must verify the resulting status before reporting success. Enable saves the URL shown in the page; both the installer and CLI helper must create `/etc/config/junwrt-adblock` before UCI seeding because quiet `uci set` can fail when that package file is absent. The helper initializes missing UCI defaults and uses the default HTTPS source when no URL was saved. It downloads and validates the list when no usable domains are installed; status counts canonical hosts entries, and attach/detach operates on the exact dnsmasq list entry. Preserve the previous list on failed updates and keep the rootfs, WinSCP deployment copies, firmware package, and generated installer synchronized.
* Ad Blocker installer timeout sync (2026-09-25): `tools/build_install_webui_sh.py` must preserve the WebUI installer guard that raises `rpcd.@rpcd[0].timeout` to at least 120 seconds for long blocklist fetches. Keep generated installer copies aligned so a rebuild cannot remove the existing download safeguard.
* Ad Blocker live status follow-up (2026-09-25): poll service status every 10 seconds while the page is open so changes made from SSH appear without a manual reload. Skip polling during UI actions, clear a stale error when status confirms protection is active, and keep the current display if a status request temporarily fails. Replace any prior poll callback when the view renders again. Publish a byte-identical copy at `www/luci-static/resources/view/adblocker.js` in the Git deploy repository to allow applying this single-file UI update without rerunning the full bundle, which also restarts Tailscale and reloads networking.
* Local service panels (2026-09-25): Services includes `:5000 Panel` and `JZLite Panel`, redirecting to ports 5000 over HTTP and 5443 over HTTPS on the address used to open LuCI. Keep their menu JSON and controller in the firmware build and WebUI installer payload; keep the Lua controller LF-only.

## 11. Git Push Workflow
* When a push is requested, run `git push` from PowerShell outside the sandbox using `sandbox_permissions: require_escalated`, so the host's configured GitHub credentials are available. Check the target branch and intended commit first, then verify `origin` advanced and the local working tree is clean. Do not copy credentials or tokens into commands.
