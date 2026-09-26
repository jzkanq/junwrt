'use strict';
'require view';
'require poll';
'require fs';
'require ui';

function runCommand(args) {
	/* Blocklist downloads can exceed LuCI's default 20-second RPC timeout. */
	L.env.rpctimeout = Math.max(Number(L.env.rpctimeout) || 20, 150);
	return fs.exec('/usr/bin/junwrt-adblock', args).then(function(result) {
		if (Number(result?.code) !== 0)
			throw new Error(String(result?.stdout || result?.stderr || _('Ad Blocker command failed.')).trim());
		return result;
	});
}

function callGetStatus() {
	return runCommand(['status']).then(function(result) {
		var data;
		try {
			data = JSON.parse(result.stdout);
		} catch (e) {
			throw new Error(_('Ad Blocker returned invalid status data.'));
		}
		var enabled = Number(data?.enabled);
		var active = Number(data?.active);
		var domains = Number(data?.domains);
		if ((enabled !== 0 && enabled !== 1) || (active !== 0 && active !== 1) || !isFinite(domains) || domains < 0)
			throw new Error(_('Ad Blocker returned invalid status data.'));
		data.enabled = enabled === 1;
		data.active = active === 1;
		data.domains = domains;
		return data;
	});
}

function runAction(args) {
	return runCommand(args).then(function(result) {
		return { message: String(result.stdout || '').trim() };
	});
}

function callSaveSource(source) {
	return runAction(['save-source', source]);
}

function callUpdateNow(source) {
	return runAction(source ? ['update', source] : ['update']);
}

function callSetEnabled(enabled, source) {
	return runAction(enabled ? (source ? ['enable', source] : ['enable']) : ['disable']);
}
const DEFAULT_SOURCE = 'https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts';
var statusPollFn = null;

function formatCount(value) {
	var count = Number(value || 0);
	return isFinite(count) ? count.toLocaleString() : '0';
}

