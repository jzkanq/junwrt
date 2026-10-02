'use strict';
'require view';
'require fs';
'require poll';
'require ui';

var refreshPoll;
var levels = {
    child: _('Child · suggested age 6–12'),
    teen: _('Teen · suggested age 13–17'),
    none: _('No content filter · time control only')
};
var descriptions = {
    child: _('CleanBrowsing Family: blocks adult and mixed adult sites, known proxy/VPN domains and security threats; enables supported safe search. Games and social apps are not generally blocked.'),
    teen: _('CleanBrowsing Adult: blocks adult sites and security threats. Mixed-content sites, games and social apps remain available.'),
    none: _('No DNS content filtering. The internet schedule still applies when enabled.')
};
function command(args) {
    return fs.exec('/usr/bin/junwrt-parental', args).then(function(result) {
        var data;
        try { data = JSON.parse(result.stdout || '{}'); }
        catch (e) { throw new Error(_('Invalid response from parental control service.')); }
        if (Number(result.code) !== 0 || data.error)
            throw new Error(data.error || result.stderr || _('Parental control command failed.'));
        // Lua's JSON encoder may serialize an empty list as an empty object.
        if (args[0] === 'status') {
            data.profiles = Array.isArray(data.profiles) ? data.profiles : [];
            data.devices = Array.isArray(data.devices) ? data.devices : [];
        }
        return data;
    });
}
function field(label, input, help) {
    return E('label', { 'class': 'pc-field' }, [E('span', {}, label), input,
        help ? E('small', {}, help) : '']);
}
function select(options, selected) {
    return E('select', {}, Object.keys(options).map(function(key) {
        return E('option', { value: key, selected: key === selected ? 'selected' : null }, options[key]);
    }));
}
return view.extend({
    load: function() { return command(['status']); },
    render: function(data) {
        var root = E('div', { 'class': 'jun-parental-page' });
        var summary = E('p', { 'class': 'pc-help', role: 'status', 'aria-live': 'polite' });
        var warning = E('p', { 'class': 'pc-warning' });
        var list = E('div', { 'class': 'pc-list' });
        var editor = E('section', { 'class': 'pc-card' });
        var message = E('p', { role: 'status', 'aria-live': 'polite', 'class': 'pc-message' });
        var busy = false;
        var current = data;
        var selectedId = null;
        var search = E('input', { type: 'search', placeholder: _('Find a device or MAC address'), 'aria-label': _('Find a managed device') });

        function updateStatus(value) {
            current = value;
            summary.textContent = _('Router time: %s · %s').format(value.router_time,
                value.applied ? _('Rules applied') : _('Waiting for service to apply rules'));
            var notices = [];
            if (!value.clock_ok) notices.push(_('Router clock is not ready. Scheduled devices stay blocked until the clock is valid.'));
            if (value.hardware_offload) notices.push(_('Hardware NAT is loaded. Verify that existing downloads stop at the schedule boundary on this router; accelerated traffic may bypass firewall controls.'));
            if (value.enforcement_error) notices.push(value.enforcement_error);
            warning.textContent = notices.join(' ');
            warning.hidden = !notices.length;
            drawList();
        }
        function action(args, done) {
            if (busy) return;
            busy = true;
            root.querySelectorAll('button').forEach(function(button) { button.disabled = true; });
            message.textContent = _('Saving…');
            message.classList.remove('is-error');
            return command(args).then(function() {
                message.textContent = _('Saved. Rules update within 5 seconds.');
                if (done) done();
                return command(['status']).then(updateStatus);
            }).catch(function(error) {
                message.textContent = error.message;
                message.classList.add('is-error');
            }).finally(function() {
                busy = false;
                root.querySelectorAll('button').forEach(function(button) { button.disabled = false; });
            });
        }
        function drawList() {
            list.replaceChildren();
            var query = search.value.trim().toLowerCase();
            var profiles = (current.profiles || []).filter(function(p) {
                return (p.name + ' ' + p.mac).toLowerCase().indexOf(query) !== -1;
            });
            if (!profiles.length) {
                list.appendChild(E('p', { 'class': 'pc-help' }, query ? _('No matching devices.') : _('No managed devices yet. Add a device below.')));
                return;
            }
            profiles.forEach(function(p) {
                var device = (current.devices || []).find(function(d) { return d.mac === p.mac; });
                var state = p.enabled !== '1' ? _('Control disabled') : !current.applied ? _('Pending apply') : p.allowed ? _('Internet allowed') : _('Internet blocked');
                var edit = E('button', { type: 'button', 'class': 'pc-button pc-secondary', disabled: busy ? 'disabled' : null }, _('Edit'));
                edit.addEventListener('click', function() { showEditor(p); editor.scrollIntoView({ block: 'nearest' }); });
                var remove = E('button', { type: 'button', 'class': 'pc-button pc-danger', disabled: busy ? 'disabled' : null }, _('Remove'));
                remove.addEventListener('click', function() {
                    ui.showModal(_('Remove device control?'), [
                        E('p', {}, _('Remove the internet schedule and content filter for %s?').format(p.name)),
                        E('div', { 'class': 'pc-actions' }, [
                            E('button', { 'class': 'pc-button pc-secondary', click: ui.hideModal }, _('Cancel')),
                            E('button', { 'class': 'pc-button pc-danger', click: function() {
                                ui.hideModal();
                                action(['delete', p.id], function() { if (selectedId === p.id) showEditor(); });
                            } }, _('Remove'))
                        ])
                    ]);
                });
                list.appendChild(E('article', { 'class': 'pc-device' }, [
                    E('div', {}, [E('h3', {}, p.name), E('p', { 'class': 'pc-mac' }, p.mac + (device ? ' · ' + device.ip : '')),
                        E('p', { 'class': 'pc-help' }, levels[p.level]),
                        E('p', { 'class': 'pc-help' }, p.schedule === '1' ?
                            _('Allowed %s–%s · %s').format(p.start, p.finish, p.days.split('').map(function(d) { return [_('Sun'), _('Mon'), _('Tue'), _('Wed'), _('Thu'), _('Fri'), _('Sat')][Number(d)]; }).join(', ')) : _('All-day access'))]),
                    E('div', { 'class': 'pc-device-actions' }, [E('span', { 'class': 'pc-state' }, state), E('div', { 'class': 'pc-actions' }, [edit, remove])])
                ]));
            });
        }
        function showEditor(profile) {
            var p = profile || { name: '', mac: '', enabled: '1', level: 'child', schedule: '1', days: '0123456', start: '08:00', finish: '20:00' };
            selectedId = profile ? profile.id : null;
            editor.replaceChildren();
            var name = E('input', { type: 'text', value: p.name, maxlength: '64', required: 'required' });
            var mac = E('input', { type: 'text', value: p.mac, placeholder: 'AA:BB:CC:DD:EE:FF', required: 'required', readonly: profile ? 'readonly' : null });
            var choices = { '': _('Select a DHCP device or enter a MAC below') };
            (current.devices || []).forEach(function(d) { choices[d.mac] = d.name + ' · ' + d.ip + ' · ' + d.mac; });
            var devices = select(choices, '');
            devices.addEventListener('change', function() {
                var d = (current.devices || []).find(function(item) { return item.mac === devices.value; });
                if (d) { mac.value = d.mac; name.value = d.name; }
            });
            var enabled = E('input', { type: 'checkbox', checked: p.enabled === '1' ? 'checked' : null });
            var level = select(levels, p.level);
            var levelHelp = E('p', { 'class': 'pc-help' }, descriptions[p.level]);
            level.addEventListener('change', function() { levelHelp.textContent = descriptions[level.value]; });
            var schedule = E('input', { type: 'checkbox', checked: p.schedule === '1' ? 'checked' : null });
            var start = E('input', { type: 'time', value: p.start, required: 'required' });
            var finish = E('input', { type: 'time', value: p.finish, required: 'required' });
            var days = [_('Sun'), _('Mon'), _('Tue'), _('Wed'), _('Thu'), _('Fri'), _('Sat')].map(function(label, i) {
                var box = E('input', { type: 'checkbox', value: String(i), checked: p.days.indexOf(String(i)) !== -1 ? 'checked' : null });
                return { box: box, label: E('label', { 'class': 'pc-day' }, [box, label]) };
            });
            var timing = E('div', {}, [E('div', { 'class': 'pc-days' }, days.map(function(d) { return d.label; })),
                E('div', { 'class': 'pc-grid' }, [field(_('Internet available from'), start), field(_('Internet available until'), finish)])]);
            function toggleTime() {
                timing.querySelectorAll('input').forEach(function(input) { input.disabled = !schedule.checked; });
            }
            schedule.addEventListener('change', toggleTime);
            toggleTime();
            var save = E('button', { type: 'submit', 'class': 'pc-button pc-primary' }, _('Save device'));
            var form = E('form', {}, [
                E('h3', {}, _('Basic info')),
                profile ? '' : field(_('Device on this router'), devices),
                E('div', { 'class': 'pc-grid' }, [field(_('Device / child name'), name), field(_('Device MAC address'), mac)]),
                E('label', { 'class': 'pc-check' }, [enabled, _('Enable control for this device')]),
                E('h3', {}, _('Filter level')), field(_('Age / protection level'), level), levelHelp,
                E('h3', {}, _('Time control')),
                E('label', { 'class': 'pc-check' }, [schedule, _('Allow internet only during this schedule')]), timing,
                E('p', { 'class': 'pc-help' }, _('Outside the selected window, Wi-Fi stays connected but internet forwarding is blocked. Times use the router clock. For overnight windows, select the day the window starts.')),
                E('div', { 'class': 'pc-actions' }, [save,
                    E('button', { type: 'button', 'class': 'pc-button pc-secondary', click: function() { showEditor(); } }, _('New device'))])
            ]);
            form.addEventListener('submit', function(event) {
                event.preventDefault();
                var selectedDays = days.filter(function(d) { return d.box.checked; }).map(function(d) { return d.box.value; }).join('');
                if (!schedule.checked) {
                    selectedDays = selectedDays || '0123456';
                    if (!start.value || !finish.value || start.value === finish.value) {
                        start.value = '08:00'; finish.value = '20:00';
                    }
                }
                if (!selectedDays || start.value === finish.value) {
                    message.textContent = _('Select at least one day and different start/end times. For all-day access, turn off the schedule.');
                    message.classList.add('is-error');
                    return;
                }
                action(['save', JSON.stringify({ name: name.value.trim(), mac: mac.value.trim(), enabled: enabled.checked ? '1' : '0',
                    level: level.value, schedule: schedule.checked ? '1' : '0', days: selectedDays, start: start.value, finish: finish.value })]);
            });
            editor.appendChild(E('h2', {}, profile ? _('Edit device') : _('Add a device')));
            editor.appendChild(form);
        }
        search.addEventListener('input', drawList);
        root.appendChild(E('link', { rel: 'stylesheet', href: L.resource('view/modem/parental-control.css') }));
        root.appendChild(E('header', {}, [E('h1', {}, _('Parental Control')),
            E('p', { 'class': 'pc-help' }, _('Manage which device your child uses, its content filter and when it can access the internet.')), summary, warning]));
        root.appendChild(E('section', { 'class': 'pc-card' }, [E('h2', {}, _('Managed devices')), search, list]));
        root.appendChild(editor);
        root.appendChild(message);
        root.appendChild(E('p', { 'class': 'pc-help' }, _('Use a stable MAC address for this Wi-Fi network. A changed/random MAC, mobile data, VPN or HTTPS private DNS can bypass these controls. Filtering forces plain IPv4 DNS to CleanBrowsing, blocks port 853 and disables forwarded IPv6 for filtered devices. It does not control individual apps or daily usage quotas.')));
        updateStatus(data);
        showEditor();
        if (refreshPoll) poll.remove(refreshPoll);
        refreshPoll = function() {
            if (busy || !root.isConnected) return Promise.resolve();
            return command(['status']).then(updateStatus).catch(function(error) {
                summary.textContent = _('Status unavailable: %s').format(error.message);
            });
        };
        poll.add(refreshPoll, 5);
        return root;
    },
    handleSaveApply: null,
    handleSave: null,
    handleReset: null
});
