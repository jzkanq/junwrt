'use strict';
'require view';
'require fs';
'require poll';

var refreshPoll;
// The six lights under the cube. A light can be two LEDs (red and green), so it is switched as one.
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

// Groups the LEDs by the name before the colon; LEDs that belong to none of the six are not front-panel lights.
function sortLights(leds) {
    var lights = PANEL.map(function(entry) { return { key: entry[0], title: entry[1], leds: [] }; });
    var extra = 0;
    (leds || []).forEach(function(led) {
        var key = led.name.split(':')[0].toLowerCase();
        var light = lights.filter(function(l) { return l.key === key; })[0];
        if (light) light.leds.push(led); else extra++;
    });
    lights = lights.filter(function(light) { return light.leds.length; });
    lights.forEach(function(light) { light.leds.sort(function(a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; }); });
    return { lights: lights, extra: extra };
}

function stateOf(leds) {
    var states = leds.map(function(led) { return led.state; });
    return ['blink', 'lit', 'auto'].filter(function(s) { return states.indexOf(s) >= 0; })[0] || 'dark';
}

return view.extend({
    load: function() { return command(['status']); },
    render: function(data) {
        var root = E('div', { 'class': 'jun-ui jun-lights-page' });
        var pill = E('span', { 'class': 'ju-pill' });
        var summary = E('p', { 'class': 'ju-help' });
        var notice = E('p', { 'class': 'ju-notice', role: 'status' });
        var offNote = E('p', { 'class': 'ju-help' }, _('The lights are off. These settings apply when you turn them back on.'));
        var extraNote = E('p', { 'class': 'ju-help' });
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
        function buildRow(light, index) {
            var row = { light: light };
            row.state = E('span', { 'class': 'ju-pill' });
            row.on = E('input', { type: 'checkbox', id: 'lights-on-' + index, 'aria-label': _('Allow %s to light').format(light.title) });
            row.node = E('div', { 'class': 'ju-row' }, [
                E('div', { 'class': 'ju-row-main' }, [E('strong', {}, light.title),
                    E('div', {}, [E('span', { 'class': 'ju-mono' }, light.leds.map(function(led) { return led.name; }).join(' · ')), ' ', row.state])]),
                E('div', { 'class': 'ju-actions' }, E('label', { 'class': 'ju-check', 'for': 'lights-on-' + index }, [row.on, _('On')]))
            ]);
            return row;
        }
        function showStatus(status, keepForm) {
            var sorted = sortLights(status.leds);
            var wanted = sorted.lights.map(function(light) { return light.leds.map(function(led) { return led.name; }).join('+'); }).join(' ');
            var off = status.lights === 'off';
            var held = sorted.lights.some(function(light) { return light.leds.some(function(led) { return led.mode !== 'on'; }); });
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
            empty.hidden = !!sorted.lights.length;
            extraNote.hidden = !sorted.extra;
            extraNote.textContent = _('%s other LED(s) are not front-panel lights and are not listed. Turn all lights off also darkens them.').format(sorted.extra);
            if (wanted !== signature) {
                signature = wanted;
                keepForm = false;
                rows = sorted.lights.map(buildRow);
                list.replaceChildren.apply(list, rows.map(function(row) { return row.node; }));
            }
            rows.forEach(function(row, i) {
                var light = sorted.lights[i];
                var state = STATES[stateOf(light.leds)];
                row.light = light;
                row.state.className = 'ju-pill ' + state[1];
                row.state.textContent = state[0];
                if (!keepForm) row.on.checked = light.leds.every(function(led) { return led.mode === 'on'; });
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
                row.light.leds.forEach(function(led) { args.push('led.' + led.name + '=' + (row.on.checked ? 'on' : 'off')); });
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
                E('p', { 'class': 'ju-help' }, _('Turn the front-panel lights off, or switch single lights off. Nothing changes until you press a button.'))]),
            pill]));
        root.appendChild(E('section', { 'class': 'ju-card' }, [
            E('div', { 'class': 'ju-card-head' }, [E('h2', {}, _('All lights')), master]),
            summary, notice
        ]));
        root.appendChild(E('section', { 'class': 'ju-card' }, [
            E('div', { 'class': 'ju-card-head' }, E('h2', {}, _('Single lights'))),
            E('p', { 'class': 'ju-help' }, _('Untick a light to keep it dark. Status, Signal, Wi-Fi and Phone are red and green LEDs; ticking or unticking a light switches both. These lights can only be on or off, not dimmed.')),
            offNote, list, empty, extraNote,
            E('div', { 'class': 'ju-actions' }, [save_button, restore_button]),
            message
        ]));
        root.appendChild(E('details', { 'class': 'ju-details' }, [E('summary', {}, _('How it works')),
            E('p', { 'class': 'ju-help' }, _('Turn all lights off uses the router\'s own lights switch, the one its lights button toggles, so it also holds after a reboot. A single light is held by a small service that checks every two seconds and darkens a light the router has switched back on, so a light can flash briefly. When a light comes back on, the router redraws it, so its colour follows the router\'s current state. Restore factory removes every setting here and hands the lights back to the router. Lights can still glow while the router starts.'))]));

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
