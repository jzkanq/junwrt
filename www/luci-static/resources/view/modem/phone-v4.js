'use strict';
'require view';
'require rpc';
'require poll';

var refreshPhone;
var phoneExec = rpc.declare({object:'file', method:'exec', params:['command','params'], nobatch:true});
function command(args) {
    return phoneExec('/usr/bin/junwrt-phone-ui', args).then(function(r) {
        var data = JSON.parse(r.stdout || '{}');
        if (Number(r.code) !== 0 || data.error) throw new Error(data.error || _('Phone command failed.'));
        return data;
    });
}
function stamp(value) { return value ? new Date(value * 1000).toLocaleString() : _('Not available'); }
function duration(value) { value = Math.max(0, Number(value) || 0); return Math.floor(value / 60) + ':' + ('0' + value % 60).slice(-2); }
function label(value) { return ({idle:_('Ready'), digits:_('Handset lifted'), ringing:_('Incoming call'), call:_('Call in progress'), busy:_('Call ended'), unavailable:_('Unavailable')})[value] || value; }
function callerLabel(number) { return number && number !== 'unknown' ? number : _('Unknown number'); }
return view.extend({
    load: function() { return command(['status']).catch(function(e) { return {online:false, calls:[], error:e.message}; }); },
    render: function(initial) {
        var data = initial, busy = false, sequence = 0;
        var number = E('input', {id:'jun-phone-number', type:'tel', inputmode:'tel', autocomplete:'off', maxlength:21, placeholder:_('Phone number'), 'aria-label':_('Phone number')});
        var notice = E('div', {'class':'jp-notice', role:'status', 'aria-live':'polite'});
        var state = E('span', {'class':'jp-state'}), connection = E('p', {'class':'jp-muted'});
        var current = E('div', {'class':'jp-current'}), latest = E('div', {'class':'jp-latest'});
        var list = E('div', {'class':'jp-history'});
        var filter = E('select', {'aria-label':_('Filter call history')}, [['all',_('All calls')],['incoming',_('Incoming')],['outgoing',_('Outgoing')],['missed',_('Missed')]].map(function(p) { return E('option',{value:p[0]},p[1]); }));
        var search = E('input', {type:'search', placeholder:_('Search number'), 'aria-label':_('Search call history')});
        var call = E('button', {'class':'jp-button jp-primary', click:function() { return act(['dial',number.value.trim()]); }}, _('Call'));
        var answer = E('button', {'class':'jp-button jp-primary', click:function() { return act(['answer']); }}, _('Answer'));
        var end = E('button', {'class':'jp-button jp-danger', click:function() { return act(['hangup']); }}, _('End call'));
        var ringAnswer = E('button', {'class':'jp-button jp-primary', click:function() { return act(['answer']); }}, _('Answer'));
        var decline = E('button', {'class':'jp-button jp-danger', click:function() { return act(['decline']); }}, _('Decline'));
        var ringNumber = E('strong', {'class':'jp-number', 'aria-live':'polite', 'aria-atomic':'true'});
        var ringHint = E('p', {'class':'jp-muted'});
        var ringNotice = E('p', {'class':'jp-notice', role:'status'});
        var incoming = E('section', {'class':'jp-card jp-incoming', 'aria-labelledby':'jp-incoming-title'}, [
            E('h3', {id:'jp-incoming-title'}, _('Incoming call')), ringNumber, ringHint,
            E('div', {'class':'jp-actions'}, [ringAnswer, decline]), ringNotice
        ]);
        var clearHistory = E('button', {'class':'jp-button jp-danger', click:function() {
            if (window.confirm(_('Clear all completed calls from this router?'))) return act(['clear-history']);
        }}, _('Clear log'));
        var keypadTab = E('button', {'class':'jp-button', 'aria-controls':'jp-keypad-panel', click:function() { selectPanel('keypad'); }}, _('Keypad'));
        var logTab = E('button', {'class':'jp-button', 'aria-controls':'jp-log-panel', click:function() { selectPanel('log'); }}, _('Call log'));
        function selectPanel(panel) {
            workspace.setAttribute('data-panel', panel);
            keypadTab.setAttribute('aria-pressed', panel === 'keypad');
            logTab.setAttribute('aria-pressed', panel === 'log');
        }
        function inform(message) { notice.textContent = ringNotice.textContent = message; }
        var statusNames = {completed:_('Completed'), missed:_('Missed'), unanswered:_('Unanswered')};
        function rows() {
            var calls = data.calls || [], chosen = filter.value || 'all', term = (search.value || '').trim();
            var shown = calls.filter(function(c) { return (chosen === 'all' || c.direction === chosen || c.result === chosen) && (!term || c.number.indexOf(term) >= 0); });
            list.replaceChildren.apply(list, shown.length ? shown.map(function(c) {
                var known = c.number && c.number !== 'unknown';
                return E('div', {'class':'jp-row'}, [
                    E('div', {}, [E('strong', {}, callerLabel(c.number)), E('div', {'class':'jp-muted'}, (c.direction === 'incoming' ? _('Incoming') : _('Outgoing')) + ' · ' + stamp(c.started))]),
                    E('div', {'class':'jp-row-end'}, [E('span', {'class': c.result === 'missed' ? 'jp-missed' : ''}, statusNames[c.result] || c.result), E('span', {'class':'jp-mono'}, duration(c.duration)), E('button', {'class':'jp-button', disabled:!known || busy, click:function() { selectPanel('keypad'); number.value = c.number; number.focus(); }}, _('Use number'))])
                ]);
            }) : [E('p', {'class':'jp-empty'}, calls.length ? _('No calls match this filter.') : _('No calls yet. History starts when the phone service is updated.'))]);
        }
        function paint(next) {
            data = next;
            state.textContent = data.online ? label(data.state) : _('Service offline');
            state.className = 'jp-state' + (data.online ? ' jp-online' : '');
            connection.textContent = data.hook === 'up' ? _('RJ11 handset lifted') : data.hook === 'down' ? _('RJ11 handset on hook') : _('Handset status unavailable');
            var latestCall = (data.calls || [])[0];
            latest.replaceChildren(latestCall ? E('div', {}, [E('strong', {'class':'jp-number'}, callerLabel(latestCall.number)), E('p', {'class':'jp-muted'}, stamp(latestCall.started)), E('span', {}, (statusNames[latestCall.result] || latestCall.result) + ' · ' + duration(latestCall.duration))]) : E('p', {'class':'jp-muted'}, _('Your latest completed call will appear here.')));
            var active = data.states !== '' && data.states != null;
            current.replaceChildren(E('strong', {'class':'jp-number'}, active ? callerLabel(data.number) : _('No active call')), E('p', {'class':'jp-muted'}, data.connected ? _('Connected') + ' · ' + duration(data.now-data.connected) : data.state === 'ringing' ? _('Lift the handset to answer.') : _('Audio uses your RJ11 phone, not the browser microphone.')));
            call.disabled = busy || !data.online || active || data.hook !== 'up';
            answer.disabled = busy || !data.online || data.state !== 'ringing' || data.hook !== 'up';
            end.disabled = busy || !data.online || !active;
            var ringing = data.online && data.state === 'ringing' && data.states === '4';
            incoming.hidden = !ringing;
            var name = callerLabel(data.number);
            if (ringNumber.textContent !== name) ringNumber.textContent = name;
            ringHint.textContent = data.hook === 'up' ? _('Audio uses the RJ11 handset.') : _('Lift the RJ11 handset to answer.');
            ringAnswer.disabled = answer.disabled;
            decline.disabled = busy || !ringing;
            clearHistory.disabled = busy || !data.online || !(data.calls || []).length;
            rows();
        }
        function refresh() {
            if (busy) return;
            var currentSequence = ++sequence;
            return command(['status']).then(function(next) {
                if (currentSequence === sequence) paint(next);
            }).catch(function(e) {
                if (currentSequence !== sequence) return;
                inform(e.message);
                paint(Object.assign({}, data, {online:false}));
            });
        }
        function act(args) {
            if (busy) return;
            ++sequence;busy = true;inform(_('Working…'));paint(data);
            return command(args).then(function() { inform(_('Action completed.')); }).catch(function(e) { inform(e.message); }).then(function() { busy = false; return refresh(); });
        }
        filter.addEventListener('change',rows);search.addEventListener('input',rows);
        var letters = {'2':'ABC','3':'DEF','4':'GHI','5':'JKL','6':'MNO','7':'PQRS','8':'TUV','9':'WXYZ'};
        var keys = E('div', {'class':'jp-keypad'}, ['1','2','3','4','5','6','7','8','9','+','0'].map(function(key) { return E('button', {'class':'jp-key', click:function() { if (number.value.length < 21) number.value += key; }},[E('span', {'class':'jp-digit'}, key),E('span', {'class':'jp-letters','aria-hidden':'true'}, letters[key] || '\u00a0')]); }));
        keys.appendChild(E('button', {'class':'jp-key', 'aria-label':_('Delete last digit'), click:function() { number.value = number.value.slice(0,-1); }}, _('Delete')));
        var workspace = E('div', {'class':'jp-workspace'}, [
            E('section', {id:'jp-keypad-panel', 'class':'jp-card jp-dial'}, [E('h3', {}, _('Make a call')),connection,number,keys,call,E('p', {'class':'jp-muted'}, _('Lift your phone, enter a number, then press Call. In-call keypad tones are not supported.'))]),
            E('div', {'class':'jp-details'}, [
                E('section', {'class':'jp-card'}, [E('h3', {}, _('Current call')),current,E('div', {'class':'jp-actions'}, [answer,end])]),
                E('section', {'class':'jp-card'}, [E('h3', {}, _('Latest call')),latest]),
                E('section', {id:'jp-log-panel', 'class':'jp-card'}, [
                    E('div', {'class':'jp-history-heading'}, [E('h3', {}, _('Call history')),clearHistory,E('div', {'class':'jp-filters'}, [filter,search])]),
                    list,E('p', {'class':'jp-muted'}, _('Last 100 calls are stored on this router. Times follow your browser timezone.'))
                ])
            ])
        ]);
        var page = E('div', {'class':'jp-page'}, [
            E('link', {rel:'stylesheet', href:L.resource('view/modem/phone-v3.css')}),
            E('header', {'class':'jp-heading'}, [E('h2', {}, _('Phone')),state]),
            notice,E('div', {'class':'jp-panel-switch'}, [keypadTab,logTab]),workspace,incoming
        ]);
        selectPanel('keypad');
        paint(data);if (initial.error) notice.textContent = initial.error;
        if (refreshPhone) poll.remove(refreshPhone);
        var mounted = false;
        refreshPhone = function() {
            if (!page.isConnected) { if (mounted) poll.remove(refreshPhone); return; }
            mounted = true;
            return refresh();
        };
        poll.add(refreshPhone,2);
        return page;
    },
    handleSaveApply:null, handleSave:null, handleReset:null
});
