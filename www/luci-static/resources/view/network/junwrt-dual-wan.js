'use strict';
'require view';
'require rpc';
'require poll';
'require dom';

var netifd = rpc.declare({
    object: 'network.interface',
    method: 'dump',
    expect: { interface: [] },
    reject: true
});

var mwan3 = rpc.declare({
    object: 'mwan3',
    method: 'status',
    params: ['section'],
    expect: { interfaces: {} },
    reject: true
});

var LINKS = [
    { name: 'wan', title: _('Built-in cellular') },
    { name: 'wanb', title: _('Ethernet WAN') }
];

function unavailable() { return null; }

function status() {
    return Promise.all([netifd().catch(unavailable), mwan3('interfaces').catch(unavailable)]);
}

function linkState(interfaces, iface) {
    if (!interfaces) return [_('Status unavailable'), 'is-warn'];
    if (!iface) return [_('Not configured'), ''];
    if (iface.up === true) return [_('Link up'), 'is-ok'];
    if (iface.pending === true) return [_('Connecting'), 'is-warn'];
    return [_('Link down'), ''];
}

function healthState(tracked, iface) {
    if (!tracked) return [_('Checks unavailable'), ''];
    if (!iface || iface.enabled !== true || iface.running !== true)
        return [_('Checks inactive'), ''];
    if (iface.status === 'online') return [_('Internet check passed'), 'is-ok'];
    if (iface.status === 'offline') return [_('Internet check failed'), 'is-bad'];
    return [_('Checking internet'), 'is-warn'];
}

function pill(state) {
    return E('span', { 'class': 'ju-pill ' + state[1] }, state[0]);
}

function cards(data) {
    return LINKS.map(function(link) {
        var iface = data[0] && data[0].find(function(item) {
            return item.interface === link.name;
        });
        var tracker = data[1] && data[1][link.name];
        var device = iface && (iface.l3_device || iface.device);
        return E('section', { 'class': 'ju-card' }, [
            E('div', { 'class': 'ju-card-head' }, [
                E('h2', {}, link.title),
                pill(linkState(data[0], iface))
            ]),
            E('p', { 'class': 'ju-help' }, [link.name, device ? ' · ' + device : '']),
            pill(healthState(data[1], tracker))
        ]);
    });
}

return view.extend({
    load: status,
    render: function(data) {
        var links = E('div', {
            'class': 'ju-grid',
            style: 'grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr))'
        }, cards(data));
        poll.add(function() {
            return status().then(function(current) {
                dom.content(links, cards(current));
            });
        }, 10);
        return E('div', { 'class': 'jun-ui' }, [
            E('link', { rel: 'stylesheet', href: L.resource('view/modem/junwrt-ui.css') }),
            E('h1', {}, _('Dual WAN')),
            links
        ]);
    },
    handleSave: null,
    handleSaveApply: null,
    handleReset: null
});
