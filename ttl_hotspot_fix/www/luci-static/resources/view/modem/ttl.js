'use strict';
'require view';
'require form';
'require uci';

function stylesheet() {
	return E('link', { 'rel': 'stylesheet', 'href': L.resource('view/modem/3ginfo-white.css') });
}

return view.extend({
	load: function() {
		return uci.load('3ginfo_ttl');
	},

	render: function() {
		var m, s, o;
		m = new form.Map('3ginfo_ttl', _('TTL / Hop Limit Configuration'), _('Apply the configured IPv4 TTL and a fixed IPv6 Hop Limit of 64 to client traffic forwarded from the LAN to the cellular WAN. LAN Router Advertisements stay unchanged at Hop Limit 255.'));

		s = m.section(form.NamedSection, 'main', 'main', _('Cellular WAN TTL Settings'));
		s.anonymous = true;

		o = s.option(form.Flag, 'enable', _('Enable TTL Modification'));
		o.default = '0';
		o.rmempty = false;
		o.description = _('Rewrite only client packets forwarded from br-lan to the active cellular WAN device. IPv4 uses the value below; IPv6 stays fixed at 64. Router-originated traffic and LAN Router Advertisements are not modified.');

		o = s.option(form.Value, 'ttl', _('IPv4 TTL Value'));
		o.datatype = 'range(1,255)';
		o.default = '64';
		o.placeholder = '64';
		o.rmempty = false;
		o.description = _('Set the IPv4 TTL (1–255). IPv6 Hop Limit remains fixed at 64 for the hotspot workaround.');

		s = m.section(form.NamedSection, 'main', 'main', _('Behavior Notes'));
		s.anonymous = true;

		o = s.option(form.DummyValue, '_warning');
		o.rawhtml = true;
		o.cfgvalue = function() {
			return E('div', { 'class': 'cbi-value-description' }, [
				E('div', { 'style': 'background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:12px 16px;color:#92400e;margin-top:6px;' }, [
					E('strong', {}, [_('Performance Notice: ')]),
					_('Rules match client-forwarded traffic from br-lan to the active cellular WAN. LAN Router Advertisements keep the required outer Hop Limit of 255. Hardware acceleration remains enabled. Save & Apply updates the rules.')
				])
			]);
		};

		return Promise.resolve(m.render()).then(function(node) {
			return E('div', { 'class': 'ginfo-page' }, [
				stylesheet(),
				node
			]);
		});
	}
});
