'use strict';
'require view';
'require fs';
'require poll';

var refreshPoll;
var RESULTS = { ok: [_('Sent'), 'is-ok'], queued: [_('Waiting'), 'is-warn'], fail: [_('Failed'), 'is-bad'], skipped: [_('Skipped'), ''] };
var EVENTS = [
    ['wan', _('Internet down and restored'), _('Sent once the connection is back, with how long it was offline.')],
    ['guard', _('Connection Guard actions'), _('A re-dial, radio restart or reboot, and the recovery afterwards.')],
    ['usage', _('Data limit warnings'), _('At the warning level and again when the monthly limit is reached.')],
    ['cell', _('Serving cell changes'), _('When the router moves to another band or cell (checked once a minute).')],
    ['speed', _('Slow speed test'), _('After a speed test that falls below the minimum set here.')],
    ['sms', _('SMS received'), _('Needs SMS forwarding turned on in Modem › SMS; the text is sent to the provider you choose.')]
];

function command(args) {
    return fs.exec('/usr/bin/junwrt-notify', args).then(function(result) {
        var data;
        try { data = JSON.parse(result.stdout || '{}'); }
        catch (e) { throw new Error(_('Invalid response from Notifications.')); }
        // A failed test message is a normal answer ({"ok":false,"error":...}); other errors abort the action.
        if (Number(result.code) !== 0 || (data.error && data.ok !== false))
            throw new Error(data.error || result.stderr || _('Notifications command failed.'));
        return data;
    });
}

function field(label, input, help, extra) {
    return E('label', { 'class': 'ju-field' + (extra ? ' ' + extra : '') }, [E('span', {}, label), input, help ? E('small', {}, help) : '']);
}

