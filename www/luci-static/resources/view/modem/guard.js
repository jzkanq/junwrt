'use strict';
'require view';
'require fs';
'require poll';

var refreshPoll;
var STATES = {
    ok: [_('Online'), 'is-ok'],
    degraded: [_('Checks failing'), 'is-warn'],
    recovering: [_('Recovering'), 'is-warn'],
    stopped: [_('Service not running'), 'is-bad'],
    disabled: [_('Off'), '']
};
var ACTIONS = { redial: _('Re-dialed the interface'), radio: _('Restarted the modem radio'), reboot: _('Rebooted the router') };

function command(args) {
    return fs.exec('/usr/bin/junwrt-guard', args).then(function(result) {
        var data;
        try { data = JSON.parse(result.stdout || '{}'); }
        catch (e) { throw new Error(_('Invalid response from Connection Guard.')); }
        if (Number(result.code) !== 0 || data.error)
            throw new Error(data.error || result.stderr || _('Connection Guard command failed.'));
        return data;
    });
}

function ago(now, then) {
    var s = Math.max(0, Number(now) - Number(then));
    if (!Number(then)) return _('Never');
    if (s < 90) return _('%s s ago').format(s);
    if (s < 5400) return _('%s min ago').format(Math.round(s / 60));
    if (s < 172800) return _('%s h ago').format(Math.round(s / 3600));
    return _('%s days ago').format(Math.round(s / 86400));
}

function stat(label, valueNode) {
    return E('div', { 'class': 'ju-stat' }, [E('span', { 'class': 'ju-label' }, label), valueNode]);
}

function option(value, label, selected) {
    return E('option', { value: String(value), selected: String(value) === String(selected) ? 'selected' : null }, label);
}

