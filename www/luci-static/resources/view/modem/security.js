'use strict';
'require view';
'require fs';
'require poll';
'require ui';

var refreshPoll;
var LEVELS = { ok: [_('OK'), 'is-ok'], warn: [_('Review'), 'is-warn'], bad: [_('Fix now'), 'is-bad'] };
var FIXES = {
    'dropbear-lan': _('Limit SSH to the local network'),
    'upnp-off': _('Turn UPnP off')
};

function command(args) {
    return fs.exec('/usr/bin/junwrt-security', args).then(function(result) {
        var data;
        try { data = JSON.parse(result.stdout || '{}'); }
        catch (e) { throw new Error(_('Invalid response from the security check.')); }
        if (Number(result.code) !== 0 || data.error)
            throw new Error(data.error || result.stderr || _('Security check failed.'));
        return data;
    });
}

return view.extend({
    load: function() { return command(['status']); },
    render: function(data) {
        var root = E('div', { 'class': 'jun-ui jun-security-page' });
        var pill = E('span', { 'class': 'ju-pill' });
        var summary = E('p', { 'class': 'ju-help' });
        var list = E('div', { 'class': 'ju-list' });
        var message = E('p', { 'class': 'ju-message', role: 'status', 'aria-live': 'polite' });
        var busy = false;

        function say(text, isError) {
            message.textContent = text || '';
            message.classList.toggle('is-error', !!isError);
        }
        function setBusy(state) {
            busy = state;
            root.querySelectorAll('button').forEach(function(b) { b.disabled = state; });
        }
        function applyFix(id) {
            if (busy) return Promise.resolve();
            setBusy(true);
            say(_('Applying…'));
            return command(['fix', id]).then(function() {
                return command(['status']).then(function(status) { show(status); say(_('Done.')); });
            }).catch(function(error) { say(error.message, true); }).finally(function() { setBusy(false); });
        }
        function confirmFix(check) {
            ui.showModal(FIXES[check.fix], [
                E('p', {}, check.fix === 'dropbear-lan'
                    ? _('SSH will answer on the local network only. Remote SSH over the internet, or over a VPN that terminates on this router, stops working.')
                    : _('Devices that rely on UPnP to open ports will need manual port forwarding afterwards.')),
                E('div', { 'class': 'right' }, [
                    E('button', { 'class': 'btn cbi-button cbi-button-neutral', click: ui.hideModal }, _('Cancel')), ' ',
                    E('button', { 'class': 'btn cbi-button cbi-button-action', click: function() { ui.hideModal(); return applyFix(check.fix); } }, FIXES[check.fix])
                ])
            ]);
        }
        function show(status) {
            var level = LEVELS[status.worst] || LEVELS.ok;
            var problems = status.checks.filter(function(c) { return c.level !== 'ok'; }).length;
            pill.className = 'ju-pill ' + level[1];
            pill.textContent = status.worst === 'ok' ? _('All checks passed') : _('%s to review').format(problems);
            summary.textContent = status.worst === 'ok' ? _('Nothing needs your attention.')
                : _('Work through the items marked below; each one explains what to change.');
            list.replaceChildren();
            status.checks.forEach(function(check) {
                var l = LEVELS[check.level] || LEVELS.ok;
                var actions = [];
                if (check.fix && FIXES[check.fix]) {
                    var button = E('button', { type: 'button', 'class': 'ju-button ju-primary cbi-button-action' }, FIXES[check.fix]);
                    button.addEventListener('click', function() { confirmFix(check); });
                    actions.push(button);
                }
                if (check.id === 'password' && check.level !== 'ok')
                    actions.push(E('a', { 'class': 'ju-button ju-primary cbi-button-action', href: L.url('admin/system/admin') }, _('Change password')));
                if (check.id === 'wifi' && check.level !== 'ok')
                    actions.push(E('a', { 'class': 'ju-button ju-secondary cbi-button-neutral', href: L.url('admin/network/wireless') }, _('Open Wi-Fi settings')));
                list.appendChild(E('div', { 'class': 'ju-row' }, [
                    E('div', { 'class': 'ju-row-main' }, [E('h3', {}, check.title), E('p', { 'class': 'ju-help' }, check.detail),
                        actions.length ? E('div', { 'class': 'ju-actions' }, actions) : '']),
                    E('span', { 'class': 'ju-pill ' + l[1] }, l[0])
                ]));
            });
        }

        root.appendChild(E('link', { rel: 'stylesheet', href: L.resource('view/modem/junwrt-ui.css') }));
        root.appendChild(E('header', { 'class': 'ju-header' }, [
            E('div', {}, [E('h1', {}, _('Security')),
                E('p', { 'class': 'ju-help' }, _('Checks who can reach your router and shows how to close the gaps. Nothing is changed unless you press a button.'))]),
            pill]));
        root.appendChild(E('section', { 'class': 'ju-card' }, [
            E('div', { 'class': 'ju-card-head' }, E('h2', {}, _('Checks'))), summary, list, message
        ]));
        root.appendChild(E('details', { 'class': 'ju-details' }, [E('summary', {}, _('What is checked')),
            E('p', { 'class': 'ju-help' }, _('The administrator password (still the factory one, or none), whether the internet side of the firewall accepts connections or SSH, whether UPnP is on, and whether any Wi-Fi network is open. The check only reads settings on this router.'))]));

        show(data);
        if (refreshPoll) poll.remove(refreshPoll);
        refreshPoll = function() {
            if (busy || !root.isConnected) return Promise.resolve();
            return command(['status']).then(show).catch(function() {});
        };
        poll.add(refreshPoll, 60);
        return root;
    },
    handleSaveApply: null,
    handleSave: null,
    handleReset: null
});
