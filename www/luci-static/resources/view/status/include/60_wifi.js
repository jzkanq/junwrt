'use strict';
'require baseclass';
'require dom';
'require ui';
'require network';
'require rpc';
'require tools.junwrt_qrcode as wifiQR';

var wifiStatusExec = rpc.declare({object:'file', method:'exec', params:['command','params'], nobatch:true});
var accessControlStyle = 'box-sizing: border-box; min-height: 44px; max-width: 100%; border-radius: 6px; ' +
	'padding: 6px 14px; font-size: 12px; font-weight: 600; ';
var accessSecondaryStyle = accessControlStyle + 'background: var(--jw-bg-surface, #ffffff); ' +
	'color: var(--jw-text-primary, #334155); border: 1px solid var(--jw-border-strong, #cbd5e1);';

function wifiAccess(args) {
	return wifiStatusExec('/usr/bin/junwrt-wifi-access', args).then(function(result) {
		var data = JSON.parse(result.stdout || '{}');
		if (Number(result.code) !== 0 || data.error) throw new Error(data.error || _('Wi-Fi access settings are unavailable.'));
		return data;
	});
}

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

	handleWifiAccess: function(preferredNetwork, station) {
		var saving = false;
		var status = E('p', {role:'status'});
		var panel = E('div', {});
		ui.showModal(_('Wi-Fi block list'), [
			E('p', {}, [_('Blocks the selected MAC address from joining one Wi-Fi network. Repeat for each network you want to block it on.')]),
			status, panel,
			E('button', {type:'button', class:'btn cbi-button-neutral', style:accessSecondaryStyle, click:ui.hideModal}, _('Close'))
		], 'jun-wifi-access-modal');

		function refresh(preferred, pendingMac, message, pendingChange) {
			status.textContent = message || _('Loading Wi-Fi networks…');
			dom.content(panel, []);
			return wifiAccess(['list']).then(function(data) {
				if (!Array.isArray(data.networks) || !data.networks.length)
					throw new Error(_('No configured Wi-Fi networks were found.'));

				var selector = E('select', {id:'jun-wifi-block-network', style:accessSecondaryStyle}, [
					E('option', {value:''}, [_('Choose a Wi-Fi network')])
				].concat(data.networks.map(function(net) {
					return E('option', {value:net.ifname}, [net.ssid + ' (' + net.ifname + ')']);
				})));
				var available = data.networks.some(function(net) { return net.ifname === preferred; });
				selector.value = available ? preferred : '';
				var rules = E('div', {});
				var input = E('input', {id:'jun-wifi-block-mac', type:'text', maxlength:'17', autocomplete:'off',
					value:pendingMac || '', placeholder:'02:11:22:33:44:55', style:accessSecondaryStyle});

				function update(action, mac, button, retry) {
					var net = data.networks.find(function(item) { return item.ifname === selector.value; });
					if (saving || !net || net.reason || (action === 'block' && net.block_reason)) return;
					if (!/^(?:[\da-f]{2}:){5}[\da-f]{2}$/i.test(mac) ||
					    mac === '00:00:00:00:00:00' || parseInt(mac.slice(0, 2), 16) % 2) {
						status.textContent = _('Enter a valid unicast MAC address.');
						return;
					}
					var confirmation = action === 'block'
						? _('Block %s from joining %s? If this is your device, you may lose access.').format(mac, net.ssid)
						: _('Unblock %s on %s?').format(mac, net.ssid);
					if (!retry && !window.confirm(confirmation)) return;
					saving = true;
					button.disabled = selector.disabled = true;
					status.textContent = _('Saving Wi-Fi block list…');
					return wifiAccess([action, net.ifname, mac]).then(function(result) {
						if (result.success !== true) throw new Error(_('Could not save the Wi-Fi block list.'));
						var message = result.applied ? (action === 'block' ? _('Device blocked on this Wi-Fi network.') : _('Device unblocked on this Wi-Fi network.'))
							: result.inactive ? _('Saved. The change will apply when this Wi-Fi network starts.')
							: _('Saved, but the router could not confirm live application. Reload Wi-Fi to apply the saved list.');
						var pending = !result.applied && !result.inactive ? {action:action, mac:mac, ifname:net.ifname} : null;
						return refresh(net.ifname, '', message, pending);
					}).catch(function(error) {
						status.textContent = error.message;
					}).finally(function() {
						saving = false;
						button.disabled = selector.disabled = false;
					});
				}

				function showRules() {
					var net = data.networks.find(function(item) { return item.ifname === selector.value; });
					if (!net || net.reason) return dom.content(rules, E('p', {}, [net ? net.reason : _('Select a Wi-Fi network.')]));
					var block = E('button', {type:'button', class:'btn cbi-button-remove',
						style:accessControlStyle + 'background: #ef4444; color: #ffffff; border: 1px solid #ef4444;',
						click:function() { return update('block', input.value.trim(), block); }}, _('Block device'));
					var rows = (Array.isArray(net.blocked) ? net.blocked : []).map(function(mac) {
						var unblock = E('button', {type:'button', class:'btn cbi-button-neutral', style:accessSecondaryStyle,
							click:function() { return update('unblock', mac, unblock); }}, _('Unblock'));
						return E('li', {style:'display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 6px;'},
							[E('code', {style:'background: transparent; color: inherit;'}, [mac]), unblock]);
					});
					var retry;
					if (pendingChange && pendingChange.ifname === net.ifname) {
						retry = E('button', {type:'button', class:'btn cbi-button-neutral', style:accessSecondaryStyle,
							click:function() { return update(pendingChange.action, pendingChange.mac, retry, true); }}, _('Retry live change'));
					}
					dom.content(rules, [
						retry,
						net.block_reason ? E('p', {}, [net.block_reason]) : E('div', {}, [
							E('label', {'for':'jun-wifi-block-mac'}, [_('Device MAC address')]),
							E('div', {style:'display: flex; flex-wrap: wrap; gap: 8px;'}, [input, block])
						]),
						rows.length ? E('ul', {style:'padding: 0; margin: 12px 0;'}, rows)
							: E('p', {}, [_('No blocked devices on this network.')])
					]);
				}

				selector.addEventListener('change', showRules);
				dom.content(panel, [E('label', {'for':'jun-wifi-block-network'}, [_('Wi-Fi network')]), E('div', {}, selector), rules]);
				showRules();
				status.textContent = message || (preferred && !available
					? _('The original Wi-Fi network is no longer available. Choose a network to continue.') : '');
			}).catch(function(error) {
				var failure = error.message || _('Wi-Fi access settings are unavailable.');
				status.textContent = message ? message + ' ' + failure : failure;
				dom.content(panel, E('button', {type:'button', class:'btn cbi-button-neutral', style:accessSecondaryStyle,
					click:function() { return refresh(preferred, pendingMac, message, pendingChange); }}, _('Reload list')));
			});
		}

		return refresh(preferredNetwork, station);
	},

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
			E('p', {}, [_('Temporarily disconnect ') + mac + ' (' + wifinet.getShortName() + ')?']),
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
						E('div', {style:'font-size: 15px; font-weight: 600; color: var(--jw-text-primary, #0f172a);'}, [ssid]),
						E('div', {style:'font-size: 12px; color: var(--jw-text-secondary, #64748b); margin-top: 4px;'}, [description]),
						E('div', {style:'font-size: 12px; color: var(--jw-text-secondary, #64748b); margin-top: 4px;'}, [_('Security: ') + security]),
						E('button', {'class':'btn cbi-button cbi-button-action', style:'margin-top: 12px; min-height: 44px; background: #0284c7; color: #ffffff; border: 0; font-size: 12px; font-weight: 600; padding: 6px 14px; border-radius: 6px;', click:function() {
							var copy;
							if (navigator.clipboard && navigator.clipboard.writeText) copy = navigator.clipboard.writeText(ssid);
							else {
								var field = E('textarea', {readonly:'', style:'position: fixed; left: -9999px;'});
								field.value = ssid;
								document.body.appendChild(field); field.select();
								var copied = document.execCommand('copy'); document.body.removeChild(field);
								copy = copied ? Promise.resolve() : Promise.reject(new Error('Copy unavailable'));
							}
							return copy.then(function() { ui.addNotification(null, E('p', {}, [_('SSID copied: ') + ssid])); }).catch(function() { ui.addNotification(null, E('p', {}, _('Select the network name to copy it.'))); });
						}}, _('Copy SSID'))
					]),
					E('div', {style:'flex: 0 1 180px; min-width: 0;'}, [image])
				]);
			});
			ui.showModal(_('Fast Wi-Fi Connection'), [
				E('p', {style:'font-size: 12px; color: var(--jw-text-secondary, #64748b); margin-bottom: 12px;'}, _('Scan to join. Each QR code includes the network password; share it only with devices you trust.')),
				E('div', {}, items.length ? items : [E('p', {}, _('No active Wi-Fi networks are available.'))]),
				E('div', {style:'text-align: right; margin-top: 14px;'}, [E('button', {'class':'btn cbi-button cbi-button-neutral', style:'min-height: 44px; background: var(--jw-bg-surface, #ffffff); border: 1px solid var(--jw-border-strong, #cbd5e1); color: var(--jw-text-primary, #334155); font-size: 12px; font-weight: 600; padding: 6px 14px; border-radius: 6px;', click:ui.hideModal}, _('Close'))])
			], 'junwrt-wifi-connect');
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
		var networks = data[1] || [];
		var hosthints = data[2] || {};
		var error = data[3];

		var rows = [];
		var totalClients = 0;
		var labels = [_('Radio / SSID'), _('MAC address'), _('Client / IP'), _('Signal'), _('PHY link rate'), _('Actions')];
		function cell(index, className, content) {
			return E('div', {class:className}, [E('span', {class:'jun-wifi-station-label'}, [labels[index]])].concat(content));
		}

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

				rows.push(E('div', {class:'client-row'}, [
					cell(0, 'jun-wifi-station-network', [
						E('strong', {}, [net.vendor ? net.getShortName() : (net.getActiveSSID() || net.getShortName())])
					]),
					cell(1, 'jun-wifi-station-mac', [bss.mac]),
					cell(2, 'jun-wifi-station-host', [
						E('strong', {}, [hostStr]),
						E('div', {class:'jun-wifi-station-ip'}, [ipDetail])
					]),
					cell(3, 'jun-wifi-station-signal', [
						E('span', {style:'font-weight: 600; color: ' + sigColor},
							[hasSignal ? bss.signal + ' dBm' : _('Unavailable')]),
						hasSignal ? ' (' + q + '%)' : ''
					]),
					cell(4, 'jun-wifi-station-rate', [
						E('div', {}, ['RX: ', E('strong', {}, [rxStr])]),
						E('div', {}, ['TX: ', E('strong', {}, [txStr])])
					]),
					E('div', {class:'jun-wifi-station-actions'}, [
						actionBtn,
						net.vendor ? E('button', {type:'button', class:'btn cbi-button-neutral', style:accessSecondaryStyle,
							click:L.bind(this.handleWifiAccess, this, net.getIfname(), bss.mac)}, _('Block…')) : null
					])
				]));
			}
		}

		var tableBody = rows.length ? E('div', {class:'jun-wifi-stations-table'}, [
			E('div', {class:'jun-wifi-stations-head'}, labels.map(function(label) { return E('span', {}, [label]); })),
			E('div', {}, rows)
		]) : E('p', {}, [error || _('No wireless stations currently associated.')]);

		return E('div', {class:'cbi-section jun-wifi-stations'}, [
			E('link', {rel:'stylesheet', href:L.resource('view/status/junwrt-wifi-stations.css')}),
			E('div', {class:'jun-wifi-stations-header'}, [
				E('div', {}, [
					E('h4', {class:'jun-wifi-stations-title'}, [_('Wireless Associated Stations')]),
					E('span', {}, [error ? _('Station count unavailable') : _('%s Associated Stations').format(totalClients)])
				]),
				E('div', {class:'jun-wifi-stations-toolbar'}, [
					E('button', {type:'button', class:'btn cbi-button-neutral', style:accessSecondaryStyle,
						click:L.bind(this.handleWifiAccess, this, null, null)}, _('Manage blocked devices')),
					E('button', {type:'button', class:'btn cbi-button-neutral', style:accessSecondaryStyle,
						click:L.bind(this.handleShowQR, this, networks)}, _('Fast Connect QR'))
				])
			]),
			E('div', {class:'jun-wifi-stations-body'}, [
				rows.length && error ? E('p', {role:'status'}, [error]) : null,
				tableBody
			]),
			networks.some(function(net) { return net.vendor; }) ? E('p', {class:'jun-wifi-stations-note'},
				[_('Last reported PHY rates. RX is from the device and TX is to the device.')]) : null
		]);
	}
});
