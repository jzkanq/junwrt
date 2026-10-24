'use strict';
'require view';
'require fs';
'require poll';
'require ui';

var refreshPoll;
var SVG_NS = 'http://www.w3.org/2000/svg';
var phases = {
    starting: _('Starting the test…'),
    cell: _('Reading the serving cell…'),
    latency: _('Measuring latency…'),
    download: _('Measuring download…'),
    upload: _('Measuring upload…'),
    saving: _('Saving the result…')
};
// The gauge labels sit at equal angles, so the scale is linear between labels and anything past the last one stays at the end.
var SCALE = [0, 5, 10, 50, 100, 250, 500, 750, 1000];
var ARC_START = 135, ARC_SWEEP = 270, NEEDLE_UP = 270, CX = 200, CY = 190, RADIUS = 150;
var ICONS = {
    ping: ['M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16z', 'M12 9v4l2.5 2', 'M9.5 2h5'],
    down: ['M12 4v11', 'M7 11l5 5 5-5', 'M5 20h14'],
    up: ['M12 20V9', 'M7 13l5-5 5 5', 'M5 4h14'],
    server: ['M5 4h14a2 2 0 0 1 2 2v3H3V6a2 2 0 0 1 2-2z', 'M3 14h18v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'M7 6.5h.01', 'M7 17h.01'],
    network: ['M5 20v-3', 'M10 20v-7', 'M15 20V9', 'M20 20V4']
};
var PHASE_METRIC = { latency: 'latency', download: 'down', upload: 'up' };

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

// Only a real number counts as a live reading, so a missing or malformed value never moves the needle.
function reading(value) {
    return typeof value === 'number' && isFinite(value) && value >= 0 ? value : null;
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

function lastTime(results) {
    return results.length ? Number(results[results.length - 1].time) || 0 : 0;
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

// SVG parts are created in the SVG namespace; colors come from the stylesheet so theme switches apply instantly.
function svg(tag, attrs, children) {
    var node = document.createElementNS(SVG_NS, tag);
    Object.keys(attrs || {}).forEach(function(key) { node.setAttribute(key, attrs[key]); });
    (children || []).forEach(function(child) { node.appendChild(child); });
    return node;
}

function paths(name) {
    return ICONS[name].map(function(d) { return svg('path', { d: d }); });
}

function icon(name) {
    return svg('svg', { 'class': 'st-icon', viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' }, paths(name));
}

function polar(degrees, radius) {
    var rad = degrees * Math.PI / 180;
    return [CX + radius * Math.cos(rad), CY + radius * Math.sin(rad)];
}

function fraction(mbps) {
    var v = Math.max(0, Number(mbps) || 0), i = 1;
    if (v >= SCALE[SCALE.length - 1]) return 1;
    while (v > SCALE[i]) i++;
    return (i - 1 + (v - SCALE[i - 1]) / (SCALE[i] - SCALE[i - 1])) / (SCALE.length - 1);
}

function gradient(id, from, to) {
    return svg('linearGradient', { id: id, x1: 0, y1: 0, x2: 1, y2: 0 }, [
        svg('stop', { 'class': from, offset: 0 }), svg('stop', { 'class': to, offset: 1 })]);
}

function buildGauge() {
    var a = polar(ARC_START, RADIUS), b = polar(ARC_START + ARC_SWEEP, RADIUS);
    var arc = 'M' + a[0].toFixed(2) + ' ' + a[1].toFixed(2) + ' A' + RADIUS + ' ' + RADIUS + ' 0 1 1 ' +
        b[0].toFixed(2) + ' ' + b[1].toFixed(2);
    var fill = svg('path', { 'class': 'st-arc st-fill', d: arc, pathLength: 100 });
    var needle = svg('g', { 'class': 'st-needle' }, [
        svg('path', { 'class': 'st-needle-body', d: 'M' + (CX - 5) + ' ' + CY + ' L' + CX + ' ' + (CY - 130) + ' L' + (CX + 5) + ' ' + CY + ' Z' }),
        svg('circle', { 'class': 'st-hub', cx: CX, cy: CY, r: 11 })]);
    var value = svg('text', { 'class': 'st-readout', x: CX, y: CY + 80 });
    var unit = svg('text', { 'class': 'st-readout-unit', x: CX - 8, y: CY + 110 });
    var ticks = SCALE.map(function(v, i) {
        var p = polar(ARC_START + ARC_SWEEP * i / (SCALE.length - 1), RADIUS + 26);
        var tick = svg('text', { 'class': 'st-tick', x: p[0].toFixed(1), y: (p[1] + 5).toFixed(1) });
        tick.textContent = String(v);
        return tick;
    });
    var arrows = ['down', 'up', 'ping'].map(function(name) {
        return svg('g', { 'class': 'st-arrow st-arrow-' + name, transform: 'translate(' + (CX - 40) + ' ' + (CY + 92) + ')' }, paths(name));
    });
    var root = svg('svg', { 'class': 'st-gauge', viewBox: '0 0 400 330', 'aria-hidden': 'true', focusable: 'false' },
        [svg('defs', {}, [gradient('jun-st-down', 'st-stop-down-a', 'st-stop-down-b'),
            gradient('jun-st-up', 'st-stop-up-a', 'st-stop-up-b')]), svg('path', { 'class': 'st-arc st-track', d: arc }), fill]
            .concat(ticks, [needle, value, unit], arrows));

    return {
        node: root,
        // state: { mode: idle | rest | sweep | value, dir: down | up | ping | '', mbps, text, unit }
        set: function(state) {
            var f = state.mode === 'value' ? fraction(state.mbps) : 0;
            ['down', 'up', 'ping'].forEach(function(dir) { root.classList.toggle('is-' + dir, state.dir === dir); });
            root.classList.toggle('is-live', state.mode !== 'idle');
            root.classList.toggle('is-value', state.mode === 'value');
            root.classList.toggle('is-sweep', state.mode === 'sweep');
            needle.style.transform = 'rotate(' + (ARC_START + ARC_SWEEP * f - NEEDLE_UP).toFixed(1) + 'deg)';
            fill.style.strokeDasharray = (100 * f).toFixed(2) + ' 100';
            value.textContent = state.text || '';
            unit.textContent = state.unit || '';
        }
    };
}

function infoRow(name, label, lines) {
    return E('div', { 'class': 'st-info-row' }, [icon(name), E('div', {}, [E('span', { 'class': 'st-label' }, label)].concat(lines))]);
}

return view.extend({
    load: function() { return getStatus(); },
    render: function(data) {
        var root = E('div', { 'class': 'jun-speedtest-page' });
        var pill = E('span', { 'class': 'st-pill' });
        var gauge = buildGauge();
        var stats = {};
        var jitter = E('span', { 'class': 'st-jitter' }, '–');
        var statsRow = E('div', { 'class': 'st-stats' }, [
            ['latency', _('Ping'), 'ms', 'ping'], ['down', _('Download'), 'Mbps', 'down'], ['up', _('Upload'), 'Mbps', 'up']
        ].map(function(item) {
            var value = E('span', { 'class': 'st-value' }, '–');
            var tile = E('div', { 'class': 'st-stat' }, [
                E('span', { 'class': 'st-label' }, [icon(item[3]), item[1]]), value, E('span', { 'class': 'st-unit' }, item[2])
            ].concat(item[0] === 'latency' ? [E('span', { 'class': 'st-sub' }, [_('Jitter') + ' ', jitter, ' ms'])] : []));
            stats[item[0]] = { tile: tile, value: value };
            return tile;
        }));
        var message = E('p', { 'class': 'st-message', role: 'status', 'aria-live': 'polite' });
        var start = E('button', { type: 'button', 'class': 'st-go st-primary cbi-button-action', 'aria-label': _('Start test') }, _('GO'));
        var again = E('span', { 'class': 'st-go-caption' });
        var clear = E('button', { type: 'button', 'class': 'st-button st-danger cbi-button-remove' }, _('Clear history'));
        var serverText = E('span', { 'class': 'st-mono st-server' });
        var networkText = E('span', { 'class': 'st-mono st-network' });
        var signalText = E('span', { 'class': 'st-mono st-subline' });
        var details = E('p', { 'class': 'st-help st-when' });
        var towers = E('div', { 'class': 'st-rows' });
        var history = E('div', { 'class': 'st-rows' });
        var stage = E('section', { 'class': 'st-card st-stage' }, [
            statsRow,
            E('div', { 'class': 'st-gauge-wrap' }, [gauge.node, E('div', { 'class': 'st-center' }, [start, again])]),
            message,
            E('div', { 'class': 'st-info' }, [
                infoRow('server', _('Server'), [serverText]),
                infoRow('network', _('Network'), [networkText, signalText])
            ]),
            details,
            E('p', { 'class': 'st-note' }, _('Each test transfers up to about 260 MB of mobile data, less on slower connections. Traffic from other devices during the test lowers the result.'))
        ]);
        var current = data;
        var busy = false;
        var launching = false;
        var wasRunning = !!data.running;
        var baseline = lastTime(data.results);

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
        // Draws the gauge, the three figures and the connection rows from the last status.
        function paint() {
            var status = current;
            var latest = status.results[status.results.length - 1];
            var active = launching || !!status.running;
            var phase = status.running ? status.phase : '';
            var measuring = phase === 'download' || phase === 'upload';
            var dir = phase === 'upload' ? 'up' : 'down';
            // While a test runs the helper reports the speed of the transfer in progress and the figures finished so far.
            var speed = measuring ? reading(status.live_mbps) : null;
            var shown = { latency: reading(status.live_latency), down: reading(status.live_down), up: null };
            if (speed != null) shown[dir] = speed;
            stage.classList.toggle('is-running', active);
            Object.keys(stats).forEach(function(key) {
                stats[key].tile.classList.toggle('is-active', active && PHASE_METRIC[phase] === key);
                stats[key].value.textContent = !active ? (latest ? num(latest[key], 1) : '–') :
                    shown[key] != null ? num(shown[key], 1) : '…';
            });
            jitter.textContent = !active ? (latest ? num(latest.jitter, 1) : '–') :
                reading(status.live_jitter) != null ? num(status.live_jitter, 1) : '…';
            if (!active)
                gauge.set({ mode: 'idle' });
            else if (speed != null)
                gauge.set({ mode: 'value', dir: dir, mbps: speed, text: num(speed, 1), unit: 'Mbps' });
            else if (measuring)
                gauge.set({ mode: 'sweep', dir: dir, text: '…', unit: 'Mbps' });
            else if (phase === 'saving')
                gauge.set({ mode: 'rest', dir: '', text: '…', unit: '' });
            else
                gauge.set({ mode: 'rest', dir: 'ping', text: '…', unit: 'ms' });
            again.textContent = status.results.length ? _('Test again') : '';
            serverText.textContent = latest ? [latest.server ? _('Cloudflare %s').format(latest.server) : _('Cloudflare'),
                latest.ipver ? 'IPv' + latest.ipver : null].filter(Boolean).join(' · ') : _('Nearest Cloudflare server');
            networkText.textContent = latest ? [latest.operator, latest.mode || cellName(latest)].filter(Boolean).join(' · ') : '–';
            signalText.textContent = latest ? signal(latest.rsrp, latest.sinr) : '';
            details.textContent = latest ? [_('Last test %s').format(when(latest.time)),
                _('%s MB used').format(num(latest.data_mb, 1))].join(' · ') : _('No tests yet.');
        }
        function update(status) {
            var results = status.results;
            var groups = groupCells(results);
            if (status.running)
                showMessage(_('%s %s s elapsed.').format(phases[status.phase] || phases.starting, Math.max(0, status.now - status.started)));
            else if (status.error)
                showMessage(status.error, true);
            else if (wasRunning && lastTime(results) > baseline)
                showMessage(_('Test complete.'));
            else if (wasRunning)
                showMessage(_('The test stopped without saving a result. Run junwrt-speedtest run over SSH for details.'), true);
            wasRunning = !!status.running;
            current = status;
            setButtons();
            pill.className = 'st-pill' + (status.running ? ' is-running' : status.error ? ' is-error' : '');
            pill.textContent = status.running ? _('Testing') : status.error ? _('Last test failed') : _('Ready');
            paint();
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
            launching = args[0] === 'start';
            setButtons();
            paint();
            showMessage(pending);
            return command(args).then(getStatus).then(update).catch(function(error) {
                return getStatus().then(update, function() {}).then(function() { showMessage(error.message, true); });
            }).finally(function() {
                busy = false;
                launching = false;
                setButtons();
                paint();
            });
        }

        start.addEventListener('click', function() {
            if (busy || current.running) return;
            wasRunning = true;
            baseline = lastTime(current.results);
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

        // A new filename bypasses the old speedtest.css that browsers keep even after a hard reload.
        root.appendChild(E('link', { rel: 'stylesheet', href: L.resource('view/modem/speedtest-v2.css') }));
        root.appendChild(E('header', { 'class': 'st-header' }, [
            E('div', {}, [E('h1', {}, _('Speed Test')),
                E('p', { 'class': 'st-help' }, _('Measures the router’s own cellular connection and records the serving cell, so you can compare towers and bands.'))]),
            pill]));
        root.appendChild(stage);
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
            E('p', { 'class': 'st-help' }, _('The router downloads from and uploads to the nearest Cloudflare server over 4 connections for up to 10 seconds each way. Latency is the median TCP connection time and jitter is its average change between samples. The test uses plain HTTP so the router’s encryption speed does not limit the result; it sends only test data. While a transfer runs the dial shows the cellular link’s throughput, read from the interface counters twice a second; the saved result counts only data the server confirmed, so it can differ a little from the last dial reading. Proxy or VPN apps that route the router’s own traffic change the result. Cell details come from the modem when the test starts. The router keeps the last 50 results.'))]));
        update(data);
        if (refreshPoll) poll.remove(refreshPoll);
        refreshPoll = function() {
            if (busy || !current.running || !root.isConnected) return Promise.resolve();
            return getStatus().then(update).catch(function(error) {
                showMessage(_('Status unavailable: %s').format(error.message), true);
            });
        };
        // One second keeps the dial close to the helper's twice-a-second readings; an idle page does no request.
        poll.add(refreshPoll, 1);
        return root;
    },
    handleSaveApply: null,
    handleSave: null,
    handleReset: null
});
