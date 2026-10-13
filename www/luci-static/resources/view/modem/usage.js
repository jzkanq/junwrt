'use strict';
'require view';
'require fs';
'require poll';
'require ui';

var refreshPoll;
var STATES = {
    ok: [_('Within the limit'), 'is-ok'],
    warn: [_('Close to the limit'), 'is-warn'],
    over: [_('Limit reached'), 'is-bad'],
    off: [_('No limit set'), '']
};

function command(args) {
    return fs.exec('/usr/bin/junwrt-usage', args).then(function(result) {
        var data;
        try { data = JSON.parse(result.stdout || '{}'); }
        catch (e) { throw new Error(_('Invalid response from the data usage service.')); }
        if (Number(result.code) !== 0 || data.error)
            throw new Error(data.error || result.stderr || _('Data usage command failed.'));
        return data;
    });
}

function bytes(value) {
    var n = Number(value) || 0;
    var units = ['B', 'kB', 'MB', 'GB', 'TB'];
    var i = 0;
    while (n >= 1000 && i < units.length - 1) { n /= 1000; i++; }
    return (i < 2 ? Math.round(n) : n.toFixed(i === 3 && n >= 100 ? 0 : 1)) + ' ' + units[i];
}

function dayLabel(d) {
    var s = String(d);
    return s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8);
}

function stat(label, node) {
    return E('div', { 'class': 'ju-stat' }, [E('span', { 'class': 'ju-label' }, label), node]);
}

