'use strict';
'require baseclass';
'require dom';
'require ui';
'require network';
'require rpc';
'require tools.junwrt_qrcode as wifiQR';

var wifiStatusExec = rpc.declare({object:'file', method:'exec', params:['command','params'], nobatch:true});
function vendorNetworks(data) {
	if (!data || !Array.isArray(data.networks)) throw new Error('Invalid Wi-Fi status response');
	return data.networks.map(function(net) {
		if (!net || !Array.isArray(net.stations)) throw new Error('Invalid station list');
		return {
			assoclist: net.stations,
			vendor: true,
			getIfname: function() { return net.ifname; },
			getActiveSSID: function() { return net.ssid; },
			getShortName: function() { return net.label || net.ifname; },
			getEncryption: function() { return net.encryption; },
			isClientDisconnectSupported: function() { return net.disconnect_supported === true; },
			disconnectClient: function(mac) {
				return wifiStatusExec('/usr/bin/junwrt-wifi-status', ['disconnect', net.ifname, mac]).then(function(result) {
					var data = JSON.parse(result.stdout || '{}');
					if (Number(result.code) !== 0 || data.success !== true) throw new Error(data.error || _('Disconnect request failed.'));
					return data;
				});
			}
		};
	});
}

function wifirate(rt) {
	if (!rt || typeof rt.rate !== 'number' || !isFinite(rt.rate) || rt.rate <= 0) return _('Unavailable');
	var s = (rt.rate / 1000).toFixed(1).replace(/\.0$/, '') + '\xa0' + _('Mbit/s');
	if (typeof rt.mhz === 'number' && rt.mhz > 0) s += ', ' + rt.mhz + '\xa0' + _('MHz');
	var ht = rt.ht, vht = rt.vht, mhz = rt.mhz, nss = rt.nss, mcs = rt.mcs, sgi = rt.short_gi;
	if (ht || vht) {
		if (vht) s += ', VHT-MCS\xa0%d'.format(mcs);
		if (nss) s += ', VHT-NSS\xa0%d'.format(nss);
		if (ht) s += ', MCS\xa0%s'.format(mcs);
		if (sgi) s += ', ' + _('Short GI').replace(/ /g, '\xa0');
	}
	return s;
}

