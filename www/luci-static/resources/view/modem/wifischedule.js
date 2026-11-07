'use strict';
'require view';
'require fs';
'require poll';

var refreshPoll;
var DAYS = [['1', _('Mon')], ['2', _('Tue')], ['3', _('Wed')], ['4', _('Thu')], ['5', _('Fri')], ['6', _('Sat')], ['0', _('Sun')]];
var BANDS = [['both', _('Both bands')], ['2g', _('2.4 GHz only')], ['5g', _('5 GHz only')]];

function command(args) {
    return fs.exec('/usr/bin/junwrt-wifisched', args).then(function(result) {
        var data;
        try { data = JSON.parse(result.stdout || '{}'); }
        catch (e) { throw new Error(_('Invalid response from Wi-Fi Schedule.')); }
        if (Number(result.code) !== 0 || data.error)
            throw new Error(data.error || result.stderr || _('Wi-Fi Schedule command failed.'));
        return data;
    });
}

function stat(label, node) {
    return E('div', { 'class': 'ju-stat' }, [E('span', { 'class': 'ju-label' }, label), node]);
}

return view.extend({
    load: function() { return command(['status']); },
    render: function(data) {
        var root = E('div', { 'class': 'jun-ui jun-wifisched-page' });
        var pill = E('span', { 'class': 'ju-pill' });
        var message = E('p', { 'class': 'ju-message', role: 'status', 'aria-live': 'polite' });
        var notice = E('p', { 'class': 'ju-notice' });
        var values = {};
        var enabled = E('input', { type: 'checkbox', id: 'wifisched-enabled' });
        var off = E('input', { type: 'time', id: 'wifisched-off', required: true });
        var on = E('input', { type: 'time', id: 'wifisched-on', required: true });
        var bands = E('select', { id: 'wifisched-bands' }, BANDS.map(function(b) { return E('option', { value: b[0] }, b[1]); }));
        var days = DAYS.map(function(d) { return E('input', { type: 'checkbox', id: 'wifisched-day-' + d[0], value: d[0] }); });
        var save = E('button', { type: 'button', 'class': 'ju-button ju-primary cbi-button-action' }, _('Save'));
        var busy = false;

        ['clock', 'wifi', 'next'].forEach(function(key) {
            values[key] = E('span', { 'class': 'ju-value is-text' }, '–');
        });
        function say(text, isError) {
            message.textContent = text || '';
            message.classList.toggle('is-error', !!isError);
        }
        function show(s) {
            var gap = s.offset + new Date().getTimezoneOffset() * 60;
            var hours = Math.round(Math.abs(gap) / 360) / 10;
            var on_ = !!s.enabled;
            pill.className = 'ju-pill ' + (!on_ ? '' : !s.running ? 'is-bad' : !s.clock_ok ? 'is-warn' : 'is-ok');
            pill.textContent = !on_ ? _('Off') : !s.running ? _('Service not running') : !s.clock_ok ? _('Clock not set')
                : s.wifi_off ? _('Wi-Fi off now') : _('On');
            values.clock.textContent = s.clock || '–';
            values.wifi.textContent = s.wifi_off ? (s.interfaces ? _('Off by schedule (%s)').format(s.interfaces) : _('Off by schedule')) : _('On');
            values.next.textContent = s.next_text || (on_ ? '–' : _('Schedule off'));
            notice.textContent = on_ && !s.clock_ok ? _('The router clock is not set yet. Wi-Fi stays on until it is.')
                : gap ? _('The router clock is %s hours %s this device. The schedule uses the router clock, shown above. To change it, set the time zone under System.')
                    .format(hours, gap < 0 ? _('behind') : _('ahead of')) : '';
            notice.hidden = !notice.textContent;
        }
        function fill(s) {
            enabled.checked = !!s.enabled;
            off.value = s.off;
            on.value = s.on;
            bands.value = s.bands;
            days.forEach(function(box) { box.checked = String(s.days).indexOf(box.value) >= 0; });
        }

        save.addEventListener('click', function() {
            var picked = days.filter(function(box) { return box.checked; }).map(function(box) { return box.value; }).sort().join('');
            if (busy) return Promise.resolve();
            if (!off.value || !on.value) { say(_('Pick both times, such as 23:00 and 07:00.'), true); return Promise.resolve(); }
            if (off.value === on.value) { say(_('The off and on times must differ.'), true); return Promise.resolve(); }
            if (!picked) { say(_('Pick at least one day.'), true); return Promise.resolve(); }
            busy = true;
            save.disabled = true;
            say(_('Saving…'));
            return command(['save', 'enabled=' + (enabled.checked ? 1 : 0), 'off=' + off.value, 'on=' + on.value,
                'days=' + picked, 'bands=' + bands.value]).then(function(s) {
                show(s);
                fill(s);
                say(!s.enabled ? _('Saved. Wi-Fi Schedule is off.') : s.wifi_off ? _('Saved. Wi-Fi is off until %s.').format(s.on)
                    : _('Saved. %s.').format(s.next_text || _('Next off time is set')));
            }).catch(function(error) {
                say(error.message, true);
            }).finally(function() {
                busy = false;
                save.disabled = false;
            });
        });

        root.appendChild(E('link', { rel: 'stylesheet', href: L.resource('view/modem/junwrt-ui.css') }));
        root.appendChild(E('header', { 'class': 'ju-header' }, [
            E('div', {}, [E('h1', {}, _('Wi-Fi Schedule')),
                E('p', { 'class': 'ju-help' }, _('Turns Wi-Fi off at night and back on in the morning. It is off until you turn it on.'))]),
            pill]));
        root.appendChild(E('section', { 'class': 'ju-card' }, [
            E('div', { 'class': 'ju-card-head' }, E('h2', {}, _('Now'))),
            E('div', { 'class': 'ju-grid' }, [stat(_('Router clock'), values.clock), stat(_('Wi-Fi'), values.wifi), stat(_('Next'), values.next)]),
            notice
        ]));
        root.appendChild(E('section', { 'class': 'ju-card' }, [
            E('div', { 'class': 'ju-card-head' }, E('h2', {}, _('Schedule'))),
            E('label', { 'class': 'ju-check', 'for': 'wifisched-enabled' }, [enabled, _('Turn Wi-Fi off on a schedule')]),
            E('div', { 'class': 'ju-form' }, [
                E('label', { 'class': 'ju-field', 'for': 'wifisched-off' }, [E('span', {}, _('Off at (router clock)')), off]),
                E('label', { 'class': 'ju-field', 'for': 'wifisched-on' }, [E('span', {}, _('Back on at')), on]),
                E('label', { 'class': 'ju-field', 'for': 'wifisched-bands' }, [E('span', {}, _('Wi-Fi bands')), bands])
            ]),
            E('p', { 'class': 'ju-label' }, _('Nights starting on')),
            E('div', { 'class': 'ju-grid' }, DAYS.map(function(d, i) {
                return E('label', { 'class': 'ju-check', 'for': 'wifisched-day-' + d[0] }, [days[i], d[1]]);
            })),
            E('div', { 'class': 'ju-actions' }, [save]),
            message,
            E('p', { 'class': 'ju-help' }, _('Devices on Wi-Fi lose the connection at the off time and reconnect when it comes back. Devices on a LAN cable are not affected.')),
            E('p', { 'class': 'ju-help' }, _('Saving during the off time does not cut you off: the schedule starts at the next off time. Turning a network on by hand at night keeps it on until the morning.'))
        ]));

        show(data);
        fill(data);
        if (refreshPoll) poll.remove(refreshPoll);
        refreshPoll = function() {
            if (busy || !root.isConnected) return Promise.resolve();
            return command(['status']).then(show).catch(function() {});
        };
        poll.add(refreshPoll, 30);
        return root;
    },
    handleSaveApply: null,
    handleSave: null,
    handleReset: null
});
