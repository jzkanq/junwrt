'use strict';
'require view';
'require fs';
'require poll';

var refreshPoll;
var COMMANDS = [
    ['/status', _('Network, signal and data used today')],
    ['/usage', _('Data used today and in this billing period')],
    ['/devices', _('Wi-Fi devices connected now, and the names of devices with an address')],
    ['/reboot', _('Restart the router. You confirm with /reboot confirm within a minute. Off unless allowed below.')],
    ['/help', _('This list')]
];

function command(args) {
    return fs.exec('/usr/bin/junwrt-bot', args).then(function(result) {
        var data;
        try { data = JSON.parse(result.stdout || '{}'); }
        catch (e) { throw new Error(_('Invalid response from the Telegram bot.')); }
        if (Number(result.code) !== 0 || data.error)
            throw new Error(data.error || result.stderr || _('Telegram bot command failed.'));
        return data;
    });
}

function ago(seconds) {
    var s = Math.max(0, Number(seconds) || 0);
    return s < 90 ? _('just now') : s < 5400 ? _('%s min ago').format(Math.round(s / 60))
        : s < 172800 ? _('%s h ago').format(Math.round(s / 3600)) : _('%s days ago').format(Math.round(s / 86400));
}

function stat(label, node) {
    return E('div', { 'class': 'ju-stat' }, [E('span', { 'class': 'ju-label' }, label), node]);
}

return view.extend({
    load: function() { return command(['status']); },
    render: function(data) {
        var root = E('div', { 'class': 'jun-ui jun-bot-page' });
        var pill = E('span', { 'class': 'ju-pill' });
        var message = E('p', { 'class': 'ju-message', role: 'status', 'aria-live': 'polite' });
        var notice = E('p', { 'class': 'ju-notice' });
        var values = {
            last: E('span', { 'class': 'ju-value is-text' }, '–'),
            handled: E('span', { 'class': 'ju-value' }, '0'),
            ignored: E('span', { 'class': 'ju-value' }, '0')
        };
        var enabled = E('input', { type: 'checkbox', id: 'bot-enabled' });
        var reboot = E('input', { type: 'checkbox', id: 'bot-reboot' });
        var save = E('button', { type: 'button', 'class': 'ju-button ju-primary cbi-button-action' }, _('Save'));
        var busy = false;

        function say(text, isError) {
            message.textContent = text || '';
            message.classList.toggle('is-error', !!isError);
        }
        function show(s) {
            var ready = !!(s.token_set && s.chat_ok), on = !!s.enabled;
            pill.className = 'ju-pill ' + (!on ? '' : !ready || s.problem ? 'is-warn' : !s.running ? 'is-bad' : 'is-ok');
            pill.textContent = !on ? _('Off') : !ready ? _('Not set up') : s.problem ? _('Problem')
                : !s.running ? _('Service not running') : _('On');
            values.last.textContent = s.last_time ? '%s, %s'.format(s.last_command || '–', ago(s.now - s.last_time)) : _('None yet');
            values.handled.textContent = String(s.handled || 0);
            values.ignored.textContent = String(s.ignored || 0);
            notice.textContent = !ready ? _('First set the Telegram bot token and your numeric chat ID in Modem › Notifications. The bot answers only that chat.')
                : on && s.problem ? s.problem : '';
            notice.hidden = !notice.textContent;
        }
        function fill(s) {
            enabled.checked = !!s.enabled;
            reboot.checked = !!s.reboot;
        }

        save.addEventListener('click', function() {
            if (busy) return Promise.resolve();
            busy = true;
            save.disabled = true;
            say(_('Saving…'));
            return command(['save', 'enabled=' + (enabled.checked ? 1 : 0), 'reboot=' + (reboot.checked ? 1 : 0)]).then(function(s) {
                show(s);
                fill(s);
                say(s.enabled ? _('Saved. Send /help to your bot.') : _('Saved. The bot is off.'));
            }).catch(function(error) {
                say(error.message, true);
            }).finally(function() {
                busy = false;
                save.disabled = false;
            });
        });

        root.appendChild(E('link', { rel: 'stylesheet', href: L.resource('view/modem/junwrt-ui.css') }));
        root.appendChild(E('header', { 'class': 'ju-header' }, [
            E('div', {}, [E('h1', {}, _('Telegram Bot')),
                E('p', { 'class': 'ju-help' }, _('Ask the router for its status from Telegram, wherever you are. It is off until you turn it on.'))]),
            pill]));
        root.appendChild(E('section', { 'class': 'ju-card' }, [
            E('div', { 'class': 'ju-card-head' }, E('h2', {}, _('Now'))),
            E('div', { 'class': 'ju-grid' }, [
                stat(_('Last command'), values.last), stat(_('Answered'), values.handled), stat(_('Other chats ignored'), values.ignored)
            ]),
            notice
        ]));
        root.appendChild(E('section', { 'class': 'ju-card' }, [
            E('div', { 'class': 'ju-card-head' }, E('h2', {}, _('Settings'))),
            E('label', { 'class': 'ju-check', 'for': 'bot-enabled' }, [enabled, _('Answer commands from my Telegram chat')]),
            E('label', { 'class': 'ju-check', 'for': 'bot-reboot' }, [reboot, _('Allow /reboot (you confirm each restart)')]),
            E('div', { 'class': 'ju-actions' }, [save]),
            message,
            E('p', { 'class': 'ju-help' }, _('It uses the bot token and chat ID from Modem › Notifications and answers only that chat. Commands sent while the router was off are skipped.')),
            E('p', { 'class': 'ju-help' }, _('Staying connected to Telegram uses about 10 MB of mobile data a day.'))
        ]));
        root.appendChild(E('section', { 'class': 'ju-card' }, [
            E('div', { 'class': 'ju-card-head' }, E('h2', {}, _('Commands'))),
            E('div', { 'class': 'ju-list' }, COMMANDS.map(function(c) {
                return E('div', { 'class': 'ju-row' }, [E('div', { 'class': 'ju-row-main' }, [
                    E('span', { 'class': 'ju-mono' }, c[0]), E('p', { 'class': 'ju-help' }, c[1])])]);
            }))
        ]));

        show(data);
        fill(data);
        if (refreshPoll) poll.remove(refreshPoll);
        refreshPoll = function() {
            if (busy || !root.isConnected) return Promise.resolve();
            return command(['status']).then(show).catch(function() {});
        };
        poll.add(refreshPoll, 10);
        return root;
    },
    handleSaveApply: null,
    handleSave: null,
    handleReset: null
});