return baseclass.extend({
	title: '',

	handleDelClient: function(wifinet, mac, ev) {
		var confirm = E('button', {
			'class':'btn cbi-button cbi-button-remove',
			'style':'min-height: 44px; background: #ef4444; color: #ffffff; border: 1px solid #ef4444; border-radius: 6px; padding: 6px 14px; font-size: 12px; font-weight: 600;',
			'click':function() {
				confirm.disabled = true;
				return wifinet.disconnectClient(mac, true, 5, 60000).then(function() {
					ui.hideModal();
					ui.addNotification(null, E('p', {}, _('Disconnect request sent. The device may reconnect automatically.')));
				}).catch(function(error) {
					confirm.disabled = false;
					ui.addNotification(null, E('p', {}, error.message || _('Disconnect request failed.')));
				});
			}
		}, _('Disconnect'));
		ui.showModal(_('Disconnect Wi-Fi device?'), [
			E('p', {}, _('Temporarily disconnect ') + mac + ' (' + wifinet.getShortName() + ')?'),
			E('p', {}, _('This does not block the device. It may reconnect automatically.')),
			E('div', {style:'display: flex; justify-content: flex-end; gap: 8px;'}, [
				E('button', {'class':'btn cbi-button cbi-button-neutral', style:'min-height: 44px; background: var(--jw-bg-surface, #ffffff); color: var(--jw-text-primary, #334155); border: 1px solid var(--jw-border-strong, #cbd5e1); border-radius: 6px; padding: 6px 14px;', click:ui.hideModal}, _('Cancel')),
				confirm
			])
		]);
	},

	handleShowQR: function(networks, ev) {
		var button = ev && ev.currentTarget;
		if (button) { button.disabled = true; button.classList.add('spinning'); }
		// Fetch credentials only after this administrator requests the connection dialog.
		return wifiStatusExec('/usr/bin/junwrt-wifi-status', ['connections']).then(function(result) {
			var data = JSON.parse(result.stdout || '{}');
			if (Number(result.code) !== 0 || data.error || !Array.isArray(data.connections))
				throw new Error(data.error || _('Wi-Fi connection details are unavailable.'));
			var items = data.connections.map(function(net) {
				var ssid = net.ssid, security = net.security || _('Unknown security');
				var band = ({'2.4G':'2.4 GHz', '5G':'5 GHz', '6G':'6 GHz'})[net.band] || net.ifname;
				var description = band + (net.width ? ' • ' + _('Configured width: ') + net.width : '');
				var escape = function(value) { return String(value).replace(/([\\;,:"])/g, '\\$1'); };
				var payload = null;
				if (net.type === 'nopass') payload = 'WIFI:T:nopass;S:' + escape(ssid) + ';H:' + (net.hidden ? 'true' : 'false') + ';;';
				else if (net.type === 'WPA' && typeof net.key === 'string' && net.key.length)
					payload = 'WIFI:T:WPA;S:' + escape(ssid) + ';P:' + escape(net.key) + ';H:' + (net.hidden ? 'true' : 'false') + ';;';
				var image = payload ? E('img', {src:wifiQR.image(payload), width:180, height:180, alt:_('Wi-Fi connection QR code'), style:'display: block; max-width: 100%; height: auto;'}) : E('p', {}, _('QR connection is unavailable for this security mode or a missing password.'));
				// The image contains only QR modules, never the plain-text credential string.
				net.key = null;
				return E('div', {
					'style':'background: var(--jw-bg-surface, #ffffff); border: 1px solid var(--jw-border-subtle, #e2e8f0); border-radius: 8px; padding: 14px; margin-bottom: 12px; display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap;'
				}, [
					E('div', {style:'text-align: left; flex: 1 1 180px; min-width: 0; overflow-wrap: anywhere;'}, [
						E('div', {style:'font-size: 15px; font-weight: 600; color: var(--jw-text-primary, #0f172a);'}, ssid),
						E('div', {style:'font-size: 12px; color: var(--jw-text-secondary, #64748b); margin-top: 4px;'}, description),
						E('div', {style:'font-size: 12px; color: var(--jw-text-secondary, #64748b); margin-top: 4px;'}, _('Security: ') + security),
						E('button', {'class':'btn cbi-button cbi-button-action', style:'margin-top: 12px; min-height: 44px; background: #0284c7; color: #ffffff; border: 0; font-size: 12px; font-weight: 600; padding: 6px 14px; border-radius: 6px;', click:function() {
							var copy;
							if (navigator.clipboard && navigator.clipboard.writeText) copy = navigator.clipboard.writeText(ssid);
							else {
								var field = E('textarea', {readonly:'', style:'position: fixed; left: -9999px;'}, ssid);
								document.body.appendChild(field); field.select();
								var copied = document.execCommand('copy'); document.body.removeChild(field);
								copy = copied ? Promise.resolve() : Promise.reject(new Error('Copy unavailable'));
							}
							return copy.then(function() { ui.addNotification(null, E('p', {}, _('SSID copied: ') + ssid)); }).catch(function() { ui.addNotification(null, E('p', {}, _('Select the network name to copy it.'))); });
						}}, _('Copy SSID'))
					]),
					E('div', {style:'flex: 0 1 180px; min-width: 0;'}, [image])
				]);
			});
			var dialog = ui.showModal(_('Fast Wi-Fi Connection'), [
				E('p', {style:'font-size: 12px; color: var(--jw-text-secondary, #64748b); margin-bottom: 12px;'}, _('Scan to join. Each QR code includes the network password; share it only with devices you trust.')),
				E('div', {}, items.length ? items : [E('p', {}, _('No active Wi-Fi networks are available.'))]),
				E('div', {style:'text-align: right; margin-top: 14px;'}, [E('button', {'class':'btn cbi-button cbi-button-neutral', style:'min-height: 44px; background: var(--jw-bg-surface, #ffffff); border: 1px solid var(--jw-border-strong, #cbd5e1); color: var(--jw-text-primary, #334155); font-size: 12px; font-weight: 600; padding: 6px 14px; border-radius: 6px;', click:ui.hideModal}, _('Close'))])
			], 'junwrt-wifi-connect');
			Object.assign(dialog.style, {display:'block', width:'600px', maxWidth:'calc(100% - 24px)', minWidth:'0', boxSizing:'border-box'});
		}).catch(function(error) {
			ui.addNotification(null, E('p', {}, _('Unable to load Wi-Fi connection details. Refresh or sign in with an administrator account.')));
		}).finally(function() {
			if (button) { button.disabled = false; button.classList.remove('spinning'); }
		});
	},

	load: function() {
		return Promise.all([
			L.resolveDefault(network.getWifiDevices(), []),
			L.resolveDefault(network.getWifiNetworks(), []),
			L.resolveDefault(network.getHostHints(), {})
		]).then(function(radios_networks_hints) {
			var tasks = [];
			var failed = false;
			for (var i = 0; i < radios_networks_hints[1].length; i++) {
				tasks.push(radios_networks_hints[1][i].getAssocList().catch(function() { failed = true; return []; }).then(
					L.bind(function(net, list) {
						net.assoclist = list.sort(function(a, b) { return a.mac.localeCompare(b.mac); });
					}, this, radios_networks_hints[1][i])
				));
			}
			return Promise.all(tasks).then(function() {
				// iwinfo does not expose stations for the AW1000 proprietary driver.
				// Query its read-only helper even when iwinfo returns a successful empty list.
				return wifiStatusExec('/usr/bin/junwrt-wifi-status', ['status']).then(function(result) {
					var data = JSON.parse(result.stdout || '{}');
					if (Number(result.code) !== 0) throw new Error(data.error || 'Wi-Fi status unavailable');
					var nets = vendorNetworks(data);
					radios_networks_hints[1] = nets;
					radios_networks_hints[3] = data.error || null;
					return radios_networks_hints;
				}).catch(function() {
					// Retain working standard-driver clients if the vendor helper is absent.
					var nets = radios_networks_hints[1];
					var hasClients = nets.some(function(net) { return net.assoclist.length > 0; });
					var proprietary = nets.some(function(net) { return net.getIfname && /^ra[inx]*\d+$/.test(net.getIfname()); });
					if (failed || (!hasClients && (!nets.length || proprietary))) radios_networks_hints[3] = _('Unable to read wireless stations. Retrying automatically.');
					return radios_networks_hints;
				});
			});
		});
	},

	render: function(data) {
		var radios = data[0] || [];
		var networks = data[1] || [];
		var hosthints = data[2] || {};
		var error = data[3];

		var rows = [];
		var totalClients = 0;

		for (var i = 0; i < networks.length; i++) {
			var net = networks[i];
			var assoc = net.assoclist || [];
			totalClients += assoc.length;

			for (var k = 0; k < assoc.length; k++) {
				var bss = assoc[k];
				var name = hosthints.getHostnameByMACAddr ? hosthints.getHostnameByMACAddr(bss.mac) : null;
				var ipv4 = hosthints.getIPAddrByMACAddr ? hosthints.getIPAddrByMACAddr(bss.mac) : null;
				var ipv6 = hosthints.getIP6AddrByMACAddr ? hosthints.getIP6AddrByMACAddr(bss.mac) : null;

				var hasSignal = typeof bss.signal === 'number' && isFinite(bss.signal) && bss.signal < 0;
				var q = hasSignal ? Math.min(Math.max(Math.round((bss.signal + 110) / 70 * 100), 0), 100) : null;
				var sigColor = q >= 60 ? '#2dce89' : (q >= 30 ? '#d97706' : '#fb6340');

				var hostStr = name || (ipv4 || (ipv6 || 'Wireless Client'));
				var ipDetail = (ipv4 || ipv6) ? (ipv4 || ipv6) : '-';

				var rxStr = wifirate(bss.rx);
				var txStr = wifirate(bss.tx);

				var actionBtn = _('Unavailable');
				if (net.isClientDisconnectSupported && net.isClientDisconnectSupported()) {
					actionBtn = E('button', {
						'class':'btn cbi-button cbi-button-remove',
						'style': 'min-height: 44px; background: #ef4444; border: 1px solid #ef4444; color: #ffffff; font-size: 12px; font-weight: 600; padding: 6px 14px; border-radius: 6px; cursor: pointer;',
						'click': L.bind(this.handleDelClient, this, net, bss.mac)
					}, _('Disconnect'));
				}

				rows.push(E('div', {
					'class': 'client-row',
					'style': 'display: grid; grid-template-columns: 1.8fr 1.8fr 2fr 1.5fr 2.5fr 1fr; padding: 12px 16px; border-bottom: 1px solid #edf2f9; align-items: center; font-size: 12px;'
				}, [
					// Network / SSID
					E('div', { 'style': 'font-weight: 600; color: #32325d; display: flex; align-items: center; gap: 6px;' }, [
						E('span', { 'style': 'width: 7px; height: 7px; border-radius: 50%; background: #0284c7; display: inline-block;' }),
						net.vendor ? net.getShortName() : (net.getActiveSSID() || net.getShortName())
					]),

					// MAC Address
					E('div', { 'style': 'font-family: monospace; color: #525f7f;' }, bss.mac),

					// Host / IP
					E('div', {}, [
						E('div', { 'style': 'font-weight: 600; color: #32325d;' }, hostStr),
						E('div', { 'style': 'font-size: 11px; color: #8898aa; font-family: monospace;' }, ipDetail)
					]),

					// Signal & Quality
					E('div', {}, [
						E('span', {
							'style': 'font-weight: 600; color: ' + sigColor + '; font-size: 12px;'
						}, hasSignal ? bss.signal + ' dBm' : _('Unavailable')),
						E('span', { 'style': 'font-size: 11px; color: #8898aa; margin-left: 4px;' }, hasSignal ? '(' + q + '%)' : '')
					]),

					// PHY Rate
					E('div', { 'style': 'font-size: 11px; color: #525f7f;' }, [
						E('div', ['RX: ', E('strong', rxStr)]),
						E('div', ['TX: ', E('strong', txStr)])
					]),

					// Action
					E('div', {}, actionBtn)
				]));
			}
		}

		var tableBody = null;
		if (rows.length > 0) {
			tableBody = E('div', { 'style': 'background: #ffffff; border-radius: 8px; border: 1px solid #e2e8f0; overflow: hidden;' }, [
				E('div', {
					'style': 'display: grid; grid-template-columns: 1.8fr 1.8fr 2fr 1.5fr 2.5fr 1fr; padding: 10px 16px; background: #f8fafc; border-bottom: 1px solid #edf2f9; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: #8898aa;'
				}, [
					E('div', 'Radio / SSID'),
					E('div', 'MAC Address'),
					E('div', 'Client Host / IP'),
					E('div', 'Signal'),
					E('div', 'PHY Link Rate'),
					E('div', 'Action')
				]),
				E('div', {}, rows)
			]);
		} else {
			tableBody = E('div', {
				'style': 'background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 18px; text-align: center; color: #8898aa; font-size: 12px;'
			}, error || 'No wireless stations currently associated.');
		}

		return E('div', {
			'class': 'cbi-section junwrt-status-surface',
			'style': 'background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; box-shadow: 0 2px 12px rgba(50, 50, 93, 0.04), 0 1px 3px rgba(0, 0, 0, 0.02); margin-bottom: 24px; overflow: hidden;'
		}, [
			// Header
			E('div', {
				'style': 'display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; border-bottom: 1px solid #e2e8f0; background: #ffffff; flex-wrap: wrap; gap: 12px;'
			}, [
				E('div', { 'style': 'display: flex; align-items: baseline; gap: 8px;' }, [
					E('span', { 'style': 'font-size: 15px; font-weight: 700; color: #32325d;' }, 'Wireless Associated Stations'),
					E('span', { 'style': 'font-size: 12px; color: #8898aa;' }, 'Real-Time Wi-Fi Clients & Signal Quality')
				]),
				E('div', { 'style': 'display: flex; align-items: center; gap: 10px; font-size: 12px; flex-wrap: wrap;' }, [
					E('span', {
						'style': 'background: #f0f9ff; color: #0284c7; border: 1px solid #bae6fd; font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 6px;'
					}, 'Wi-Fi 6 (802.11ax)'),
					E('span', { 'style': 'font-weight: 600; color: #0f172a;' }, error ? _('Station count unavailable') : totalClients + ' Associated Stations'),
					E('button', {
						'style': 'background: #ffffff; border: 1.5px solid #0284c7; color: #0284c7; font-size: 11px; font-weight: 600; padding: 3px 10px; border-radius: 6px; cursor: pointer; transition: all 0.2s;',
						'click': L.bind(this.handleShowQR, this, networks)
					}, 'Fast Connect QR')
				])
			]),

			// Body
			E('div', { 'style': 'padding: 20px;' }, [
				rows.length && error ? E('p', {role:'status'}, error) : '',
				tableBody
			]),

			// Footer
			E('div', {
				'style': 'display: flex; align-items: center; justify-content: space-between; padding: 12px 20px; background: #f8fafc; border-top: 1px solid #e2e8f0; font-size: 11px; color: #8898aa;'
			}, [
				E('div', {}, networks.some(function(net) { return net.vendor; }) ? 'MediaTek MT7915 • Last PHY rates: RX from device, TX to device. Not throughput.' : 'Wi-Fi station telemetry'),
				E('div', {}, [
					E('strong', { 'style': 'color: #0284c7; font-weight: 600;' }, 'JunWRT'),
					' • Low-Jitter Wireless Stack'
				])
			])
		]);
	}
});
