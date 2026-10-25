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
// The LEDs only switch on and off, so a two-colour light can show red, green or both (orange).
var TWO = [['on', _('Normal')], ['off', _('Off')], ['red', _('Red')], ['green', _('Green')], ['orange', _('Orange')]];
var ONE = [['on', _('Normal')], ['off', _('Off')], ['lit', _('Always on')]];
var PATTERNS = [['mix', _('Mix of all')], ['chase', _('Chase')], ['pingpong', _('Ping-pong')], ['blink', _('Blink')],
    ['alternate', _('Alternate')], ['wave', _('Colour wave')], ['sparkle', _('Sparkle')]];
var SPEEDS = [['slow', _('Slow')], ['normal', _('Normal')], ['fast', _('Fast')]];
var SHOW_COLOURS = [['mixed', _('All colours')], ['green', _('Green')], ['red', _('Red')], ['orange', _('Orange')]];
var DURATIONS = [['5', _('5 minutes')], ['15', _('15 minutes')], ['30', _('30 minutes')], ['60', _('1 hour')], ['120', _('2 hours')]];

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

// A light with exactly one red and one green LED can mix them; other lights have one LED to switch.
function colourPair(light) {
    var red, green;
    light.leds.forEach(function(led) {
        if (/:red$/.test(led.name)) red = led;
        else if (/:green$/.test(led.name)) green = led;
    });
    return red && green && light.leds.length === 2 ? { red: red, green: green } : null;
}

// The choice that describes the saved modes of a light, or 'mixed' when they do not form one.
function choiceOf(light) {
    var pair = colourPair(light);
    var modes = light.leds.map(function(led) { return led.mode; });
    if (pair)
        return { 'on/on': 'on', 'off/off': 'off', 'lit/off': 'red', 'off/lit': 'green', 'lit/lit': 'orange' }[pair.red.mode + '/' + pair.green.mode] || 'mixed';
    return modes.every(function(mode) { return mode === modes[0]; }) ? modes[0] : 'mixed';
}

// One led.NAME=on|off|lit argument per LED of the light, so both colours always change together.
function pairsOf(light, choice) {
    var pair = colourPair(light);
    return light.leds.map(function(led) {
        var mode = choice;
        if (choice === 'mixed') mode = led.mode;
        else if (pair && choice !== 'on' && choice !== 'off')
            mode = choice === 'orange' || choice === (led === pair.red ? 'red' : 'green') ? 'lit' : 'off';
        return 'led.' + led.name + '=' + mode;
    });
}

function option(value, label, selected) {
    return E('option', { value: String(value), selected: String(value) === String(selected) ? 'selected' : null }, label);
}

function select(choices, id, label) {
    return E('select', { id: id, 'aria-label': label }, choices.map(function(c) { return option(c[0], c[1], ''); }));
}

function setChoice(element, value, label) {
    var wanted = String(value);
    var found = Array.prototype.some.call(element.options || [], function(o) { return o.value === wanted; });
    if (!found) element.appendChild(option(wanted, label || wanted, wanted));
    element.value = wanted;
}

