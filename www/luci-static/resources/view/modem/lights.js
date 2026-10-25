'use strict';
'require view';
'require fs';
'require poll';

var refreshPoll;
// Front-panel order (the label under the cube); other LED names follow alphabetically.
var PANEL = [['status', _('Status')], ['signal', _('Signal')], ['5g', _('5G')], ['internet', _('Internet')], ['wifi', _('Wi-Fi')], ['phone', _('Phone')]];
var STATES = {
    lit: [_('Lit'), 'is-ok'],
    dark: [_('Dark'), ''],
    blink: [_('Blinking'), 'is-warn'],
    auto: [_('Automatic'), '']
};

function command(args) {
    return fs.exec('/usr/bin/junwrt-lights', args).then(function(result) {
        var data;
        try { data = JSON.parse(result.stdout || '{}'); }
        catch (e) { throw new Error(_('Invalid response from Light Control.')); }
        if (Number(result.code) !== 0 || data.error)
            throw new Error(data.error || result.stderr || _('Light Control command failed.'));
        return data;
    });
}

function describe(name) {
    var parts = name.split(':');
    var info = { rank: PANEL.length, title: parts[0], detail: parts.slice(1).join(' ') };
    PANEL.forEach(function(entry, rank) {
        if (entry[0] === parts[0].toLowerCase()) { info.rank = rank; info.title = entry[1]; }
    });
    return info;
}

function byPanel(a, b) {
    var x = describe(a.name), y = describe(b.name);
    return x.rank - y.rank || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
}