return view.extend({
    load: function() { return command(['status']); },
    render: function(data) {
        var root = E('div', { 'class': 'jun-ui jun-notify-page' });
        var pill = E('span', { 'class': 'ju-pill' });
        var message = E('p', { 'class': 'ju-message', role: 'status', 'aria-live': 'polite' });
        var log = E('ul', { 'class': 'ju-log' });
        var logEmpty = E('p', { 'class': 'ju-empty' }, _('Nothing sent yet.'));
        var queued = E('p', { 'class': 'ju-help' });
        var busy = false;
        var f = {
            enabled: E('input', { type: 'checkbox', id: 'notify-enabled' }),
            provider: E('select', {}, [['telegram', 'Telegram'], ['ntfy', 'ntfy'], ['webhook', _('Webhook (JSON)')]].map(function(p) {
                return E('option', { value: p[0] }, p[1]);
            })),
            label: E('input', { type: 'text', maxlength: '40', placeholder: 'JunWRT' }),
            tgToken: E('input', { type: 'password', autocomplete: 'off', maxlength: '80' }),
            tgChat: E('input', { type: 'text', maxlength: '40', placeholder: '123456789' }),
            ntfyServer: E('input', { type: 'text', maxlength: '120', placeholder: 'https://ntfy.sh' }),
            ntfyTopic: E('input', { type: 'text', maxlength: '64' }),
            ntfyToken: E('input', { type: 'password', autocomplete: 'off', maxlength: '100' }),
            hookUrl: E('input', { type: 'password', autocomplete: 'off', maxlength: '300' }),
            speedMin: E('input', { type: 'number', min: '0', max: '10000', step: '1', inputmode: 'numeric' })
        };
        var events = {};
        var groups = {
            telegram: E('div', { 'class': 'ju-form' }, [
                field(_('Bot token'), f.tgToken, _('Create a bot with @BotFather and paste its token. Leave empty to keep the saved one.')),
                field(_('Chat ID'), f.tgChat, _('Your user or group ID (message your bot, then open its getUpdates page to find it).'))]),
            ntfy: E('div', { 'class': 'ju-form' }, [
                field(_('Server'), f.ntfyServer, _('Use https://ntfy.sh or your own server.')),
                field(_('Topic'), f.ntfyTopic, _('Anyone who knows the topic can read it, so choose a long random name.')),
                field(_('Access token'), f.ntfyToken, _('Optional. Leave empty to keep the saved one.'))]),
            webhook: E('div', { 'class': 'ju-form' }, [
                field(_('Webhook URL'), f.hookUrl, _('Receives a JSON POST with device, title, message and time. Leave empty to keep the saved URL.'), 'is-wide')])
        };

        function say(text, isError) {
            message.textContent = text || '';
            message.classList.toggle('is-error', !!isError);
        }
        function showGroups() {
            Object.keys(groups).forEach(function(key) { groups[key].hidden = f.provider.value !== key; });
        }
        function savedHint(isSet) { return isSet ? _('•••• saved') : ''; }
        function showStatus(status, keepForm) {
            var state = !status.enabled ? [_('Off'), ''] : !status.configured ? [_('Needs setup'), 'is-warn'] : [_('On'), 'is-ok'];
            pill.className = 'ju-pill ' + state[1];
            pill.textContent = state[0];
            queued.textContent = status.queued ? _('%s message(s) are waiting for the connection to come back.').format(status.queued) : '';
            queued.hidden = !status.queued;
            log.replaceChildren();
            (status.log || []).slice().reverse().forEach(function(entry) {
                var r = RESULTS[entry.r] || [entry.r, ''];
                log.appendChild(E('li', {}, [new Date(entry.t * 1000).toLocaleTimeString() + ' · ' + r[0] + ' · ' + entry.e + ' · ' + entry.m]));
            });
            logEmpty.hidden = !!(status.log || []).length;
            if (keepForm) return;
            f.enabled.checked = status.enabled === 1;
            f.provider.value = status.provider;
            f.label.value = status.label;
            f.tgChat.value = status.telegram.chat;
            f.tgToken.value = '';
            f.tgToken.placeholder = savedHint(status.telegram.token_set);
            f.ntfyServer.value = status.ntfy.server;
            f.ntfyTopic.value = status.ntfy.topic;
            f.ntfyToken.value = '';
            f.ntfyToken.placeholder = savedHint(status.ntfy.token_set);
            f.hookUrl.value = '';
            f.hookUrl.placeholder = status.webhook.set ? status.webhook.host : 'https://example.com/hook';
            f.speedMin.value = String(status.speed_min);
            EVENTS.forEach(function(ev) { events[ev[0]].checked = status.events[ev[0]] === 1; });
            showGroups();
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
        function refresh(keepForm) {
            return command(['status']).then(function(status) { showStatus(status, keepForm); });
        }
        function saveArgs() {
            var args = ['save', 'enabled=' + (f.enabled.checked ? 1 : 0), 'provider=' + f.provider.value, 'label=' + f.label.value.trim(),
                'telegram_chat=' + f.tgChat.value.trim(), 'ntfy_server=' + f.ntfyServer.value.trim(), 'ntfy_topic=' + f.ntfyTopic.value.trim(),
                'speed_min=' + (f.speedMin.value.trim() || '0')];
            if (f.tgToken.value.trim()) args.push('telegram_token=' + f.tgToken.value.trim());
            if (f.ntfyToken.value.trim()) args.push('ntfy_token=' + f.ntfyToken.value.trim());
            if (f.hookUrl.value.trim()) args.push('webhook_url=' + f.hookUrl.value.trim());
            EVENTS.forEach(function(ev) { args.push('ev_' + ev[0] + '=' + (events[ev[0]].checked ? 1 : 0)); });
            return args.filter(function(a) { return a.indexOf('ntfy_server=') !== 0 || a.length > 'ntfy_server='.length; });
        }

        var save = E('button', { type: 'button', 'class': 'ju-button ju-primary cbi-button-action' }, _('Save'));
        var test = E('button', { type: 'button', 'class': 'ju-button ju-secondary cbi-button-neutral' }, _('Send test message'));
        var clear = E('button', { type: 'button', 'class': 'ju-button ju-secondary cbi-button-neutral' }, _('Clear activity'));
        f.provider.addEventListener('change', showGroups);
        save.addEventListener('click', function() {
            return run(saveArgs(), _('Saving…'), function() {
                return refresh(false).then(function() { say(_('Saved.')); });
            });
        });
        test.addEventListener('click', function() {
            return run(['test'], _('Sending a test message…'), function(result) {
                return refresh(true).then(function() {
                    say(result.ok ? _('Test message delivered.') : _('The test message was not delivered: %s').format(result.error || _('unknown error')), !result.ok);
                });
            });
        });
        clear.addEventListener('click', function() {
            return run(['clear-log'], _('Clearing…'), function() { return refresh(true).then(function() { say(_('Activity cleared.')); }); });
        });

        var eventRows = EVENTS.map(function(ev) {
            events[ev[0]] = E('input', { type: 'checkbox', id: 'notify-ev-' + ev[0] });
            return E('div', { 'class': 'ju-field is-wide' }, [E('label', { 'class': 'ju-check', 'for': 'notify-ev-' + ev[0] }, [events[ev[0]], ev[1]]), E('small', {}, ev[2])]);
        });

        root.appendChild(E('link', { rel: 'stylesheet', href: L.resource('view/modem/junwrt-ui.css') }));
        root.appendChild(E('header', { 'class': 'ju-header' }, [
            E('div', {}, [E('h1', {}, _('Notifications')),
                E('p', { 'class': 'ju-help' }, _('Sends a short message to Telegram, ntfy or your own webhook when something important happens. Off by default.'))]),
            pill]));
        root.appendChild(E('section', { 'class': 'ju-card' }, [
            E('div', { 'class': 'ju-card-head' }, E('h2', {}, _('Delivery'))),
            E('div', { 'class': 'ju-field is-wide' }, E('label', { 'class': 'ju-check', 'for': 'notify-enabled' }, [f.enabled, _('Send notifications')])),
            E('div', { 'class': 'ju-form' }, [field(_('Service'), f.provider), field(_('Device name in messages'), f.label)]),
            groups.telegram, groups.ntfy, groups.webhook,
            E('div', { 'class': 'ju-actions' }, [save, test]),
            message
        ]));
        root.appendChild(E('section', { 'class': 'ju-card' }, [
            E('div', { 'class': 'ju-card-head' }, E('h2', {}, _('Events'))),
            E('div', {}, eventRows),
            field(_('Slow speed test below (Mbps)'), f.speedMin, _('0 turns this off. Applies to the download speed of tests run on this router.'))
        ]));
        root.appendChild(E('section', { 'class': 'ju-card' }, [
            E('div', { 'class': 'ju-card-head' }, [E('h2', {}, _('Recent activity')), clear]),
            queued, log, logEmpty
        ]));
        root.appendChild(E('details', { 'class': 'ju-details' }, [E('summary', {}, _('Privacy and limits')),
            E('p', { 'class': 'ju-help' }, _('Tokens and URLs are stored in the router’s configuration and are handed to curl on standard input, so they do not appear in the process list. Messages go over HTTPS to the service you choose and contain only the short text shown in the activity list. Each event is rate limited, and messages that cannot be sent while the connection is down are kept (up to 10) and delivered when it returns.'))]));

        showStatus(data);
        if (refreshPoll) poll.remove(refreshPoll);
        refreshPoll = function() {
            if (busy || !root.isConnected) return Promise.resolve();
            return refresh(true).catch(function() {});
        };
        poll.add(refreshPoll, 15);
        return root;
    },
    handleSaveApply: null,
    handleSave: null,
    handleReset: null
});
