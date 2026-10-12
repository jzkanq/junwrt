'use strict';
'require view';
'require fs';
'require poll';
'require ui';

var refreshPoll;
var phases = {
    starting: _('Starting the test…'),
    cell: _('Reading the serving cell…'),
    latency: _('Measuring latency…'),
    download: _('Measuring download…'),
    upload: _('Measuring upload…'),
    saving: _('Saving the result…')
};

function command(args) {
    return fs.exec('/usr/bin/junwrt-speedtest', args).then(function(result) {
        if (Number(result.code) !== 0)
            throw new Error(String(result.stdout || result.stderr || _('Speed test command failed.')).trim());
        return String(result.stdout || '');
    });
}

function getStatus() {
    return command(['status']).then(function(stdout) {
        var data;
        try { data = JSON.parse(stdout); }
        catch (e) { throw new Error(_('Speed test returned invalid status data.')); }
        data.results = Array.isArray(data.results) ? data.results : [];
        return data;
    });
}

function num(value, digits) {
    return value == null || !isFinite(Number(value)) ? '–' : Number(value).toFixed(digits);
}

function band(value) {
    return String(value || '').split(' ')[0];
}

function cellName(r) {
    if (!r.pband) return _('Unknown cell');
    var name = _('%s · PCI %s').format(band(r.pband), r.pci != null ? r.pci : '–');
    return r.s1band ? name + ' + ' + _('%s · PCI %s').format(band(r.s1band), r.s1pci != null ? r.s1pci : '–') : name;
}

function signal(rsrp, sinr) {
    return _('RSRP %s dBm · SINR %s dB').format(num(rsrp, 0), num(sinr, 1));
}

function mean(list, key) {
    var values = list.filter(function(r) { return r[key] != null && isFinite(Number(r[key])); })
        .map(function(r) { return Number(r[key]); });
    return values.length ? values.reduce(function(a, b) { return a + b; }, 0) / values.length : null;
}

function groupCells(results) {
    var groups = {};
    results.forEach(function(r) {
        var name = cellName(r);
        (groups[name] = groups[name] || []).push(r);
    });
    return Object.keys(groups).map(function(name) {
        var list = groups[name];
        return { name: name, latest: list[list.length - 1], count: list.length, s1band: list[list.length - 1].s1band,
            down: mean(list, 'down'), up: mean(list, 'up'), latency: mean(list, 'latency'),
            rsrp: mean(list, 'rsrp'), sinr: mean(list, 'sinr'), s1rsrp: mean(list, 's1rsrp'), s1sinr: mean(list, 's1sinr') };
    }).sort(function(a, b) { return (b.down || 0) - (a.down || 0); });
}

function when(epoch) {
    return new Date(Number(epoch) * 1000).toLocaleString();
}

function metric(label, value) {
    return E('div', { 'class': 'st-metric' }, [E('span', { 'class': 'st-label' }, label), E('span', { 'class': 'st-mono' }, value)]);
}

function signalMetric(item) {
    var lines = [E('span', { 'class': 'st-mono' }, signal(item.rsrp, item.sinr))];
    if (item.s1band)
        lines.push(E('span', { 'class': 'st-mono st-subline' }, band(item.s1band) + ': ' + signal(item.s1rsrp, item.s1sinr)));
    return E('div', { 'class': 'st-metric' }, [E('span', { 'class': 'st-label' }, _('Signal'))].concat(lines));
}

function resultRow(title, subtitle, badge, item) {
    return E('div', { 'class': 'st-row' }, [
        E('div', { 'class': 'st-row-title' }, [E('strong', {}, title), badge || '', E('span', { 'class': 'st-help' }, subtitle)]),
        metric(_('Download'), num(item.down, 1) + ' Mbps'),
        metric(_('Upload'), num(item.up, 1) + ' Mbps'),
        metric(_('Latency'), num(item.latency, 1) + ' ms'),
        signalMetric(item)
    ]);
}