return view.extend({
	load: function() {
		return callGetStatus();
	},

	render: function(status) {
		var root = E('div', { 'class': 'jun-adblock-page' });
		var sourceInput = E('input', {
			'class': 'adblock-source-input',
			'type': 'url',
			'inputmode': 'url',
			'autocomplete': 'url',
			'spellcheck': 'false',
			'aria-label': _('HTTPS blocklist URL'),
			'value': status?.source || DEFAULT_SOURCE
		});
		var statusPill = E('span', { 'class': 'adblock-status-pill' }, _('Loading'));
		var countValue = E('div', { 'class': 'adblock-stat-value' }, '0');
		var updatedValue = E('div', { 'class': 'adblock-stat-value' }, _('Never'));
		var message = E('div', { 'class': 'adblock-message', 'role': 'status', 'aria-live': 'polite', 'hidden': 'hidden' });
		var saveButton = E('button', { 'class': 'adblock-button adblock-button-secondary', 'type': 'button' }, _('Save source'));
		var updateButton = E('button', { 'class': 'adblock-button adblock-button-primary', 'type': 'button' }, _('Update blocklist'));
		var toggleButton = E('button', { 'class': 'adblock-button adblock-button-primary', 'type': 'button' }, _('Enable ad blocking'));
		var currentStatus = status || {};
		var actionBusy = false;

		function showMessage(text, isError) {
			message.textContent = text || '';
			message.hidden = !text;
			message.classList.toggle('is-error', !!isError);
		}

		function updateSummary(data) {
			currentStatus = data || {};
			countValue.textContent = formatCount(currentStatus.domains);
			updatedValue.textContent = currentStatus.last_update || _('Never');
			if (currentStatus.active) {
				statusPill.textContent = _('Protection active');
				statusPill.classList.remove('is-offline');
				toggleButton.textContent = _('Disable ad blocking');
				toggleButton.classList.remove('adblock-button-primary');
				toggleButton.classList.add('adblock-button-warning');
			} else if (currentStatus.enabled) {
				statusPill.textContent = _('Enabled · waiting for DNS');
				statusPill.classList.add('is-offline');
				toggleButton.textContent = _('Disable ad blocking');
				toggleButton.classList.remove('adblock-button-primary');
				toggleButton.classList.add('adblock-button-warning');
			} else {
				statusPill.textContent = _('Disabled');
				statusPill.classList.add('is-offline');
				toggleButton.textContent = _('Enable ad blocking');
				toggleButton.classList.remove('adblock-button-warning');
				toggleButton.classList.add('adblock-button-primary');
			}
		}

		function setBusy(busy, label) {
			actionBusy = busy;
			saveButton.disabled = busy;
			updateButton.disabled = busy;
			toggleButton.disabled = busy;
			if (busy && label)
				showMessage(label, false);
		}

		function refreshStatus() {
			return callGetStatus().then(function(data) {
				if (data?.error)
					throw new Error(data.error);
				updateSummary(data);
				return data;
			});
		}

		function performAction(action, pendingText, successText, verifyStatus) {
			setBusy(true, pendingText);
			return action().then(function(result) {
				if (result?.error)
					throw new Error(result.error);
				return refreshStatus().then(function(data) {
					if (verifyStatus) {
						var verificationError = verifyStatus(data);
						if (verificationError)
							throw new Error(verificationError);
					}
					showMessage(result?.message || successText, false);
				});
			}).catch(function(error) {
				showMessage(error.message || String(error), true);
			}).finally(function() {
				setBusy(false);
			});
		}

		saveButton.addEventListener('click', function() {
			return performAction(function() {
				return callSaveSource(sourceInput.value.trim());
			}, _('Saving blocklist source…'), _('Blocklist source saved.'));
		});

		updateButton.addEventListener('click', function() {
			return performAction(function() {
				return callUpdateNow(sourceInput.value.trim());
			}, _('Downloading and validating the blocklist…'), _('Blocklist updated.'), function(data) {
				return Number(data?.domains || 0) > 0 && data?.last_update ? null : _('The update finished, but no usable blocklist is available.');
			});
		});

		toggleButton.addEventListener('click', function() {
			var enable = !currentStatus.enabled;
			return performAction(function() {
				return callSetEnabled(enable, sourceInput.value.trim());
			}, enable ? _('Preparing the blocklist and enabling DNS ad blocking…') : _('Disabling DNS ad blocking…'), enable ? _('DNS ad blocking enabled.') : _('DNS ad blocking disabled.'), function(data) {
				return (!!data?.enabled) == enable ? null : _('Ad Blocker status still reports enabled=%s after the command.').format(data?.enabled ? '1' : '0');
			});
		});

		updateSummary(currentStatus);
		if (currentStatus.error)
			showMessage(currentStatus.error, true);
		root.appendChild(E('link', { 'rel': 'stylesheet', 'href': L.resource('view/adblocker.css') }));
		root.appendChild(E('header', { 'class': 'adblock-header' }, [
			E('div', {}, [
				E('h1', { 'class': 'adblock-title' }, _('Ad Blocker')),
				E('p', { 'class': 'adblock-description' }, _('Block advertising, tracking, and known malicious domains for devices that use JunWRT DNS.'))
			]),
			statusPill
		]));
		root.appendChild(E('section', { 'class': 'adblock-card' }, [
			E('div', { 'class': 'adblock-card-heading' }, E('h2', { 'class': 'adblock-card-title' }, _('Protection status'))),
			E('div', { 'class': 'adblock-stats' }, [
				E('div', { 'class': 'adblock-stat' }, [
					E('span', { 'class': 'adblock-stat-label' }, _('Blocked domains')),
					countValue
				]),
				E('div', { 'class': 'adblock-stat' }, [
					E('span', { 'class': 'adblock-stat-label' }, _('Last updated')),
					updatedValue
				])
			]),
			E('div', { 'class': 'adblock-actions' }, toggleButton)
		]));
		root.appendChild(E('section', { 'class': 'adblock-card' }, [
			E('div', { 'class': 'adblock-card-heading' }, E('h2', { 'class': 'adblock-card-title' }, _('Blocklist'))),
			E('label', { 'class': 'adblock-field-label' }, [_('HTTPS blocklist URL'), sourceInput]),
			E('p', { 'class': 'adblock-help' }, _('The default source is StevenBlack’s unified hosts list for ads, trackers, and malware. Use a hosts-format list or a plain list of domains. Enable downloads the list first when no usable list is installed.')),
			E('div', { 'class': 'adblock-actions' }, [saveButton, updateButton]),
			message,
			E('p', { 'class': 'adblock-footnote' }, _('DNS filtering applies to clients using the router for DNS. Clients using private DNS, a VPN DNS service, or another DNS server may bypass this protection. Updating keeps the previous list if download or validation fails.'))
		]));

		if (statusPollFn)
			poll.remove(statusPollFn);

		statusPollFn = function() {
			if (actionBusy || !root.isConnected)
				return Promise.resolve();

			return refreshStatus().then(function(data) {
				if (data?.active && message.classList.contains('is-error'))
					showMessage('', false);
			}).catch(function() {
				/* Keep the last known status visible and retry on the next poll. */
			});
		};
		poll.add(statusPollFn, 10);

		return root;
	}
});
