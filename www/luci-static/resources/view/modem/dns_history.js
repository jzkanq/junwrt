'use strict';
'require view';
'require fs';

function command(action) {
    return fs.exec('/usr/bin/junwrt-dns-history', [action]).then(function(result) {
        var response = JSON.parse(result.stdout || '{}');
        if (result.code || response.error) throw new Error(response.error || _('DNS History command failed.'));
        return response;
    });
}

return view.extend({
    load: function() {
        return command('status').catch(function(error) { return { error: error.message }; });
    },

    render: function(initial) {
        var state = initial;
        var notice = E('p', { role: 'status' });
        var details = E('p', { 'class': 'ju-help' }, _('Shows up to 200 recent queries made through the router’s DNS resolver. The system log keeps its recent entries until they rotate or the router restarts.'));
        var client = E('select', { id: 'jun-dns-client' });
        var filter = E('input', { type: 'search', id: 'jun-dns-filter', placeholder: _('Search domains') });
        var results = E('div', { 'aria-live': 'polite' });
        var refresh = E('button', { 'class': 'ju-button ju-secondary', type: 'button', click: function() { return run('status'); } }, _('Refresh'));
        var toggle = E('button', { 'class': 'ju-button ju-primary', type: 'button', click: function() {
            if (window.confirm(state.enabled ? _('Disable DNS query logging? DNS service will restart.') :
                _('Enable DNS query logging? DNS service will restart. Queries may also be sent to a remote syslog server if one is configured.')))
                return run(state.enabled ? 'disable' : 'enable');
        } });

        function queries() { return Array.isArray(state.queries) ? state.queries : []; }

        function paintRows() {
            var query = filter.value.trim().toLowerCase();
            var rows = queries().filter(function(row) {
                return (!client.value || row.address === client.value) && row.domain.toLowerCase().indexOf(query) >= 0;
            });
            var content = rows.map(function(row) {
                return E('div', { 'class': 'ju-dns-row' }, [
                    E('strong', {}, row.domain),
                    E('div', { 'class': 'ju-help' }, [row.address, ' · ', row.kind, ' · ', row.time])
                ]);
            });
            if (!rows.length) content.push(E('p', { 'class': 'ju-help' },
                state.enabled ? _('No recent queries match.') : _('DNS query logging is off.')));
            results.replaceChildren.apply(results, content);
        }

        function paint() {
            notice.textContent = state.error || '';
            var selected = client.value;
            var addresses = Array.from(new Set(queries().map(function(row) { return row.address; }))).sort();
            client.replaceChildren.apply(client, [E('option', { value: '' }, _('All devices'))].concat(addresses.map(function(address) {
                return E('option', { value: address }, address);
            })));
            client.value = addresses.indexOf(selected) >= 0 ? selected : '';
            client.disabled = filter.disabled = !state.enabled;
            toggle.disabled = typeof state.enabled !== 'boolean';
            toggle.textContent = state.enabled ? _('Disable logging') : _('Enable logging');
            toggle.className = 'ju-button ' + (state.enabled ? 'ju-amber' : 'ju-primary');
            paintRows();
        }

        function run(action) {
            refresh.disabled = toggle.disabled = true;
            notice.textContent = _('Loading…');
            return command(action).then(function(response) {
                return action === 'status' ? response : command('status');
            }).then(function(response) {
                state = response;
                paint();
            }).catch(function(error) {
                paint();
                notice.textContent = error.message;
            }).then(function() { refresh.disabled = false; });
        }

        client.addEventListener('change', paintRows);
        filter.addEventListener('input', paintRows);
        paint();
        return E('div', { 'class': 'jun-ui ju-dns-page' }, [
            E('link', { rel: 'stylesheet', href: L.resource('view/modem/junwrt-ui.css') }),
            E('link', { rel: 'stylesheet', href: L.resource('view/modem/junwrt-dns.css') }),
            E('section', { 'class': 'ju-card' }, [
                E('h2', {}, _('DNS History')), details,
                E('div', { 'class': 'ju-dns-actions' }, [toggle, refresh]), notice,
                E('div', { 'class': 'ju-form' }, [
                    E('label', { 'class': 'ju-field', 'for': 'jun-dns-client' }, [E('span', {}, _('Client IP')), client]),
                    E('label', { 'class': 'ju-field', 'for': 'jun-dns-filter' }, [E('span', {}, _('Domain')), filter])
                ]), results
            ])
        ]);
    },
    handleSaveApply: null,
    handleSave: null,
    handleReset: null
});
