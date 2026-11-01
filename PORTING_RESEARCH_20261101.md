# JunWRT MT6890 migration research

Research date: 1 November 2026, Malaysia. Scope: local artifact inspection and public-source research only. No device connection, build, deployment, configuration change or flash was performed.

## Finding and recommended direction

The current JunWRT base is OpenWrt **19.07.7 / Linux 4.19.190**, not 19.04. The current upstream stable release is **OpenWrt 25.12.6**, released 18 October 2026. Its MediaTek target selects Linux 6.12, and the tagged kernel version file specifies **6.12.112**. These are the proposed destination versions, not evidence that MT6890 can boot them. Sources: [OpenWrt release page](https://openwrt.org/releases/25.12/start), [MediaTek target at v25.12.6](https://raw.githubusercontent.com/openwrt/openwrt/v25.12.6/target/linux/mediatek/Makefile), [tagged kernel version](https://raw.githubusercontent.com/openwrt/openwrt/v25.12.6/target/linux/generic/kernel-6.12).

Updated recommendation after the source search below: evaluate the newly located public MT6890 **5.4.255 candidate kernel** as an intermediate source base. A newer userspace on the unchanged vendor kernel remains a fallback experiment. A full 6.12 platform port remains the long-term objective. No candidate has yet been compiled or boot-validated for JunWRT.

### Source-search result: public MT6890 5.4.255 candidate located

This follow-up supersedes the initial assumption that useful platform source could only be obtained from a vendor. The owner has no SDK and reports that the screenshot comes from another maker's unreleased commercial build, described by that maker as approximately 80% complete. That progress claim and the build's identity remain unverified. The owner asked us to search independently.

**A substantial public source candidate was found:** [dotywrt/EXTK54255](https://github.com/dotywrt/EXTK54255), pinned for inspection at commit `e14f682487d80e9c9e2f3f8161240c30993121e3` (22 September 2026, commit message `K54255`). Direct GitHub API/raw-file reads succeeded after sandbox DNS failures; the web fetch service could not retrieve this particular repository. The findings below are based on the actual downloaded files and saved API responses, not search snippets or the repository name.

| Verified item | File or evidence | What it establishes |
| --- | --- | --- |
| Declared kernel version | [Makefile at pinned commit](https://github.com/dotywrt/EXTK54255/blob/e14f682487d80e9c9e2f3f8161240c30993121e3/Makefile): VERSION=5, PATCHLEVEL=4, SUBLEVEL=255 | The source declares 5.4.255. A version declaration alone does not certify a correct rebase or a working kernel. |
| MT6890 SoC description | `arch/arm64/boot/dts/mediatek/mt6890.dtsi`, downloaded 118,118 bytes | Contains MT6890 clocks and MT6880/MT6890 peripheral descriptions, including modem-related compatibles. |
| Board-family build configs | `arch/arm64/configs/evb6890v1_64_cpe_defconfig` plus debug, NAND and other variants | The same target-family name as JunWRT exists, with `CONFIG_MTK_ECCCI_DRIVER=y` and `CONFIG_MTK_ECCCI_PLATFORM="mt6890"`. This is not yet an exact AW1000 board match. |
| Modem transport source | `drivers/misc/mediatek/eccci/hif/ccci_hif_dpmaif.c`, downloaded 153,944 bytes; ECCCI and CCMNI Makefiles also downloaded | There is actual CCCI/DPMAIF source to audit. The visible tree contains 58 C files across ECCCI, CCCI utilities and CCMNI, including an `eccci/mt6890` platform directory. |
| Clock source | `drivers/clk/mediatek/clk-mt6890.c`, downloaded 85,808 bytes | Substantial platform code is present, rather than only an upstream kernel and a README. |
| Other driver paths | Tree lists MT6880 pinctrl, MediaTek Ethernet and vendor MMC files | Further relevant implementation candidates exist; these particular drivers have not yet been fully inspected or compiled. |

The candidate SoC DTS contains 285 distinct compatible strings also present in the existing local extracted DT inventory. This is a textual overlap check, **not** a working-driver count, register/wiring match, or percentage of port completion. The API's recursive kernel tree is truncated, so its file list cannot establish repository completeness or prove that an unlisted dependency is absent.

Related public references from the same account:

- [AW1000ULTRA](https://github.com/dotywrt/AW1000ULTRA): downloaded `aw1000ultra.dts` and `custom_aw1000_ultra.dts`. The former identifies `mediatek,evb6890v1_64_cpe`, `mediatek,mt6890` and `telstra,meteor2`, and includes eMMC boot arguments. Treat the decompiled tree as a comparison reference; its partition numbers and the custom tree's GPIO assignments must not be adopted without verification.
- [mipc-wan](https://github.com/dotywrt/mipc-wan): the repository tree includes an archive named `mipc.release.tar.gz`, mddata, modem and DSP payloads. The archive has not been downloaded/inspected and must not be called modem source or a compatible replacement. Do not flash its modem, DSP or carrier files.
- [mt6890-wifi](https://github.com/dotywrt/mt6890-wifi): inspected Makefile installs two EEPROM/calibration blobs and has an empty compile step. It is **not a Wi-Fi driver source package**. Preserve this unit's original calibration; do not substitute those public blobs.

Other leads were checked: the FiberHome/Meteor mainline projects remain incomplete references; the X28 projects provide useful integration tooling but retain vendor 4.19 kernels. Quectel staff identify `ssh://git@git-master.quectel.com:8407/t750/ql_t750.git` in their [SDK support thread](https://forums.quectel.com/t/rg500l-quecopen-development-problems/42530), with a user reporting an OpenWrt 23.05 SDK. This is an access-controlled development route, not a verified public SDK or evidence of kernel 5.15 support. Zyxel's [official source-request form](https://www.zyxel.com/global/en/form/gpl-oss-software-notice) is another request route; no request was submitted. No complete public Fibocom SDK or verified 6.12 MT6890 port was found in this pass.

**Concrete next step:** obtain a complete isolated checkout of the pinned 5.4 candidate, review its provenance and build dependencies, compare its defconfig/DTS/modem ABI with JunWRT, and attempt an offline kernel compile. Keep this independent from the production rootfs/build scripts and require a separate boot-image/recovery review before device tests. The discovery makes an actual source-based porting attempt possible; buildability, bootloader acceptance, cellular data, Wi-Fi, acceleration and phone support remain unproven.

Evidence: `output/porting_source_search_20261101/` holds repository metadata/tree snapshots, the pinned commit record, selected source files and SHA-256 records in `EXTK54255_selected_manifest.json`. No third-party scripts were executed, no production files were replaced, and no firmware image was built or flashed.

### New lead: owner-supplied ImmortalWrt 21.02 / Linux 5.4 screenshot

After the initial research, the owner supplied a LuCI Status screenshot reporting model `Telstra 5G Modem 2`, target platform `MediaTek MT6890`, firmware `ImmortalWrt 21.02-SNAPSHOT r22-440a2186b3`, and kernel `5.4.255`. This is a relevant candidate beyond the local 4.19 baseline. If the reported kernel and board identity are verified from the actual image/runtime, a downstream 5.4 BSP may offer a better intermediate source base.

The screenshot alone establishes what the page displays. It does not independently verify the running kernel, working cellular data/Wi-Fi, source availability or compatibility with this exact board. The displayed uptime is about 14 minutes and provides no sustained stability evidence. Initial public searches did not identify a matching downloadable MT6890 build or source for the displayed revision; unsuccessful commit/target URL fetches are not proof that no source exists.

Priority follow-up: identify the original post, builder or firmware download; inspect the image's kernel banner/config, DT and module vermagic offline; compare storage layout, Fibocom interfaces and board identity. With authorized access to a unit running it, corroborate `uname -a`, `/proc/version`, board data and module versions, then check existing modem/Wi-Fi status without changing settings. Establish actual data-path acceptance separately. The owner has been asked for the screenshot's source. Do not treat this lead as official upstream MT6890 support or as a verified 6.12 port.

## Hardware identity must come before image selection

Upstream's supported Arcadyan AW1000 is **Qualcomm IPQ8072A**, target `qualcommax/ipq807x`. Its device tree uses the Qualcomm platform. This workspace instead identifies `mt6890/evb6890v1_64_cpe`, Cortex-A55 and MediaTek/Fibocom components. OpenWrt separately documents the T750/Fibocom Meteor sold as AW1000 Ultra as unsupported. Use actual board identity rather than the sales name. Sources: [official AW1000 hardware entry](https://openwrt.org/toh/hwdata/arcadyanastoria/arcadyanastoria_aw1000), [upstream Qualcomm AW1000 DTS](https://raw.githubusercontent.com/openwrt/openwrt/v25.12.6/target/linux/qualcommax/files/arch/arm64/boot/dts/qcom/ipq8072-aw1000.dts), [Meteor/Ultra hardware entry](https://openwrt.org/inbox/toh/arcadyan/5g_box_meteor_a.k.a._aw1000_ultra).

The Qualcomm AW1000 images, NoobWRT builds for that platform and its U-Boot instructions are unsuitable starting points for this MediaTek port.

## What the local evidence establishes

| Area | Inspected evidence | Migration implication |
| --- | --- | --- |
| Release | `stock_rootfs/etc/openwrt_release`: 19.07.7, target `mt6890/evb6890v1_64_cpe`, architecture `aarch64_cortex-a55_neon-vfpv4` | Create a real platform build; changing release strings is insufficient. |
| Kernel | `stock_rootfs/lib/modules/4.19.190`; existing `output/kernel_re_20261015/summary.json` records 217 modules, all with modversions and 4.19.190 vermagic | Old modules cannot simply be copied to 6.12. Rebuild or replace them. |
| Vendor coupling | The same historical analysis records 173 vendor configuration options and vendor-like imports including `mtk_ccci_*`, `warp_*` and `conninfra_*` | This is broader than a Wi-Fi driver update. Those counts describe the earlier analysis, not a newly rerun binary audit. |
| Modem | Extracted config enables `MTK_ECCCI_DRIVER`, `MTK_NET_CCMNI`, platform `mt6890`; DT includes CCIF/CLDMA/DPMAIF | Preserve or port the internal modem transport and its userspace ABI. |
| SoC | DT includes MT6890 clocks/Ethernet and MT6880 pinctrl, PCIe, MMC, watchdog, thermal and IOMMU blocks | Map every boot-critical compatible to an upstream driver or an identified porting task. Similar MediaTek names do not establish compatibility. |
| Wi-Fi | Vendor `mt_wifi.ko`, WARP modules and MediaTek profile/controller code | Retaining vendor Wi-Fi requires matching source; replacing it changes the configuration and telemetry APIs. |
| Switch | Kernel config enables `SWCONFIG` and `MT753X_GSW` | Verify actual wiring and switch identity before a possible DSA migration. |
| Storage/boot | Current scatter explicitly says EMMC, project `evb6890v1_64_cpe`; existing boot analysis reports Android boot header v2 | Do not import NAND layouts or another device's boot/slot offsets. Boot acceptance of a rebuilt kernel is still unknown. |
| Build method | `build_junwrt.py` repacks vendor rootfs; `build_safety.py` pins the existing boot/modem/DSP blobs and exact seven-member archive | The current builder is not a kernel/BSP source build system. A new target needs a separate build and validation path. |
| Phone | `junwrt-phone` opens `/dev/spidev0.0` and uses `mipc_wan_cli` | RJ11 needs SPI, GPIO/interrupt, modem call control and speech/audio validation on the destination. |
| Firewall | MSS, TTL, parental and license helpers call iptables/ip6tables | Review policy semantics and persistence against the destination firewall backend. |

The inspected Fibocom download directories contain boot images and squashfs firmware, not a kernel source tree. Targeted workspace filename searches found no MT6890 DTS/C source, Kconfig, Module.symvers or SDK archive. The owner confirmed during this research that only the firmware files in this workspace are available. Obtaining matching source is therefore the next prerequisite for a reproducible full kernel port; public availability elsewhere remains unverified.

## Closest relevant public work

The [gaglians ZLT-X28 project](https://github.com/gaglians/zlt-x28-openwrt2305) reports OpenWrt 23.05 userspace on a vendor 4.19 MT6890 kernel. It requires an external MediaTek/Quectel SDK, preserves CCCI/MIPC, and supplies compatibility patches. Its documented device is NAND/Quectel and its kernel baseline differs from our Fibocom/eMMC build. The author says the automated builder has not completed a full end-to-end build. Treat it as a reference requiring independent reproduction, not an AW1000 firmware or a demonstrated 25.12 port.

Do not adopt its dependency-bypass package installation or module-CRC rewriting as compatibility validation. Rebuild matched packages and verify interfaces instead. Its [NOTICE](https://raw.githubusercontent.com/gaglians/zlt-x28-openwrt2305/main/NOTICE.md) confirms that the essential vendor components are not included.

The upstream MediaTek target lists filogic, mt7622, mt7623 and mt7629, with no MT6890 subtarget. The inspected [mainline MediaTek DT build list](https://raw.githubusercontent.com/torvalds/linux/master/arch/arm64/boot/dts/mediatek/Makefile) also has no MT6890 board. Together with the official unsupported-device entry, this supports treating this as a platform port. It does not prove that no private or downstream implementation exists.

## Main technical decisions

**Cellular is the first major feasibility gate.** The upstream [t7xx documentation](https://raw.githubusercontent.com/torvalds/linux/master/Documentation/networking/device_drivers/wwan/t7xx.rst) describes a PCIe host driver for T700 modems. Our extracted configuration describes an internal CCCI/CCMNI stack. Installing t7xx, uqmi or ModemManager does not establish a replacement for that transport. A solution needs compatible CCCI/DPMAIF support, modem memory/security setup, control channels and the Fibocom RIL/MIPC interfaces, or evidence of a genuinely available alternative modem interface on this board.

**Wi-Fi has an upstream candidate, with board work remaining.** [mt76's MT7915 PCI driver](https://raw.githubusercontent.com/openwrt/mt76/master/mt7915/pci.c) supports MT7915 PCI IDs. That makes mt76 worth investigating after PCIe works. It does not verify this board's reset/power sequence, calibration format, antenna mapping, coexistence or throughput. A switch would require translating `.dat` profiles to mac80211/hostapd and replacing vendor ioctls in station/control helpers. Keep 80 MHz as the accepted baseline; the historical 160 MHz failure remains unresolved.

**Binary compatibility is a separate problem.** Linux does not provide a stable internal driver ABI; [kernel documentation](https://docs.kernel.org/process/stable-api-nonsense.html) explains configuration/compiler/data-structure dependencies. Rewriting vermagic or symbol CRCs does not make old drivers safe on 6.12. Vendor userspace libraries also need an ELF dependency and ioctl audit against the new libc and services.

**Modern userspace still requires integration work.** OpenWrt 25.12 changes the package manager to apk; see the [upstream release announcements](https://github.com/openwrt/openwrt/releases). OpenWrt's [firewall4](https://github.com/openwrt/firewall4) uses nftables. Inventory opkg assumptions, fw3/iptables hooks, netifd scripts, legacy Lua LuCI controllers, rpcd permissions and service behavior. For a vendor-kernel experiment, verify required syscalls, namespaces and nftables features rather than assuming newer packages support 4.19. Keep any compatibility exceptions explicit and narrowly scoped.

**Acceleration must be measured again.** Vendor WARP is not interchangeable with upstream WED/PPE support. Begin a new-kernel bring-up with acceleration out of the critical path; measure Ethernet and cellular correctness first. Later validate throughput, CPU cost, VPNs and parental-policy enforcement before claiming an acceleration path works.

## Proposed milestones and evidence required

1. **Obtain and inventory source.** Seek the exact Fibocom FG360/MediaTek T750 BSP: `ext_kernel-4.19`, MT6890/MT6880 DTS/DTSI, target definitions, boot packaging, compiler/config/Module.symvers, CCCI/DPMAIF/CCMNI, Ethernet/switch, PCIe, clocks/pinctrl/PMIC, modem/RIL/MIPC, Wi-Fi and any required prebuilt objects. Record versions, provenance, hashes and redistribution terms. Ask whether a maintained newer-kernel BSP exists. A generic OpenWrt SDK or a firmware update archive is insufficient.
2. **Establish reproducibility.** Build the vendor kernel/target in an isolated Linux environment. Compare generated config, DT, module symbols and boot packaging with known artifacts. Identify all missing-source objects. If source is unavailable, document a limited binary-preserving userspace experiment; do not describe it as a reproducible kernel port.
3. **Assess userspace separately.** Study the X28 patches against our exact BSP and the 25.12 package requirements. An older userspace version may help reproduce the reference, but 23.05 is not the intended supported destination. Produce an offline compatibility matrix before making an image.
4. **Bring up 6.12 minimally.** After establishing bootloader acceptance and recovery on spare hardware, target serial console, timers/interrupts, clocks/power, RAM, watchdog, eMMC, rootfs and one Ethernet port. A booting shell is a milestone, not a usable 5G router.
5. **Enable networking and services incrementally.** Validate Ethernet/VLANs, then cellular control and bidirectional data, then Wi-Fi with board calibration, then optional acceleration and RJ11. Test reconnects, sustained load, IPv4/IPv6, VPNs and policy boundaries.
6. **Port JunWRT features and release gates.** Repackage the cockpit/theme, station/QR/password features and feature modules with matched dependencies. Preserve owner configuration and calibration. Keep current 19.07 audits intact; add a separate target-aware suite so old fixed-offset patches, vendor hashes and archive rules cannot be accidentally applied to new binaries. Require actual boot/recovery and runtime evidence as well as static checks before release.

No defensible completion estimate is available until source completeness, boot acceptance and modem feasibility have been established. The first useful deliverable is the source/driver compatibility matrix, followed by a reproducible isolated build.

## Remaining questions

- The owner has no source SDK. The public 5.4.255 candidate is now available for a build/dependency audit; exact Fibocom compatibility and any missing vendor components still need verification.
- What exact FG360 module/board revision is the development unit, and is spare hardware available for later recovery/boot tests?
- Which features must work in the first experimental build: cellular, both Wi-Fi bands, acceleration and RJ11? This changes milestone order, not the eventual goal.

Research-only outcome: a plausible investigation route exists, but no working modern-kernel MT6890/Fibocom port was verified in this pass. Existing firmware, installers and AGENTS implementation rules remain unchanged. No build or installer was produced, so the firmware completion gates were not run or claimed.
