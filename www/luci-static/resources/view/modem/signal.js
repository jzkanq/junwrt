'use strict';
'require view';
'require fs';
'require poll';

var refreshPoll;
var NS = 'http://www.w3.org/2000/svg';
var W = 600, H = 160, LEFT = 44, RIGHT = 8, TOP = 10, BOTTOM = 22;
// Chart colours come from classes so Light and Dark Mode switch at once; no white fills.
var STYLE = [
    '#maincontent .jun-signal-page .js-chart { display: block; width: 100%; height: auto; }',
    '#maincontent .jun-signal-page .js-grid { stroke: #e2e8f0; stroke-width: 1; }',
    '#maincontent .jun-signal-page .js-axis { fill: #64748b; font-size: 11px; }',
    '#maincontent .jun-signal-page .js-rsrp { fill: none; stroke: #0284c7; stroke-width: 2; }',
    '#maincontent .jun-signal-page .js-sinr { fill: none; stroke: #7c3aed; stroke-width: 2; }',
    'html[data-theme=dark] #maincontent .jun-signal-page .js-grid, html.dark-mode #maincontent .jun-signal-page .js-grid { stroke: #3f4044; }',
    'html[data-theme=dark] #maincontent .jun-signal-page .js-axis, html.dark-mode #maincontent .jun-signal-page .js-axis { fill: #9aa0a6; }',
    'html[data-theme=dark] #maincontent .jun-signal-page .js-rsrp, html.dark-mode #maincontent .jun-signal-page .js-rsrp { stroke: #38bdf8; }',
    'html[data-theme=dark] #maincontent .jun-signal-page .js-sinr, html.dark-mode #maincontent .jun-signal-page .js-sinr { stroke: #a78bfa; }'
].join('\n');

function command(args) {
    return fs.exec('/usr/bin/junwrt-signal', args).then(function(result) {
        var data;
        try { data = JSON.parse(result.stdout || '{}'); }
        catch (e) { throw new Error(_('Invalid response from Signal History.')); }
        if (Number(result.code) !== 0 || data.error)
            throw new Error(data.error || result.stderr || _('Signal History command failed.'));
        return data;
    });
}

function svg(tag, attrs, text) {
    var el = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(function(k) { el.setAttribute(k, attrs[k]); });
    if (text != null) el.textContent = text;
    return el;
}

function clock(t) {
    var d = new Date(t * 1000);
    return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
}

// One 24-hour line chart. Gaps longer than 10 minutes break the line.
function chart(samples, now, index, low, high, cls, unit) {
    var root = svg('svg', { 'class': 'js-chart', viewBox: '0 0 ' + W + ' ' + H, role: 'img' });
    var x = function(t) { return LEFT + (W - LEFT - RIGHT) * (t - (now - 86400)) / 86400; };
    var y = function(v) { return TOP + (H - TOP - BOTTOM) * (high - Math.max(low, Math.min(high, v))) / (high - low); };
    var step = (high - low) / 4, i, v, points = [], last = 0;
    for (i = 0; i <= 4; i++) {
        v = high - i * step;
        root.appendChild(svg('line', { 'class': 'js-grid', x1: LEFT, x2: W - RIGHT, y1: y(v), y2: y(v) }));
        root.appendChild(svg('text', { 'class': 'js-axis', x: LEFT - 6, y: y(v) + 4, 'text-anchor': 'end' }, Math.round(v)));
    }
    [[now - 86400, _('24 h ago')], [now - 43200, _('12 h ago')], [now, _('now')]].forEach(function(mark, n) {
        root.appendChild(svg('text', { 'class': 'js-axis', x: x(mark[0]), y: H - 4, 'text-anchor': n === 0 ? 'start' : n === 2 ? 'end' : 'middle' }, mark[1]));
    });
    function flush() {
        if (points.length > 1) root.appendChild(svg('polyline', { 'class': cls, points: points.join(' ') }));
        points = [];
    }
    samples.forEach(function(s) {
        if (s[index] == null) return;
        if (last && s[0] - last > 600) flush();
        points.push(x(s[0]).toFixed(1) + ',' + y(s[index]).toFixed(1));
        last = s[0];
    });
    flush();
    root.setAttribute('aria-label', unit);
    return root;
}

function summary(samples, index, unit) {
    var values = samples.map(function(s) { return s[index]; }).filter(function(v) { return v != null; });
    if (!values.length) return '–';
    var sum = values.reduce(function(a, b) { return a + b; }, 0);
    return _('lowest %s, average %s, highest %s %s').format(Math.min.apply(null, values), Math.round(sum / values.length * 10) / 10,
        Math.max.apply(null, values), unit);
}

function stat(label, node) {
    return E('div', { 'class': 'ju-stat' }, [E('span', { 'class': 'ju-label' }, label), node]);
}