return view.extend({
    load: function() { return getStatus(); },
    render: function(data) {
        var root = E('div', { 'class': 'jun-speedtest-page' });
        var pill = E('span', { 'class': 'st-pill' });
        var values = {};
        var tiles = E('div', { 'class': 'st-tiles' }, [
            ['down', _('Download'), 'Mbps'], ['up', _('Upload'), 'Mbps'],
            ['latency', _('Latency'), 'ms'], ['jitter', _('Jitter'), 'ms']
        ].map(function(tile) {
            values[tile[0]] = E('span', { 'class': 'st-value' }, '–');
            return E('div', { 'class': 'st-tile' }, [E('span', { 'class': 'st-label' }, tile[1]),
                E('div', {}, [values[tile[0]], E('span', { 'class': 'st-unit' }, tile[2])])]);
        }));
        var details = E('p', { 'class': 'st-help' });
        var cellLine = E('p', { 'class': 'st-cell' });
        var message = E('p', { 'class': 'st-message', role: 'status', 'aria-live': 'polite' });
        var start = E('button', { type: 'button', 'class': 'st-button st-primary cbi-button-action' }, _('Start test'));
        var clear = E('button', { type: 'button', 'class': 'st-button st-danger cbi-button-remove' }, _('Clear history'));
        var towers = E('div', { 'class': 'st-rows' });
        var history = E('div', { 'class': 'st-rows' });
        var current = data;
        var busy = false;
        var wasRunning = !!data.running;

        function showMessage(text, isError) {
            message.textContent = text || '';
            message.classList.toggle('is-error', !!isError);
        }
        function setButtons() {
            start.disabled = busy || !!current.running;
            clear.disabled = busy || !!current.running || !current.results.length;
        }
        function fill(container, rows, empty) {
            container.replaceChildren();
            (rows.length ? rows : [E('p', { 'class': 'st-empty' }, empty)]).forEach(function(row) { container.appendChild(row); });
        }
        function update(status) {
            var results = status.results;
            var latest = results[results.length - 1];
            var groups = groupCells(results);
            if (status.running)
                showMessage(_('%s %s s elapsed.').format(phases[status.phase] || phases.starting, Math.max(0, status.now - status.started)));
            else if (status.error)
                showMessage(status.error, true);
            else if (wasRunning)
                showMessage(_('Test complete.'));
            wasRunning = !!status.running;
            current = status;
            setButtons();
            pill.className = 'st-pill' + (status.running ? ' is-running' : status.error ? ' is-error' : '');
            pill.textContent = status.running ? _('Testing') : status.error ? _('Last test failed') : _('Ready');
            Object.keys(values).forEach(function(key) { values[key].textContent = latest ? num(latest[key], 1) : '–'; });
            details.textContent = latest ? [_('Last test %s').format(when(latest.time)),
                latest.server ? _('Cloudflare %s').format(latest.server) : null,
                latest.ipver ? 'IPv' + latest.ipver : null,
                _('%s MB used').format(num(latest.data_mb, 1))].filter(Boolean).join(' · ') : _('No tests yet.');
            cellLine.textContent = latest ? [latest.mode || cellName(latest), latest.operator,
                signal(latest.rsrp, latest.sinr)].filter(Boolean).join(' · ') : '';
            fill(towers, groups.map(function(group, index) {
                return resultRow(group.name, [group.latest.operator,
                    group.latest.earfcn != null ? 'EARFCN ' + group.latest.earfcn : null,
                    group.count === 1 ? _('1 test') : _('%s tests').format(group.count)].filter(Boolean).join(' · '),
                    index === 0 && groups.length > 1 ? E('span', { 'class': 'st-pill is-best' }, _('Fastest')) : null, group);
            }), _('No tests yet. Run a test to start comparing cells.'));
            fill(history, results.slice().reverse().map(function(r) {
                return resultRow(when(r.time), cellName(r), null, r);
            }), _('No saved results.'));
        }
        function action(args, pending) {
            busy = true;
            setButtons();
            showMessage(pending);
            return command(args).then(getStatus).then(update).catch(function(error) {
                return getStatus().then(update, function() {}).then(function() { showMessage(error.message, true); });
            }).finally(function() {
                busy = false;
                setButtons();
            });
        }

        start.addEventListener('click', function() {
            if (busy || current.running) return;
            wasRunning = true;
            return action(['start'], _('Starting the test…'));
        });
        clear.addEventListener('click', function() {
            ui.showModal(_('Clear speed test history?'), [
                E('p', {}, _('This removes all saved results and the tower comparison.')),
                E('div', { 'class': 'right' }, [
                    E('button', { 'class': 'btn cbi-button cbi-button-neutral', click: ui.hideModal }, _('Cancel')), ' ',
                    E('button', { 'class': 'btn cbi-button cbi-button-remove', click: function() {
                        ui.hideModal();
                        return action(['clear'], _('Clearing history…')).then(function() {
                            if (!current.results.length) showMessage(_('History cleared.'));
                        });
                    } }, _('Clear history'))
                ])
            ]);
        });

        root.appendChild(E('link', { rel: 'stylesheet', href: L.resource('view/modem/speedtest.css') }));
        root.appendChild(E('header', { 'class': 'st-header' }, [
            E('div', {}, [E('h1', {}, _('Speed Test')),
                E('p', { 'class': 'st-help' }, _('Measures the router’s own cellular connection and records the serving cell, so you can compare towers and bands.'))]),
            pill]));
        root.appendChild(E('section', { 'class': 'st-card' }, [
            E('div', { 'class': 'st-card-heading' }, [E('h2', {}, _('Latest result')), start]),
            tiles, details, cellLine, message,
            E('p', { 'class': 'st-note' }, _('Each test transfers up to about 260 MB of mobile data, less on slower connections. Traffic from other devices during the test lowers the result.'))
        ]));
        root.appendChild(E('section', { 'class': 'st-card' }, [
            E('div', { 'class': 'st-card-heading' }, E('h2', {}, _('Tower Analyzer'))),
            E('p', { 'class': 'st-help' }, _('Results grouped by serving cell, fastest first. To compare towers, lock a cell or band, run a test on each and repeat at a similar time of day.')),
            towers,
            E('div', { 'class': 'st-actions' }, [
                E('a', { 'class': 'st-button st-secondary cbi-button-neutral', href: L.url('admin/modem/3ginfo-lite/cellscan') }, _('Neighbor Cell')),
                E('a', { 'class': 'st-button st-secondary cbi-button-neutral', href: L.url('admin/modem/3ginfo-lite/lockband') }, _('Lock Band'))
            ])
        ]));
        root.appendChild(E('section', { 'class': 'st-card' }, [
            E('div', { 'class': 'st-card-heading' }, [E('h2', {}, _('History')), clear]),
            history
        ]));
        root.appendChild(E('details', { 'class': 'st-details' }, [E('summary', {}, _('How the test works and its limits')),
            E('p', { 'class': 'st-help' }, _('The router downloads from and uploads to the nearest Cloudflare server over 4 connections for up to 10 seconds each way. Latency is the median TCP connection time and jitter is its average change between samples. The test uses plain HTTP so the router’s encryption speed does not limit the result; it sends only test data. Proxy or VPN apps that route the router’s own traffic change the result. Cell details come from the modem when the test starts. The router keeps the last 50 results.'))]));
        update(data);
        if (refreshPoll) poll.remove(refreshPoll);
        refreshPoll = function() {
            if (busy || !current.running || !root.isConnected) return Promise.resolve();
            return getStatus().then(update).catch(function(error) {
                showMessage(_('Status unavailable: %s').format(error.message), true);
            });
        };
        poll.add(refreshPoll, 2);
        return root;
    },
    handleSaveApply: null,
    handleSave: null,
    handleReset: null
});
