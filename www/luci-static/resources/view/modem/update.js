'use strict';
'require view';
'require fs';
'require poll';

var refreshPoll;
var STAGES = {
    starting: _('Starting the update…'),
    check: _('Checking the update…'),
    download: _('Downloading the update…'),
    install: _('Installing. Wi-Fi and internet can drop for a minute. This page comes back by itself.')
};

function command(args) {
    return fs.exec('/usr/bin/junwrt-update', args).then(function(result) {
        var data;
        try { data = JSON.parse(result.stdout || '{}'); }
        catch (e) { throw new Error(_('Invalid response from the updater.')); }
        if (Number(result.code) !== 0 || data.error)
            throw new Error(data.error || result.stderr || _('The updater failed.'));
        return data;
    });
}

function ago(seconds) {
    var s = Math.max(Number(seconds) || 0, 0);
    return s < 120 ? _('Just now') : s < 7200 ? _('%s min ago').format(Math.round(s / 60))
        : s < 172800 ? _('%s h ago').format(Math.round(s / 3600)) : _('%s days ago').format(Math.round(s / 86400));
}

function stat(label, node) {
    return E('div', { 'class': 'ju-stat' }, [E('span', { 'class': 'ju-label' }, label), node]);
}

return view.extend({
    load: function() { return command(['status']); },
    render: function(data) {
        var root = E('div', { 'class': 'jun-ui jun-update-page' });
        var pill = E('span', { 'class': 'ju-pill' });
        var notes = E('p', { 'class': 'ju-help' });
        var message = E('p', { 'class': 'ju-message', role: 'status', 'aria-live': 'polite' });
        var values = {};
        var auto = E('input', { type: 'checkbox' });
        var update = E('button', { type: 'button', 'class': 'ju-button ju-primary cbi-button-action' }, _('Update now'));
        var recheck = E('button', { type: 'button', 'class': 'ju-button ju-secondary cbi-button-neutral' }, _('Check now'));
        var updating = data.state === 'running';
        var busy = false;
        var readAt = Date.now();

        ['installed', 'latest', 'checked'].forEach(function(key) {
            values[key] = E('span', { 'class': 'ju-value is-text' }, '–');
        });
        function say(text, isError) {
            message.textContent = text || '';
            message.classList.toggle('is-error', !!isError);
        }
        function setBusy(state) {
            busy = state;
            update.disabled = auto.disabled = state;
            recheck.disabled = state || updating;
        }
        function show(status) {
            var running = status.state === 'running';
            var offer = status.available && !running;
            pill.className = 'ju-pill ' + (running || offer ? 'is-warn' : status.check_error ? 'is-bad' : status.latest ? 'is-ok' : '');
            pill.textContent = running ? _('Updating') : offer ? _('Update available')
                : status.check_error ? _('Check failed') : status.latest ? _('Up to date') : _('Not checked yet');
            values.installed.textContent = status.installed.built || '–';
            values.latest.textContent = status.latest ? status.latest.built : '–';
            values.checked.textContent = status.checked ? ago(status.now - status.checked) : _('Not yet');
            // Text from the manifest goes through textContent, never into HTML.
            notes.textContent = !offer ? '' : status.incomplete ? _('The last update did not finish. Tap Update now to finish it.')
                : status.latest.notes ? _('What is new: %s').format(status.latest.notes) : '';
            notes.hidden = !notes.textContent;
            update.hidden = !offer;
            recheck.disabled = busy || running;
            auto.checked = !!status.auto;

            if (running) {
                say(status.now - status.started > 600 ? _('This is taking longer than expected. If nothing changes, restart the router and check again.')
                    : (STAGES[status.stage] || STAGES.starting));
            }
            else if (status.state === 'failed') {
                say(status.message, true);
            }
            else if (updating && status.state === 'done') {
                say(status.message + ' ' + _('Reloading this page…'));
                setTimeout(function() { location.reload(); }, 4000);
            }
            else if (updating && status.state === 'current') {
                say(status.message);
            }
            else if (status.check_error) {
                say(status.check_error, true);
            }
            updating = running;
        }
        function refresh() {
            readAt = Date.now();
            return command(['status']).then(show).catch(function() {
                // The installer restarts the network and rpcd, so a failed read is normal during an update.
                if (updating) say(_('Waiting for the router to come back…'));
            });
        }

        update.addEventListener('click', function() {
            if (busy) return Promise.resolve();
            setBusy(true);
            say(STAGES.starting);
            return command(['install']).then(function() {
                updating = true;
                return refresh();
            }).catch(function(error) {
                say(error.message, true);
            }).finally(function() { setBusy(false); });
        });
        recheck.addEventListener('click', function() {
            if (busy) return Promise.resolve();
            setBusy(true);
            say(_('Checking…'));
            return command(['check']).then(function(status) {
                show(status);
                say(status.available ? _('An update is available.') : _('This router has the newest build.'));
            }).catch(function(error) {
                say(error.message, true);
                return refresh();
            }).finally(function() { setBusy(false); });
        });
        auto.addEventListener('change', function() {
            var wanted = auto.checked;
            return command(['save', 'auto=' + (wanted ? 1 : 0)]).then(function() {
                say(wanted ? _('The router checks once a day.') : _('Automatic checks are off.'));
            }).catch(function(error) {
                auto.checked = !wanted;
                say(error.message, true);
            });
        });

        root.appendChild(E('link', { rel: 'stylesheet', href: L.resource('view/modem/junwrt-ui.css') }));
        root.appendChild(E('header', { 'class': 'ju-header' }, [
            E('div', {}, [E('h1', {}, _('Updates')),
                E('p', { 'class': 'ju-help' }, _('Finds a newer JunWRT WebUI and installs it when you tap Update now.'))]),
            pill]));
        root.appendChild(E('section', { 'class': 'ju-card' }, [
            E('div', { 'class': 'ju-card-head' }, E('h2', {}, _('JunWRT WebUI'))),
            E('div', { 'class': 'ju-grid' }, [
                stat(_('Installed build'), values.installed), stat(_('Newest build'), values.latest), stat(_('Last check'), values.checked)
            ]),
            notes,
            E('div', { 'class': 'ju-actions' }, [update, recheck]),
            message,
            E('p', { 'class': 'ju-help' }, _('Updating takes a few minutes and restarts Wi-Fi, the network and web services. Your settings and activation key stay. Finish any phone call first. Firmware (.bin) is never flashed from here.'))
        ]));
        root.appendChild(E('section', { 'class': 'ju-card' }, [
            E('div', { 'class': 'ju-card-head' }, E('h2', {}, _('Automatic check'))),
            E('label', { 'class': 'ju-check' }, [auto, _('Check for updates once a day')]),
            E('p', { 'class': 'ju-help' }, _('The router downloads one small file from GitHub, a few KB of data, and checks its signature. GitHub sees the router\'s internet address. Nothing installs until you tap Update now.'))
        ]));

        show(data);
        if (refreshPoll) poll.remove(refreshPoll);
        refreshPoll = function() {
            if (busy || !root.isConnected) return Promise.resolve();
            if (!updating && Date.now() - readAt < 60000) return Promise.resolve();
            return refresh();
        };
        poll.add(refreshPoll, 3);
        return root;
    },
    handleSaveApply: null,
    handleSave: null,
    handleReset: null
});