return view.extend({
    load: function() { return command(['status']); },
    render: function(data) {
        var root = E('div', { 'class': 'jun-ui jun-signal-page' });
        var pill = E('span', { 'class': 'ju-pill' });
        var message = E('p', { 'class': 'ju-message', role: 'status', 'aria-live': 'polite' });
        var values = {};
        var charts = E('div', {});
        var enabled = E('input', { type: 'checkbox', id: 'signal-enabled' });
        var save = E('button', { type: 'button', 'class': 'ju-button ju-primary cbi-button-action' }, _('Save'));
        var clear = E('button', { type: 'button', 'class': 'ju-button ju-secondary cbi-button' }, _('Clear history'));
        var busy = false;

        ['rsrp', 'sinr', 'band', 'count'].forEach(function(key) {
            values[key] = E('span', { 'class': 'ju-value is-text' }, '–');
        });
        function say(text, isError) {
            message.textContent = text || '';
            message.classList.toggle('is-error', !!isError);
        }
        function show(s) {
            var samples = s.samples || [], last = samples[samples.length - 1], changes = [], prev = null;
            pill.className = 'ju-pill ' + (!s.enabled ? '' : !s.running ? 'is-bad' : samples.length ? 'is-ok' : 'is-warn');
            pill.textContent = !s.enabled ? _('Off') : !s.running ? _('Service not running') : samples.length ? _('Recording') : _('Waiting for the first reading');
            values.rsrp.textContent = last && last[1] != null ? last[1] + ' dBm' : '–';
            values.sinr.textContent = last && last[2] != null ? last[2] + ' dB' : '–';
            values.band.textContent = last ? last[4] : '–';
            values.count.textContent = String(samples.length);
            samples.forEach(function(x) {
                if (prev !== null && x[4] !== prev) changes.push(E('div', { 'class': 'ju-row' }, [
                    E('span', { 'class': 'ju-mono' }, clock(x[0])), E('span', { 'class': 'ju-help' }, '%s → %s'.format(prev, x[4]))]));
                prev = x[4];
            });
            charts.replaceChildren.apply(charts, samples.length < 2 ? [E('p', { 'class': 'ju-empty' },
                s.enabled ? _('The chart appears after the first few readings.') : _('No readings yet. Turn recording on below.'))] : [
                E('h3', {}, _('Signal strength (RSRP, dBm)')), chart(samples, s.now, 1, -130, -60, 'js-rsrp', 'RSRP'),
                E('p', { 'class': 'ju-help' }, summary(samples, 1, 'dBm')),
                E('h3', {}, _('Signal quality (SINR, dB)')), chart(samples, s.now, 2, -10, 30, 'js-sinr', 'SINR'),
                E('p', { 'class': 'ju-help' }, summary(samples, 2, 'dB')),
                E('h3', {}, _('Band changes')),
                changes.length ? E('div', { 'class': 'ju-list' }, changes.slice(-10)) : E('p', { 'class': 'ju-help' }, _('No band change in this time.'))
            ]);
        }

        function act(args, done) {
            if (busy) return Promise.resolve();
            busy = true;
            save.disabled = clear.disabled = true;
            say(_('Saving…'));
            return command(args).then(function(s) {
                show(s);
                enabled.checked = !!s.enabled;
                say(done(s));
            }).catch(function(error) {
                say(error.message, true);
            }).finally(function() {
                busy = false;
                save.disabled = clear.disabled = false;
            });
        }
        save.addEventListener('click', function() {
            return act(['save', 'enabled=' + (enabled.checked ? 1 : 0)], function(s) {
                return s.enabled ? _('Saved. The first reading comes within 2 minutes.') : _('Saved. Recording is off.');
            });
        });
        clear.addEventListener('click', function() {
            return act(['clear'], function() { return _('History cleared.'); });
        });

        root.appendChild(E('link', { rel: 'stylesheet', href: L.resource('view/modem/junwrt-ui.css') }));
        root.appendChild(E('style', {}, STYLE));
        root.appendChild(E('header', { 'class': 'ju-header' }, [
            E('div', {}, [E('h1', {}, _('Signal History')),
                E('p', { 'class': 'ju-help' }, _('Charts the cellular signal over the last 24 hours, to find the best spot for the router. It is off until you turn it on.'))]),
            pill]));
        root.appendChild(E('section', { 'class': 'ju-card' }, [
            E('div', { 'class': 'ju-card-head' }, E('h2', {}, _('Latest reading'))),
            E('div', { 'class': 'ju-grid' }, [stat('RSRP', values.rsrp), stat('SINR', values.sinr), stat(_('Band'), values.band), stat(_('Readings'), values.count)])
        ]));
        root.appendChild(E('section', { 'class': 'ju-card' }, [
            E('div', { 'class': 'ju-card-head' }, E('h2', {}, _('Last 24 hours'))), charts]));
        root.appendChild(E('section', { 'class': 'ju-card' }, [
            E('div', { 'class': 'ju-card-head' }, E('h2', {}, _('Settings'))),
            E('label', { 'class': 'ju-check', 'for': 'signal-enabled' }, [enabled, _('Record the signal every 2 minutes')]),
            E('div', { 'class': 'ju-actions' }, [save, clear]),
            message,
            E('p', { 'class': 'ju-help' }, _('Readings stay in memory for 24 hours, and a restart clears them. Each reading asks the modem once, like the Overview page does.')),
            E('p', { 'class': 'ju-help' }, _('To compare spots: move the router, wait 10 minutes, and compare the lines. Higher is better for both.'))
        ]));

        show(data);
        enabled.checked = !!data.enabled;
        if (refreshPoll) poll.remove(refreshPoll);
        refreshPoll = function() {
            if (busy || !root.isConnected) return Promise.resolve();
            return command(['status']).then(show).catch(function() {});
        };
        poll.add(refreshPoll, 60);
        return root;
    },
    handleSaveApply: null,
    handleSave: null,
    handleReset: null
});