return view.extend({
    load: function() { return command(['status']); },
    render: function(data) {
        var root = E('div', { 'class': 'jun-ui jun-lights-page' });
        var pill = E('span', { 'class': 'ju-pill' });
        var summary = E('p', { 'class': 'ju-help' });
        var notice = E('p', { 'class': 'ju-notice', role: 'status' });
        var offNote = E('p', { 'class': 'ju-help' }, _('The lights are off. These settings apply when you turn them back on.'));
        var empty = E('p', { 'class': 'ju-empty' }, _('This router reports no lights.'));
        var list = E('div', { 'class': 'ju-list' });
        var message = E('p', { 'class': 'ju-message', role: 'status', 'aria-live': 'polite' });
        var master = E('button', { type: 'button', 'class': 'ju-button ju-primary cbi-button-action' });
        var rows = [];
        var signature = '';
        var current = data;
        var busy = false;

        function buttonsDisabled(state) {
            root.querySelectorAll('button').forEach(function(button) { button.disabled = state; });
        }
        function say(text, isError) {
            message.textContent = text || '';
            message.classList.toggle('is-error', !!isError);
        }
        function buildRow(led, index) {
            var info = describe(led.name);
            var title = info.title + (info.detail ? ' · ' + info.detail : '');
            var row = { name: led.name, max: led.max };
            var controls = [];
            row.state = E('span', { 'class': 'ju-pill' });
            row.on = E('input', { type: 'checkbox', id: 'lights-on-' + index, 'aria-label': _('Allow %s to light').format(title) });
            controls.push(E('label', { 'class': 'ju-check', 'for': 'lights-on-' + index }, [row.on, _('On')]));
            if (led.max > 1) {
                row.slider = E('input', { type: 'range', min: '1', max: '100', step: '1', id: 'lights-level-' + index, 'aria-label': _('Brightness of %s').format(title) });
                row.level = E('span', { 'class': 'ju-mono' }, '100%');
                row.slider.addEventListener('input', function() { row.level.textContent = row.slider.value + '%'; });
                controls.push(E('label', { 'class': 'ju-field', 'for': 'lights-level-' + index }, [E('span', {}, [_('Brightness') + ' ', row.level]), row.slider]));
            }
            row.node = E('div', { 'class': 'ju-row' }, [
                E('div', { 'class': 'ju-row-main' }, [E('strong', {}, title), E('div', {}, [E('span', { 'class': 'ju-mono' }, led.name), ' ', row.state])]),
                E('div', { 'class': 'ju-actions' }, controls)
            ]);
            return row;
        }
        function fillRow(row, led) {
            row.on.checked = led.mode !== 'off';
            if (row.slider) {
                row.slider.value = String(led.level);
                row.level.textContent = led.level + '%';
            }
        }
        function showStatus(status, keepForm) {
            var leds = (status.leds || []).slice().sort(byPanel);
            var wanted = leds.map(function(led) { return led.name + ':' + led.max; }).join(' ');
            var off = status.lights === 'off';
            var held = leds.some(function(led) { return led.mode !== 'on'; });
            var label = off ? [_('Lights off'), 'is-warn'] : held ? [_('Customized'), 'is-ok'] : [_('Factory'), ''];
            current = status;
            pill.className = 'ju-pill ' + label[1];
            pill.textContent = label[0];
            summary.textContent = off ? _('Every front-panel light is dark, including the status light. This stays after a reboot.')
                : _('The lights follow the router\'s normal behavior except for the changes saved below.');
            master.textContent = off ? _('Turn lights on') : _('Turn all lights off');
            offNote.hidden = !off;
            notice.hidden = !(status.wanted && !status.running);
            notice.textContent = _('The Light Control service is not running, so a light the router switches back on will stay on. Restart the router or reinstall the WebUI.');
            empty.hidden = !!leds.length;
            if (wanted !== signature) {
                signature = wanted;
                keepForm = false;
                rows = leds.map(buildRow);
                list.replaceChildren.apply(list, rows.map(function(row) { return row.node; }));
            }
            rows.forEach(function(row, i) {
                var state = STATES[leds[i].state] || STATES.auto;
                row.state.className = 'ju-pill ' + state[1];
                row.state.textContent = state[0];
                if (!keepForm) fillRow(row, leds[i]);
            });
        }
        function refresh(text, keepForm) {
            return command(['status']).then(function(status) {
                showStatus(status, keepForm);
                if (text) say(text);
            });
        }
        function run(args, pending, done) {
            if (busy) return Promise.resolve();
            busy = true;
            buttonsDisabled(true);
            say(pending);
            return command(args).then(done).catch(function(error) { say(error.message, true); }).finally(function() {
                busy = false;
                buttonsDisabled(false);
            });
        }

        master.addEventListener('click', function() {
            var target = current.lights === 'off' ? 'on' : 'off';
            return run(['save', 'lights=' + target], target === 'off' ? _('Turning the lights off…') : _('Turning the lights on…'), function() {
                return refresh(target === 'off' ? _('All lights are off.') : _('Lights are on.'), true);
            });
        });
        var save_button = E('button', { type: 'button', 'class': 'ju-button ju-primary cbi-button-action' }, _('Save'));
        var restore_button = E('button', { type: 'button', 'class': 'ju-button ju-secondary cbi-button-neutral' }, _('Restore factory'));
        save_button.addEventListener('click', function() {
            var args = ['save'];
            rows.forEach(function(row) {
                var level = row.slider ? Number(row.slider.value) : 100;
                args.push('led.' + row.name + '=' + (!row.on.checked ? 'off' : level < 100 ? String(level) : 'on'));
            });
            if (args.length === 1) return Promise.resolve();
            return run(args, _('Saving…'), function() { return refresh(_('Saved.')); });
        });
        restore_button.addEventListener('click', function() {
            return run(['restore'], _('Restoring…'), function() { return refresh(_('Factory light behavior restored.')); });
        });

        root.appendChild(E('link', { rel: 'stylesheet', href: L.resource('view/modem/junwrt-ui.css') }));
        root.appendChild(E('header', { 'class': 'ju-header' }, [
            E('div', {}, [E('h1', {}, _('Light Control')),
                E('p', { 'class': 'ju-help' }, _('Turn the front-panel lights off, or switch single lights off or dim them. Nothing changes until you press a button.'))]),
            pill]));
        root.appendChild(E('section', { 'class': 'ju-card' }, [
            E('div', { 'class': 'ju-card-head' }, [E('h2', {}, _('All lights')), master]),
            summary, notice
        ]));
        root.appendChild(E('section', { 'class': 'ju-card' }, [
            E('div', { 'class': 'ju-card-head' }, E('h2', {}, _('Single lights'))),
            E('p', { 'class': 'ju-help' }, _('Untick a light to keep it dark. Brightness appears only on lights that support it, and only changes steady lights.')),
            offNote, list, empty,
            E('div', { 'class': 'ju-actions' }, [save_button, restore_button]),
            message
        ]));
        root.appendChild(E('details', { 'class': 'ju-details' }, [E('summary', {}, _('How it works')),
            E('p', { 'class': 'ju-help' }, _('Turn all lights off uses the router\'s own lights switch, the one its lights button toggles, so it also holds after a reboot. A single light is held by a small service that checks every two seconds and darkens a light the router has switched back on, so a light can flash briefly. Dimming changes only steady lights on hardware with several brightness levels. Restore factory removes every setting here and hands the lights back to the router. Lights can still glow while the router starts.'))]));

        showStatus(data);
        if (refreshPoll) poll.remove(refreshPoll);
        refreshPoll = function() {
            if (busy || !root.isConnected) return Promise.resolve();
            return command(['status']).then(function(status) { showStatus(status, true); }).catch(function() {});
        };
        poll.add(refreshPoll, 5);
        return root;
    },
    handleSaveApply: null,
    handleSave: null,
    handleReset: null
});