function nameOf(choices, value) {
    return (choices.filter(function(c) { return c[0] === value; })[0] || [value, value])[1];
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
        var discoLine = E('p', { 'class': 'ju-help' });
        var discoMessage = E('p', { 'class': 'ju-message', role: 'status', 'aria-live': 'polite' });
        var master = E('button', { type: 'button', 'class': 'ju-button ju-primary cbi-button-action' });
        var show = {
            pattern: select(PATTERNS, 'lights-show-pattern', _('Disco pattern')),
            speed: select(SPEEDS, 'lights-show-speed', _('Disco speed')),
            colour: select(SHOW_COLOURS, 'lights-show-colour', _('Disco colour')),
            minutes: select(DURATIONS, 'lights-show-minutes', _('Stop the disco after'))
        };
        var rows = [];
        var signature = '';
        var current = data;
        var busy = false;

        setChoice(show.pattern, 'mix');
        setChoice(show.speed, 'normal');
        setChoice(show.colour, 'mixed');
        setChoice(show.minutes, '15');

        // While a show runs it owns the lights: the settings wait, and only Stop and Restore factory act.
        function applyLocks() {
            var running = !!(current && current.disco);
            master.disabled = running;
            save_button.disabled = running;
            stop_button.disabled = !running;
            rows.forEach(function(row) { row.pick.disabled = running; });
        }
        function buttonsDisabled(state) {
            root.querySelectorAll('button').forEach(function(button) { button.disabled = state; });
            if (!state) applyLocks();
        }
        function say(text, isError, target) {
            (target || message).textContent = text || '';
            (target || message).classList.toggle('is-error', !!isError);
        }
        function buildRow(light, index) {
            var row = { light: light };
            row.state = E('span', { 'class': 'ju-pill' });
            row.pick = select(colourPair(light) ? TWO : ONE, 'lights-pick-' + index, _('What %s does').format(light.title));
            row.node = E('div', { 'class': 'ju-row' }, [
                E('div', { 'class': 'ju-row-main' }, [E('strong', {}, light.title),
                    E('div', {}, [E('span', { 'class': 'ju-mono' }, light.leds.map(function(led) { return led.name; }).join(' · ')), ' ', row.state])]),
                E('div', { 'class': 'ju-actions' }, row.pick)
            ]);
            return row;
        }
        function showStatus(status, keepForm) {
            var sorted = sortLights(status.leds);
            var wanted = sorted.lights.map(function(light) { return light.leds.map(function(led) { return led.name; }).join('+'); }).join(' ');
            var off = status.lights === 'off';
            var held = sorted.lights.some(function(light) { return light.leds.some(function(led) { return led.mode !== 'on'; }); });
            var label = status.disco ? [_('Disco'), 'is-ok'] : off ? [_('Lights off'), 'is-warn'] : held ? [_('Customized'), 'is-ok'] : [_('Factory'), ''];
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
            if (status.disco) {
                discoLine.textContent = _('The disco is running: %s, %s, stops in about %s min. Press Stop disco to bring the lights back.').format(
                    nameOf(PATTERNS, status.disco.pattern), nameOf(SHOW_COLOURS, status.disco.colour).toLowerCase(), Math.ceil(status.disco.left / 60));
                if (!keepForm) {
                    setChoice(show.pattern, status.disco.pattern);
                    setChoice(show.speed, status.disco.speed);
                    setChoice(show.colour, status.disco.colour);
                }
            } else {
                discoLine.textContent = _('The disco is off. When it stops, the lights go back to how they were.');
            }
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
                if (!keepForm) setChoice(row.pick, choiceOf(light), _('Mixed (unchanged)'));
            });
            if (!busy) applyLocks();
        }
        function refresh(text, keepForm, target) {
            return command(['status']).then(function(status) {
                showStatus(status, keepForm);
                if (text) say(text, false, target);
            });
        }
        function run(args, pending, done, target) {
            if (busy) return Promise.resolve();
            busy = true;
            buttonsDisabled(true);
            say(pending, false, target);
            return command(args).then(done).catch(function(error) { say(error.message, true, target); }).finally(function() {
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
        var start_button = E('button', { type: 'button', 'class': 'ju-button ju-primary cbi-button-action' }, _('Start disco'));
        var stop_button = E('button', { type: 'button', 'class': 'ju-button ju-secondary cbi-button-neutral' }, _('Stop disco'));
        save_button.addEventListener('click', function() {
            var args = ['save'];
            rows.forEach(function(row) { pairsOf(row.light, row.pick.value).forEach(function(pair) { args.push(pair); }); });
            if (args.length === 1) return Promise.resolve();
            return run(args, _('Saving…'), function() { return refresh(_('Saved.')); });
        });
        restore_button.addEventListener('click', function() {
            return run(['restore'], _('Restoring…'), function() { return refresh(_('Factory light behavior restored.')); });
        });
        start_button.addEventListener('click', function() {
            return run(['disco', 'start', 'pattern=' + show.pattern.value, 'speed=' + show.speed.value, 'colour=' + show.colour.value,
                'minutes=' + show.minutes.value], _('Starting the disco…'), function() {
                return refresh(_('The disco has started.'), false, discoMessage);
            }, discoMessage);
        });
        stop_button.addEventListener('click', function() {
            return run(['disco', 'stop'], _('Stopping the disco…'), function() {
                return refresh(_('The disco has stopped and the lights are back.'), false, discoMessage);
            }, discoMessage);
        });

        function field(label, input) {
            return E('label', { 'class': 'ju-field' }, [E('span', {}, label), input]);
        }
        root.appendChild(E('link', { rel: 'stylesheet', href: L.resource('view/modem/junwrt-ui.css') }));
        root.appendChild(E('header', { 'class': 'ju-header' }, [
            E('div', {}, [E('h1', {}, _('Light Control')),
                E('p', { 'class': 'ju-help' }, _('Turn the front-panel lights off, pick their colour, or start a light show. Nothing changes until you press a button.'))]),
            pill]));
        root.appendChild(E('section', { 'class': 'ju-card' }, [
            E('div', { 'class': 'ju-card-head' }, [E('h2', {}, _('All lights')), master]),
            summary, notice
        ]));
        root.appendChild(E('section', { 'class': 'ju-card' }, [
            E('div', { 'class': 'ju-card-head' }, E('h2', {}, _('Single lights'))),
            E('p', { 'class': 'ju-help' }, _('Normal lets the router decide. Status, Signal, Wi-Fi and Phone have a red and a green LED, so they can show red, green or orange; 5G and Internet have one LED each. The LEDs only switch on and off: there is no dimming and there are no other colours.')),
            offNote, list, empty, extraNote,
            E('div', { 'class': 'ju-actions' }, [save_button, restore_button]),
            message
        ]));
        root.appendChild(E('section', { 'class': 'ju-card' }, [
            E('div', { 'class': 'ju-card-head' }, E('h2', {}, _('Disco'))),
            discoLine,
            E('div', { 'class': 'ju-form' }, [field(_('Pattern'), show.pattern), field(_('Speed'), show.speed),
                field(_('Colour'), show.colour), field(_('Stop after'), show.minutes)]),
            E('p', { 'class': 'ju-notice' }, _('Flashing lights. Do not use this if flashing light bothers you.')),
            E('div', { 'class': 'ju-actions' }, [start_button, stop_button]),
            discoMessage
        ]));
        root.appendChild(E('details', { 'class': 'ju-details' }, [E('summary', {}, _('How it works')),
            E('p', { 'class': 'ju-help' }, _('Turn all lights off uses the router\'s own lights switch, the one its lights button toggles, so it also holds after a reboot. A light you set to a colour or to off is held by a small service that checks every two seconds and puts it back when the router changes it, so a light can flash briefly. When a light goes back to Normal, the router redraws it, so its colour follows the router\'s current state. The disco is drawn by the same service, at no more than two or three flashes a second; it stops by itself after the time you choose, never survives a reboot, and Restore factory ends it. Lights can still glow while the router starts.'))]));

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
