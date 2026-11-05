'use strict';
'require view';
'require fs';
'require poll';

var refreshPoll;
var CHOICES = [
    ['1', _('Every day')], ['2', _('Every 2 days')], ['3', _('Every 3 days')],
    ['7', _('Every week')], ['14', _('Every 2 weeks')], ['30', _('Every month (30 days)')]
];

function command(args) {
    return fs.exec('/usr/bin/junwrt-autorestart', args).then(function(result) {
        var data;
        try { data = JSON.parse(result.stdout || '{}'); }
        catch (e) { throw new Error(_('Invalid response from Auto Restart.')); }
        if (Number(result.code) !== 0 || data.error)
            throw new Error(data.error || result.stderr || _('Auto Restart command failed.'));
        return data;
    });
}

function duration(seconds) {
    var s = Number(seconds) || 0;
    var d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
    return d ? _('%s d %s h').format(d, h) : h ? _('%s h %s min').format(h, m) : _('%s min').format(m);
}

function stat(label, node) {
    return E('div', { 'class': 'ju-stat' }, [E('span', { 'class': 'ju-label' }, label), node]);
}

return view.extend({
    load: function() { return command(['status']); },
    render: function(data) {
        var root = E('div', { 'class': 'jun-ui jun-autorestart-page' });
        var pill = E('span', { 'class': 'ju-pill' });
        var message = E('p', { 'class': 'ju-message', role: 'status', 'aria-live': 'polite' });
        var notice = E('p', { 'class': 'ju-notice' });
        var values = {};
        var enabled = E('input', { type: 'checkbox', id: 'autorestart-enabled' });
        var every = E('select', { id: 'autorestart-every' }, CHOICES.map(function(c) { return E('option', { value: c[0] }, c[1]); }));
        var at = E('input', { type: 'time', id: 'autorestart-at', required: true });
        var save = E('button', { type: 'button', 'class': 'ju-button ju-primary cbi-button-action' }, _('Save'));
        var busy = false;

        ['clock', 'next', 'uptime'].forEach(function(key) {
            values[key] = E('span', { 'class': 'ju-value is-text' }, '–');
        });
        function say(text, isError) {
            message.textContent = text || '';
            message.classList.toggle('is-error', !!isError);
        }
        function show(status) {
            var on = !!status.enabled;
            var gap = status.offset + new Date().getTimezoneOffset() * 60;
            var hours = Math.round(Math.abs(gap) / 360) / 10;
            pill.className = 'ju-pill ' + (!on ? '' : !status.running ? 'is-bad' : !status.clock_ok || status.waiting ? 'is-warn' : 'is-ok');
            pill.textContent = !on ? _('Off') : !status.running ? _('Service not running')
                : !status.clock_ok ? _('Clock not set') : status.waiting ? _('Waiting') : _('On');
            values.clock.textContent = status.clock || '–';
            values.next.textContent = !on ? _('Off') : !status.clock_ok ? _('Clock not set') : status.next_text || '–';
            values.uptime.textContent = duration(status.uptime);
            notice.textContent = status.waiting ? _('A restart is due. It is waiting for %s to finish.').format(status.waiting)
                : on && !status.clock_ok ? _('The router clock is not set yet. Restarts wait until it is.')
                : gap ? _('The router clock is %s hours %s this device. Restart times use the router clock, shown above. To change it, set the time zone under System.')
                    .format(hours, gap < 0 ? _('behind') : _('ahead of')) : '';
            notice.hidden = !notice.textContent;
        }
        function fill(status) {
            enabled.checked = !!status.enabled;
            every.value = String(status.every);
            at.value = status.at;
        }

        save.addEventListener('click', function() {
            if (busy) return Promise.resolve();
            if (!at.value) { say(_('Pick a time such as 04:00.'), true); return Promise.resolve(); }
            busy = true;
            save.disabled = true;
            say(_('Saving…'));
            return command(['save', 'enabled=' + (enabled.checked ? 1 : 0), 'every=' + every.value, 'at=' + at.value]).then(function() {
                return command(['status']);
            }).then(function(status) {
                show(status);
                fill(status);
                say(status.enabled ? _('Saved. Next restart: %s').format(status.next_text || '–') : _('Saved. Auto Restart is off.'));
            }).catch(function(error) {
                say(error.message, true);
            }).finally(function() {
                busy = false;
                save.disabled = false;
            });
        });

        root.appendChild(E('link', { rel: 'stylesheet', href: L.resource('view/modem/junwrt-ui.css') }));
        root.appendChild(E('header', { 'class': 'ju-header' }, [
            E('div', {}, [E('h1', {}, _('Auto Restart')),
                E('p', { 'class': 'ju-help' }, _('Restarts the router on a schedule you pick. It is off until you turn it on.'))]),
            pill]));
        root.appendChild(E('section', { 'class': 'ju-card' }, [
            E('div', { 'class': 'ju-card-head' }, E('h2', {}, _('Now'))),
            E('div', { 'class': 'ju-grid' }, [
                stat(_('Router clock'), values.clock), stat(_('Next restart'), values.next), stat(_('Up for'), values.uptime)
            ]),
            notice
        ]));
        root.appendChild(E('section', { 'class': 'ju-card' }, [
            E('div', { 'class': 'ju-card-head' }, E('h2', {}, _('Schedule'))),
            E('label', { 'class': 'ju-check', 'for': 'autorestart-enabled' }, [enabled, _('Restart automatically')]),
            E('div', { 'class': 'ju-form' }, [
                E('label', { 'class': 'ju-field', 'for': 'autorestart-every' }, [E('span', {}, _('How often')), every]),
                E('label', { 'class': 'ju-field', 'for': 'autorestart-at' }, [E('span', {}, _('At (router clock)')), at])
            ]),
            E('div', { 'class': 'ju-actions' }, [save]),
            message,
            E('p', { 'class': 'ju-help' }, _('A restart takes about 3 minutes. Internet, Wi-Fi and the phone line are off during that time. It waits for a phone call or an update to finish, and skips that time if it takes more than 30 minutes.')),
            E('p', { 'class': 'ju-help' }, _('The count starts when the router last started, so a power cut or a restart by hand starts it again.'))
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