return view.extend({
    load: function() { return command(['status']); },
    render: function(data) {
        var root = E('div', { 'class': 'jun-ui jun-guard-page' });
        var pill = E('span', { 'class': 'ju-pill' });
        var values = {};
        var message = E('p', { 'class': 'ju-message', role: 'status', 'aria-live': 'polite' });
        var log = E('ul', { 'class': 'ju-log' });
        var logEmpty = E('p', { 'class': 'ju-empty' }, _('No events yet.'));
        var current = data;
        var busy = false;
        var form = {};

        ['state', 'device', 'last_ok', 'fails', 'last_action', 'actions'].forEach(function(key) {
            values[key] = E('span', { 'class': 'ju-value' + (key === 'device' || key === 'last_action' ? ' is-text' : '') }, '–');
        });
        function toggle(key, label, help) {
            form[key] = E('input', { type: 'checkbox', id: 'guard-' + key });
            return E('div', { 'class': 'ju-field is-wide' }, [
                E('label', { 'class': 'ju-check', 'for': 'guard-' + key }, [form[key], label]),
                help ? E('small', {}, help) : ''
            ]);
        }
        function field(key, label, input, help, wide) {
            form[key] = input;
            return E('label', { 'class': 'ju-field' + (wide ? ' is-wide' : '') }, [E('span', {}, label), input, help ? E('small', {}, help) : '']);
        }
        function select(key, label, choices, help) {
            return field(key, label, E('select', {}, choices.map(function(c) { return option(c[0], c[1], ''); })), help);
        }
        function buttonsDisabled(state) {
            root.querySelectorAll('button').forEach(function(button) { button.disabled = state; });
        }
        function setChoice(select, value) {
            var wanted = String(value);
            var found = Array.prototype.some.call(select.options || [], function(o) { return o.value === wanted; });
            if (!found) select.appendChild(option(wanted, wanted, wanted));
            select.value = wanted;
        }
        function fillForm(config, enabled) {
            form.enabled.checked = !!enabled;
            setChoice(form.interval, config.interval);
            setChoice(form.failures, config.failures);
            form.targets.value = config.targets;
            form.redial.checked = config.redial === 1;
            form.radio.checked = config.radio === 1;
            form.reboot.checked = config.reboot === 1;
            setChoice(form.cooldown, config.cooldown);
            setChoice(form.max_per_day, config.max_per_day);
            form.iface.value = config.iface;
        }
        function showStatus(status, keepForm) {
            var state = STATES[status.state] || STATES.disabled;
            current = status;
            pill.className = 'ju-pill ' + state[1];
            pill.textContent = state[0];
            values.state.textContent = state[0];
            values.device.textContent = status.device ? status.iface + ' · ' + status.device : status.iface + ' · ' + _('no link');
            values.last_ok.textContent = ago(status.now, status.last_ok);
            values.fails.textContent = _('%s of %s').format(status.fails, status.config.failures);
            values.last_action.textContent = status.last_action ? (ACTIONS[status.last_action] || status.last_action) + ' · ' + ago(status.now, status.last_action_time) : _('None');
            values.actions.textContent = _('%s of %s').format(status.actions, status.config.max_per_day);
            log.replaceChildren();
            (status.events || []).slice().reverse().forEach(function(line) { log.appendChild(E('li', {}, line)); });
            logEmpty.hidden = !!(status.events || []).length;
            if (!keepForm) fillForm(status.config, status.enabled === 1);
        }
        function say(text, isError) {
            message.textContent = text || '';
            message.classList.toggle('is-error', !!isError);
        }
        function run(args, pending, done) {
            if (busy) return Promise.resolve();
            busy = true;
            buttonsDisabled(true);
            say(pending);
            return command(args).then(function(result) {
                return done ? done(result) : result;
            }).catch(function(error) { say(error.message, true); }).finally(function() {
                busy = false;
                buttonsDisabled(false);
            });
        }
        function save() {
            var args = ['save', 'enabled=' + (form.enabled.checked ? 1 : 0), 'interval=' + form.interval.value, 'failures=' + form.failures.value,
                'targets=' + form.targets.value.trim().replace(/[\s,]+/g, ','), 'redial=' + (form.redial.checked ? 1 : 0),
                'radio=' + (form.radio.checked ? 1 : 0), 'reboot=' + (form.reboot.checked ? 1 : 0), 'cooldown=' + form.cooldown.value,
                'max_per_day=' + form.max_per_day.value, 'iface=' + form.iface.value.trim()];
            return run(args, _('Saving…'), function() {
                return command(['status']).then(function(status) {
                    showStatus(status);
                    say(_('Saved. The service applies the new settings on its next check.'));
                });
            });
        }
        function checkNow() {
            return run(['check'], _('Checking the connection…'), function(result) {
                say(result.ok ? _('Online: %s answered through %s.').format(result.target, result.device || _('the default route'))
                    : _('No answer from any target%s.').format(result.device ? _(' through %s').format(result.device) : ''), !result.ok);
            });
        }

        var save_button = E('button', { type: 'button', 'class': 'ju-button ju-primary cbi-button-action' }, _('Save'));
        var check_button = E('button', { type: 'button', 'class': 'ju-button ju-secondary cbi-button-neutral' }, _('Check now'));
        var clear_button = E('button', { type: 'button', 'class': 'ju-button ju-secondary cbi-button-neutral' }, _('Clear events'));
        save_button.addEventListener('click', save);
        check_button.addEventListener('click', checkNow);
        clear_button.addEventListener('click', function() {
            return run(['clear-log'], _('Clearing…'), function() {
                return command(['status']).then(function(status) { showStatus(status, true); say(_('Events cleared.')); });
            });
        });

        root.appendChild(E('link', { rel: 'stylesheet', href: L.resource('view/modem/junwrt-ui.css') }));
        root.appendChild(E('header', { 'class': 'ju-header' }, [
            E('div', {}, [E('h1', {}, _('Connection Guard')),
                E('p', { 'class': 'ju-help' }, _('Watches the cellular connection and, only when it stays down, re-dials it and restarts the modem radio. Off by default.'))]),
            pill]));
        root.appendChild(E('section', { 'class': 'ju-card' }, [
            E('div', { 'class': 'ju-card-head' }, E('h2', {}, _('Status'))),
            E('div', { 'class': 'ju-grid' }, [
                stat(_('State'), values.state), stat(_('Interface'), values.device), stat(_('Last good check'), values.last_ok),
                stat(_('Failed checks'), values.fails), stat(_('Last action'), values.last_action), stat(_('Actions today'), values.actions)
            ])
        ]));
        root.appendChild(E('section', { 'class': 'ju-card' }, [
            E('div', { 'class': 'ju-card-head' }, E('h2', {}, _('Settings'))),
            E('div', { 'class': 'ju-form' }, [
                toggle('enabled', _('Turn Connection Guard on'), _('Checks run through the cellular interface. Nothing is changed while the connection answers.')),
                select('interval', _('Check every'), [[15, _('15 seconds')], [30, _('30 seconds')], [60, _('1 minute')], [120, _('2 minutes')], [300, _('5 minutes')]]),
                select('failures', _('Act after failed checks in a row'), [[2, '2'], [3, '3'], [4, '4'], [6, '6'], [10, '10']]),
                field('targets', _('Check targets'), E('input', { type: 'text', maxlength: '160', placeholder: '1.1.1.1 8.8.8.8' }),
                    _('Up to 4 IP addresses or host names, separated by spaces. The connection counts as up when any one answers.'), true),
                toggle('redial', _('Step 1 · re-dial the interface'), _('Brings the interface down and up again. Safe and quick.')),
                toggle('radio', _('Step 2 · restart the modem radio'), _('Cycles the 5G modem radio (AT+CFUN). The link drops for 20–40 seconds.')),
                toggle('reboot', _('Step 3 · reboot the router'), _('Last resort. Never runs within 15 minutes of boot, and only after the earlier steps have been tried.')),
                select('cooldown', _('Wait between actions'), [[120, _('2 minutes')], [300, _('5 minutes')], [600, _('10 minutes')], [1800, _('30 minutes')]]),
                select('max_per_day', _('Most actions per day'), [[2, '2'], [4, '4'], [6, '6'], [12, '12']]),
                field('iface', _('Interface name'), E('input', { type: 'text', maxlength: '15', placeholder: 'wan' }),
                    _('The OpenWrt interface that carries the cellular connection.'))
            ]),
            E('div', { 'class': 'ju-actions' }, [save_button, check_button]),
            message
        ]));
        root.appendChild(E('section', { 'class': 'ju-card' }, [
            E('div', { 'class': 'ju-card-head' }, [E('h2', {}, _('Recent events')), clear_button]),
            log, logEmpty
        ]));
        root.appendChild(E('details', { 'class': 'ju-details' }, [E('summary', {}, _('How it works')),
            E('p', { 'class': 'ju-help' }, _('Every check sends one ping to each target through the cellular interface. After the chosen number of failed checks in a row, the guard runs the next enabled step, waits, and checks again; a success resets everything. Steps repeat in order, never more often than the cooldown and never more than the daily limit. Settings and events are kept in RAM and UCI only; nothing is sent anywhere.'))]));

        showStatus(data);
        if (refreshPoll) poll.remove(refreshPoll);
        refreshPoll = function() {
            if (busy || !root.isConnected) return Promise.resolve();
            return command(['status']).then(function(status) { showStatus(status, true); }).catch(function() {});
        };
        poll.add(refreshPoll, 5);
        return root;
    },
    handleSaveApply: null,
    handleSave: null,
    handleReset: null
});
