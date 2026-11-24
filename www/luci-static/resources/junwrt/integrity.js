'use strict';
'require baseclass';
'require fs';
'require poll';
'require ui';

var lastWarning;

function inspect() {
    return fs.exec('/usr/bin/junwrt-support', ['integrity']).then(function(result) {
        var state = JSON.parse(result.stdout || '{}').state;
        if (state === 'ok' || state === 'inactive') {
            lastWarning = null;
            return;
        }

        if (['key', 'manifest', 'signature', 'files', 'unavailable'].indexOf(state) < 0 ||
            state === lastWarning || document.body.classList.contains('modal-overlay-active'))
            return;

        lastWarning = state;
        ui.showModal(_('JunWRT installation could not be verified'), [
            E('p', {}, [_('This installation may have been modified or damaged. Stop using this copy and reinstall JunWRT with the official one-line installer.')]),
            E('p', {}, [_('A valid activation token cannot repair changed or missing files.')]),
            E('div', { 'class': 'right' }, [
                E('button', {
                    'class': 'btn',
                    'style': 'min-height:44px',
                    'click': function() { ui.hideModal(); }
                }, [_('Dismiss')]),
                ' ',
                E('a', {
                    'class': 'btn cbi-button cbi-button-action important',
                    'style': 'min-height:44px',
                    'href': L.url('admin/modem/support')
                }, [_('Open Support')])
            ])
        ]);
    }).catch(function() {
        // A disconnected browser or restricted account cannot determine installation integrity.
    });
}

return baseclass.extend({
    __init__: function() {
        inspect();
        poll.add(inspect, 30);
    }
});
