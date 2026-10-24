'use strict';
'require view';
'require fs';
'require ui';

return view.extend({
	load: function() {
		return Promise.all([
			L.resolveDefault(fs.exec_direct('/usr/bin/junwrt-license', ['info']), '{}'),
			L.resolveDefault(fs.trimmed('/etc/junwrt_machine_id'), '').catch(function() { return ''; }),
			L.resolveDefault(fs.exec_direct('/usr/bin/junwrt-license', ['machine-id']), '').catch(function() { return ''; })
		]);
	},

	render: function(data) {
		var infoRaw   = data[0] || '{}';
		var fileMid   = (typeof data[1] === 'string') ? data[1].trim() : '';
		var rawMid    = (typeof data[2] === 'string') ? data[2].trim() : '';
		var info = {};
		try {
			info = JSON.parse(infoRaw);
		} catch (e) {
			info = {};
		}

		var isActivated = (info.status === 'activated');
		var machineId = info.machine_id || fileMid || rawMid || 'AW1K-UNKNOWN';
		var payload = info.payload || {};

		var statusBg = isActivated ? '#e8f9f0' : '#fef3c7';
		var statusBorder = isActivated ? '#a7f3d0' : '#fde68a';
		var statusColor = isActivated ? '#10b981' : '#b45309';
		var statusText = isActivated ? (Number(payload.expires_at) > 0 ? 'Active (Time limited)' : 'Active (Perpetual)') : 'Unactivated (Locked)';

		// License Details (when active)
		var detailsSection = null;
		if (isActivated) {
			var issueStr = payload.issued_at ? new Date(payload.issued_at * 1000).toLocaleString() : '-';
			var expStr = payload.expires_at ? new Date(payload.expires_at * 1000).toLocaleString() : 'Never (Lifetime)';

			detailsSection = E('div', {
				'style': 'background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 18px; margin-bottom: 20px;'
			}, [
				E('div', { 'style': 'font-size: 11px; font-weight: 700; color: #0f172a; margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.05em;' }, 'Certificate Details'),
				E('div', { 'style': 'display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px; font-size: 12px;' }, [
					E('div', {}, [
						E('div', { 'style': 'color: #94a3b8; font-size: 11px; text-transform: uppercase; font-weight: 600;' }, 'Licensed To:'),
						E('div', { 'style': 'font-weight: 600; color: #0f172a; margin-top: 2px;' }, payload.customer || 'Commercial Licensee')
					]),
					E('div', {}, [
						E('div', { 'style': 'color: #94a3b8; font-size: 11px; text-transform: uppercase; font-weight: 600;' }, 'License Tier:'),
						E('div', { 'style': 'font-weight: 700; color: #10b981; margin-top: 2px;' }, payload.type || 'Perpetual')
					]),
					E('div', {}, [
						E('div', { 'style': 'color: #94a3b8; font-size: 11px; text-transform: uppercase; font-weight: 600;' }, 'Issue Date:'),
						E('div', { 'style': 'color: #334155; margin-top: 2px;' }, issueStr)
					]),
					E('div', {}, [
						E('div', { 'style': 'color: #94a3b8; font-size: 11px; text-transform: uppercase; font-weight: 600;' }, 'Expiration:'),
						E('div', { 'style': 'color: #334155; margin-top: 2px;' }, expStr)
					])
				])
			]);
		}

		var feedbackBox = E('div', {
			'id': 'activation-feedback',
			'style': 'display: none; padding: 12px 16px; border-radius: 6px; margin-bottom: 16px; font-size: 12px; font-weight: 600;'
		});

		var keyInput = E('textarea', {
			'id': 'license-key-input',
			'rows': 3,
			'placeholder': 'Paste activation token here (format: eyJ...)...',
			'style': 'width: 100%; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 12px; padding: 12px; border: 1px solid #cbd5e1; border-radius: 6px; background: #ffffff; color: #0f172a; resize: vertical; box-sizing: border-box; outline: none;'
		});

		var activateBtn = E('button', {
			'class': 'cbi-button',
			'style': 'background-color: #0284c7; color: #ffffff !important; font-weight: 600; padding: 8px 22px; border: none; border-radius: 6px; cursor: pointer; font-size: 13px; transition: background-color 0.15s ease;',
			'click': function(ev) {
				var btn = ev.target;
				var key = keyInput.value.trim();
				if (!key) {
					feedbackBox.style.display = 'block';
					feedbackBox.style.background = '#fef2f2';
					feedbackBox.style.color = '#ef4444';
					feedbackBox.style.border = '1px solid #fecaca';
					feedbackBox.textContent = 'Please enter an activation token.';
					return;
				}

				btn.disabled = true;
				btn.textContent = 'Verifying...';

				return fs.exec('/usr/bin/junwrt-license', ['activate', key])
					.then(function(res) {
						var parsed = {};
						try { parsed = JSON.parse(res.stdout || '{}'); } catch(e) { parsed = { success: false, message: 'Invalid response from the activation service.' }; }

						if (res.code === 0 && parsed.success === true) {
							feedbackBox.style.display = 'block';
							feedbackBox.style.background = '#e8f9f0';
							feedbackBox.style.color = '#10b981';
							feedbackBox.style.border = '1px solid #a7f3d0';
							feedbackBox.textContent = parsed.message + ' Reloading...';
							setTimeout(function() {
								window.location.reload();
							}, 1500);
						} else {
							feedbackBox.style.display = 'block';
							feedbackBox.style.background = '#fef2f2';
							feedbackBox.style.color = '#ef4444';
							feedbackBox.style.border = '1px solid #fecaca';
							feedbackBox.textContent = 'Activation Failed: ' + (parsed.message || 'Invalid signature.');
							btn.disabled = false;
							btn.textContent = 'Activate';
						}
					})
					.catch(function(err) {
						feedbackBox.style.display = 'block';
						feedbackBox.style.background = '#fef2f2';
						feedbackBox.style.color = '#ef4444';
						feedbackBox.style.border = '1px solid #fecaca';
						feedbackBox.textContent = 'Activation error: ' + (err.message || err);
						btn.disabled = false;
						btn.textContent = 'Activate';
					});
			}
		}, 'Activate');

		function fallbackCopy(text, onSuccess) {
			var ta = document.createElement('textarea');
			ta.value = text;
			ta.style.position = 'fixed';
			ta.style.left = '-9999px';
			ta.style.top = '-9999px';
			document.body.appendChild(ta);
			ta.focus();
			ta.select();
			try {
				document.execCommand('copy');
				onSuccess();
			} catch (err) {}
			document.body.removeChild(ta);
		}

		var copyBtn = E('button', {
			'class': 'cbi-button',
			'style': 'background-color: #0284c7; color: #ffffff !important; border: none; padding: 6px 14px; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer; transition: background-color 0.15s ease;',
			'click': function(ev) {
				var btn = ev.target;
				var origText = btn.textContent;
				var onCopied = function() {
					btn.textContent = 'Copied';
					btn.style.backgroundColor = '#10b981';
					setTimeout(function() {
						btn.textContent = origText;
						btn.style.backgroundColor = '#0284c7';
					}, 2000);
				};
				if (navigator.clipboard && navigator.clipboard.writeText) {
					navigator.clipboard.writeText(machineId).then(onCopied).catch(function() {
						fallbackCopy(machineId, onCopied);
					});
				} else {
					fallbackCopy(machineId, onCopied);
				}
			}
		}, 'Copy');

		var bodyElements = [
			// Machine ID Banner
			E('div', {
				'style': 'background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 20px; margin-bottom: 20px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px;'
			}, [
				E('div', {}, [
					E('div', { 'style': 'font-size: 11px; font-weight: 700; text-transform: uppercase; color: #94a3b8; letter-spacing: 0.05em;' }, 'Hardware Machine ID:'),
					E('div', { 'style': 'font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 18px; font-weight: 700; color: #0f172a; margin-top: 4px;' }, machineId),
					E('div', { 'style': 'font-size: 12px; color: #64748b; margin-top: 3px;' }, 'Submit this hardware ID to your distributor to generate an activation key.')
				]),
				E('div', {}, [copyBtn])
			])
		];

		// Certificate details if activated
		if (detailsSection)
			bodyElements.push(detailsSection);

		bodyElements.push(
			// Activation Form
			E('div', {
				'style': 'border-top: 1px solid #e2e8f0; padding-top: 18px;'
			}, [
				E('div', { 'style': 'font-size: 13px; font-weight: 700; color: #0f172a; margin-bottom: 4px;' }, isActivated ? 'Update License Token' : 'Enter Activation Token'),
				E('div', { 'style': 'font-size: 12px; color: #64748b; margin-bottom: 12px;' }, 'Paste the cryptographic token provided by your distributor below:'),
				feedbackBox,
				keyInput,
				E('div', { 'style': 'margin-top: 14px; display: flex; justify-content: flex-end;' }, [activateBtn])
			])
		);

		return E('div', {
			'class': 'cbi-section junwrt-card junwrt-activation-page',
			'style': 'background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; box-shadow: 0 1px 3px rgba(15, 23, 42, 0.04), 0 4px 12px rgba(15, 23, 42, 0.03); margin-bottom: 20px; overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;'
		}, [
			// Top Header
			E('div', {
				'style': 'display: flex; align-items: center; justify-content: space-between; padding: 18px 24px; border-bottom: 1px solid #e2e8f0; background: #ffffff; flex-wrap: wrap; gap: 10px;'
			}, [
				E('div', {}, [
					E('div', { 'style': 'font-size: 16px; font-weight: 700; color: #0f172a;' }, 'JunWRT Commercial Licensing'),
					E('div', { 'style': 'font-size: 12px; color: #64748b; margin-top: 2px;' }, 'MediaTek MT6890 / T750 System')
				]),
				E('div', {
					'style': 'background: ' + statusBg + '; color: ' + statusColor + '; border: 1px solid ' + statusBorder + '; font-size: 11px; font-weight: 700; padding: 4px 12px; border-radius: 9999px; text-transform: uppercase; letter-spacing: 0.04em;'
				}, statusText)
			]),

			// Body
			E('div', { 'style': 'padding: 24px;' }, bodyElements),

			// Clean Footer
			E('div', {
				'style': 'display: flex; align-items: center; justify-content: space-between; padding: 12px 24px; background: #f8fafc; border-top: 1px solid #e2e8f0; font-size: 11px; color: #64748b;'
			}, [
				E('div', {}, 'JunWRT Commercial Licensing Subsystem'),
				E('div', {}, 'RSA-2048 Cryptographic Verification Engine')
			])
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
