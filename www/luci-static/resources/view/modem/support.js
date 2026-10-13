'use strict';
'require view';
'require fs';

function command(args) {
    return fs.exec('/usr/bin/junwrt-support', args).then(function(result) {
        var data;
        try { data = JSON.parse(result.stdout || '{}'); }
        catch (e) { throw new Error(_('Invalid response from the support service.')); }
        if (data.error) throw new Error(data.error);
        return data;
    });
}

function kib(value) {
    var n = Number(value) || 0;
    return n >= 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + ' GB' : n >= 1024 ? Math.round(n / 1024) + ' MB' : n + ' kB';
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
        var root = E('div', { 'class': 'jun-ui jun-support-page' });
        var pill = E('span', { 'class': 'ju-pill' });
        var message = E('p', { 'class': 'ju-message', role: 'status', 'aria-live': 'polite' });
        var check = E('p', { 'class': 'ju-help' });
        var problems = E('div', { 'class': 'ju-list' });
        var services = E('div', { 'class': 'ju-list' });
        var values = {};
        var busy = false;

        ['built', 'payload', 'files', 'modules', 'uptime', 'memory', 'overlay'].forEach(function(key) {
            values[key] = E('span', { 'class': 'ju-value is-text' }, '–');
        });
        function say(text, isError) {
            message.textContent = text || '';
            message.classList.toggle('is-error', !!isError);
        }
        function show(status) {
            var v = status.verify;
            var differs = v.changed + v.missing;
            pill.className = 'ju-pill ' + (!status.installed ? '' : differs ? 'is-warn' : 'is-ok');
            pill.textContent = !status.installed ? _('Not installed by the WebUI installer')
                : differs ? _('%s file(s) differ').format(differs) : _('All files match');
            values.built.textContent = status.build.time || '–';
            values.payload.textContent = status.build.payload || '–';
            values.files.textContent = String(status.build.files);
            values.modules.textContent = status.build.modules || '–';
            values.uptime.textContent = duration(status.system.uptime);
            values.memory.textContent = kib(status.system.mem_available_kb);
            values.overlay.textContent = kib(status.system.overlay_free_kb);
            check.textContent = !status.installed ? _('This router has no install record yet. Run the WebUI installer once to create it.')
                : differs ? _('%s of %s files do not match the installer manifest. Run the installer again to restore them.').format(differs, v.total)
                : _('%s of %s files match the installer manifest.').format(v.ok, v.total);
            problems.replaceChildren();
            v.problems.forEach(function(p) {
                problems.appendChild(E('div', { 'class': 'ju-row' }, [E('span', { 'class': 'ju-mono' }, p.path),
                    E('span', { 'class': 'ju-pill is-warn' }, p.state === 'missing' ? _('Missing') : _('Changed'))]));
            });
            services.replaceChildren();
            Object.keys(status.services).forEach(function(name) {
                services.appendChild(E('div', { 'class': 'ju-row' }, [E('span', { 'class': 'ju-mono' }, name),
                    E('span', { 'class': 'ju-pill ' + (status.services[name] ? 'is-ok' : 'is-bad') }, status.services[name] ? _('Running') : _('Stopped'))]));
            });
            if (!Object.keys(status.services).length)
                services.appendChild(E('p', { 'class': 'ju-empty' }, _('No module services are recorded.')));
        }
        function run(pending, task) {
            if (busy) return Promise.resolve();
            busy = true;
            root.querySelectorAll('button').forEach(function(b) { b.disabled = true; });
            say(pending);
            return task().catch(function(error) { say(error.message, true); }).finally(function() {
                busy = false;
                root.querySelectorAll('button').forEach(function(b) { b.disabled = false; });
            });
        }

        var recheck = E('button', { type: 'button', 'class': 'ju-button ju-secondary cbi-button-neutral' }, _('Check again'));
        var download = E('button', { type: 'button', 'class': 'ju-button ju-primary cbi-button-action' }, _('Download support bundle'));
        recheck.addEventListener('click', function() {
            return run(_('Checking files…'), function() {
                return command(['status']).then(function(status) { show(status); say(_('Check finished.')); });
            });
        });
        download.addEventListener('click', function() {
            return run(_('Collecting diagnostics…'), function() {
                return fs.exec_direct('/usr/bin/junwrt-support', ['bundle'], 'blob').then(function(blob) {
                    var url = URL.createObjectURL(blob);
                    var link = E('a', { href: url, download: 'junwrt-support-' + new Date().toISOString().slice(0, 10) + '.tar.gz' });
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    URL.revokeObjectURL(url);
                    say(_('Support bundle saved. Review it before sharing.'));
                });
            });
        });

        root.appendChild(E('link', { rel: 'stylesheet', href: L.resource('view/modem/junwrt-ui.css') }));
        root.appendChild(E('header', { 'class': 'ju-header' }, [
            E('div', {}, [E('h1', {}, _('Support')),
                E('p', { 'class': 'ju-help' }, _('Shows which WebUI build is installed, checks its files and collects diagnostics for support.'))]),
            pill]));
        root.appendChild(E('section', { 'class': 'ju-card' }, [
            E('div', { 'class': 'ju-card-head' }, E('h2', {}, _('Installed build'))),
            E('div', { 'class': 'ju-grid' }, [
                stat(_('Built'), values.built), stat(_('Payload'), values.payload), stat(_('Files'), values.files),
                stat(_('Router uptime'), values.uptime), stat(_('Memory available'), values.memory), stat(_('Free storage'), values.overlay)
            ]),
            E('p', { 'class': 'ju-help' }, [_('Modules: '), values.modules])
        ]));
        root.appendChild(E('section', { 'class': 'ju-card' }, [
            E('div', { 'class': 'ju-card-head' }, [E('h2', {}, _('File check')), recheck]),
            check, problems
        ]));
        root.appendChild(E('section', { 'class': 'ju-card' }, [
            E('div', { 'class': 'ju-card-head' }, E('h2', {}, _('Services'))), services
        ]));
        root.appendChild(E('section', { 'class': 'ju-card' }, [
            E('div', { 'class': 'ju-card-head' }, E('h2', {}, _('Support bundle'))),
            E('p', { 'class': 'ju-help' }, _('A .tar.gz with system, network, log and configuration details. Passwords, keys, tokens and long numbers such as IMEI and IMSI are removed, but logs can still show IP addresses and device names, so look through it before you share it.')),
            E('div', { 'class': 'ju-actions' }, [download]),
            message
        ]));

        show(data);
        return root;
    },
    handleSaveApply: null,
    handleSave: null,
    handleReset: null
});