return view.extend({
    load: function() { return command(['status']); },
    render: function(data) {
        var root = E('div', { 'class': 'jun-ui jun-usage-page' });
        var pill = E('span', { 'class': 'ju-pill' });
        var headline = E('p', { 'class': 'ju-help' });
        var meterFill = E('div', { 'class': 'ju-meter-fill' });
        var meter = E('div', { 'class': 'ju-meter', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100' }, meterFill);
        var values = {};
        var bars = E('div', { 'class': 'ju-bars' });
        var barsEmpty = E('p', { 'class': 'ju-empty' }, _('No usage recorded yet. The router counts traffic once a minute.'));
        var message = E('p', { 'class': 'ju-message', role: 'status', 'aria-live': 'polite' });
        var busy = false;
        var form = {
            cap: E('input', { type: 'number', min: '0', max: '100000', step: '1', inputmode: 'numeric' }),
            warn: E('input', { type: 'number', min: '50', max: '99', step: '1', inputmode: 'numeric' }),
            day: E('input', { type: 'number', min: '1', max: '28', step: '1', inputmode: 'numeric' }),
            iface: E('input', { type: 'text', maxlength: '15', placeholder: 'wan' })
        };

        ['used', 'rx', 'tx', 'today', 'projected', 'left'].forEach(function(key) {
            values[key] = E('span', { 'class': 'ju-value' }, '–');
        });
        function field(label, input, help) {
            return E('label', { 'class': 'ju-field' }, [E('span', {}, label), input, help ? E('small', {}, help) : '']);
        }
        function say(text, isError) {
            message.textContent = text || '';
            message.classList.toggle('is-error', !!isError);
        }
        function showStatus(status, keepForm) {
            var state = STATES[status.state] || STATES.off;
            var shown = status.running ? state : [_('Not counting'), 'is-bad'];
            pill.className = 'ju-pill ' + shown[1];
            pill.textContent = shown[0];
            values.used.textContent = bytes(status.total);
            values.rx.textContent = bytes(status.rx);
            values.tx.textContent = bytes(status.tx);
            values.today.textContent = bytes(Number(status.today_rx) + Number(status.today_tx));
            values.projected.textContent = bytes(status.projected);
            values.left.textContent = _('%s days').format(status.days_left);
            headline.textContent = status.cap_gb > 0
                ? _('%s of %s used (%s%%) · period started %s, resets in %s days').format(bytes(status.total), bytes(status.cap_bytes),
                    status.percent, dayLabel(status.period_start), status.days_left)
                : _('%s used since %s. Set a monthly limit below to get a warning.').format(bytes(status.total), dayLabel(status.period_start));
            meter.hidden = !(status.cap_gb > 0);
            meterFill.style.width = Math.min(100, Number(status.percent)) + '%';
            meterFill.className = 'ju-meter-fill' + (status.state === 'over' ? ' is-over' : status.state === 'warn' ? ' is-warn' : '');
            meter.setAttribute('aria-valuenow', String(Math.min(100, Number(status.percent))));
            bars.replaceChildren();
            var days = status.days || [];
            var peak = days.reduce(function(m, d) { return Math.max(m, d.rx + d.tx); }, 1);
            days.forEach(function(d) {
                var total = d.rx + d.tx;
                bars.appendChild(E('div', { 'class': 'ju-bar' + (d.d === status.today ? ' is-today' : ''), title: dayLabel(d.d) + ' · ' + bytes(total) }, [
                    E('div', { 'class': 'ju-bar-fill', style: 'height:' + Math.max(2, Math.round(total * 100 / peak)) + '%' })]));
            });
            barsEmpty.hidden = !!days.length;
            if (!keepForm) {
                form.cap.value = String(status.cap_gb);
                form.warn.value = String(status.warn_pct);
                form.day.value = String(status.reset_day);
                form.iface.value = status.iface;
            }
        }
        function run(args, pending, done) {
            if (busy) return Promise.resolve();
            busy = true;
            root.querySelectorAll('button').forEach(function(b) { b.disabled = true; });
            say(pending);
            return command(args).then(function(result) { return done ? done(result) : result; })
                .catch(function(error) { say(error.message, true); })
                .finally(function() {
                    busy = false;
                    root.querySelectorAll('button').forEach(function(b) { b.disabled = false; });
                });
        }

        var save = E('button', { type: 'button', 'class': 'ju-button ju-primary cbi-button-action' }, _('Save'));
        var reset = E('button', { type: 'button', 'class': 'ju-button ju-danger cbi-button-remove' }, _('Reset counters'));
        save.addEventListener('click', function() {
            return run(['save', 'cap_gb=' + form.cap.value.trim(), 'warn_pct=' + form.warn.value.trim(),
                'reset_day=' + form.day.value.trim(), 'iface=' + form.iface.value.trim()], _('Saving…'), function() {
                return command(['status']).then(function(status) { showStatus(status); say(_('Saved.')); });
            });
        });
        reset.addEventListener('click', function() {
            ui.showModal(_('Reset the data counters?'), [
                E('p', {}, _('This deletes the recorded daily totals and starts counting from zero. It does not change your carrier’s own count.')),
                E('div', { 'class': 'right' }, [
                    E('button', { 'class': 'btn cbi-button cbi-button-neutral', click: ui.hideModal }, _('Cancel')), ' ',
                    E('button', { 'class': 'btn cbi-button cbi-button-remove', click: function() {
                        ui.hideModal();
                        return run(['reset'], _('Resetting…'), function() {
                            return command(['status']).then(function(status) { showStatus(status, true); say(_('Counters reset.')); });
                        });
                    } }, _('Reset counters'))
                ])
            ]);
        });

        root.appendChild(E('link', { rel: 'stylesheet', href: L.resource('view/modem/junwrt-ui.css') }));
        root.appendChild(E('header', { 'class': 'ju-header' }, [
            E('div', {}, [E('h1', {}, _('Data Usage')),
                E('p', { 'class': 'ju-help' }, _('Counts the traffic carried by the cellular connection, per day, and warns before your monthly limit.'))]),
            pill]));
        root.appendChild(E('section', { 'class': 'ju-card' }, [
            E('div', { 'class': 'ju-card-head' }, E('h2', {}, _('This billing period'))),
            headline, meter,
            E('div', { 'class': 'ju-grid' }, [
                stat(_('Used'), values.used), stat(_('Download'), values.rx), stat(_('Upload'), values.tx),
                stat(_('Today'), values.today), stat(_('Projected by the reset'), values.projected), stat(_('Until reset'), values.left)
            ])
        ]));
        root.appendChild(E('section', { 'class': 'ju-card' }, [
            E('div', { 'class': 'ju-card-head' }, E('h2', {}, _('Last 30 days'))),
            bars, barsEmpty
        ]));
        root.appendChild(E('section', { 'class': 'ju-card' }, [
            E('div', { 'class': 'ju-card-head' }, E('h2', {}, _('Limit'))),
            E('div', { 'class': 'ju-form' }, [
                field(_('Monthly limit (GB)'), form.cap, _('0 turns the limit off. 1 GB = 1,000,000,000 bytes; check how your carrier counts.')),
                field(_('Warn at (%)'), form.warn, _('A warning is logged, and sent if Notifications is on, at this level and again at 100%.')),
                field(_('Billing period starts on day'), form.day, _('Day of the month your allowance resets (1–28).')),
                field(_('Interface'), form.iface, _('The OpenWrt interface that carries the cellular connection.'))
            ]),
            E('div', { 'class': 'ju-actions' }, [save, reset]),
            message
        ]));
        root.appendChild(E('details', { 'class': 'ju-details' }, [E('summary', {}, _('How it is counted')),
            E('p', { 'class': 'ju-help' }, _('The router adds up the bytes the cellular interface sends and receives, every minute, and keeps one total per day. Traffic the modem accelerates in hardware or that your carrier counts differently can make this differ from the carrier’s figure, so compare the two once and use the warning level to leave a margin.'))]));

        showStatus(data);
        if (refreshPoll) poll.remove(refreshPoll);
        refreshPoll = function() {
            if (busy || !root.isConnected) return Promise.resolve();
            return command(['status']).then(function(status) { showStatus(status, true); }).catch(function() {});
        };
        poll.add(refreshPoll, 30);
        return root;
    },
    handleSaveApply: null,
    handleSave: null,
    handleReset: null
});
