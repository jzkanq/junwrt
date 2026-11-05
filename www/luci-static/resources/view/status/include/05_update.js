'use strict';
'require baseclass';
'require fs';

// Overview banner: stays hidden until a check finds a newer build, then offers it with one tap.
return baseclass.extend({
    title: '',
    shown: '',
    readAt: 0,
    status: null,

    load: function() {
        var self = this;
        // Overview polls every include every few seconds; this status changes about once a day.
        if (Date.now() - this.readAt < 60000) return Promise.resolve(this.status);
        this.readAt = Date.now();
        return fs.exec('/usr/bin/junwrt-update', ['status']).then(function(result) {
            self.status = JSON.parse(result.stdout);
            return self.status;
        }).catch(function() {
            self.status = null;
            return null;
        });
    },

    render: function(status) {
        var running = status && status.state === 'running';
        var failed = status && status.state === 'failed' ? status.message : '';
        var key = running ? 'running' : status && status.available && status.latest ? status.latest.epoch + ' ' + failed : '';
        var page = L.url('admin/modem/update');
        // Null keeps what is on screen: returning a node every poll would reload the stylesheet each time.
        if (!key || key === this.shown) return null;
        this.shown = key;

        var title = E('h3');
        var detail = E('p', { 'class': 'ju-help' });
        var message = E('p', { 'class': 'ju-message', role: 'status', 'aria-live': 'polite' });
        var actions = E('div', { 'class': 'ju-actions' });

        title.textContent = running ? _('A JunWRT update is running') : _('JunWRT update available');
        // Text from the manifest goes through textContent, never into HTML.
        detail.textContent = running ? _('Wi-Fi and internet can drop for a minute.')
            : status.incomplete ? _('The last update did not finish. Tap Update now to finish it.')
            : (status.latest.notes || _('Build from %s').format(status.latest.built));
        if (failed) {
            message.textContent = failed;
            message.classList.add('is-error');
        }

        if (running) {
            actions.appendChild(E('a', { 'class': 'ju-button ju-secondary cbi-button-neutral', href: page }, _('See progress')));
        }
        else {
            var update = E('button', { type: 'button', 'class': 'ju-button ju-primary cbi-button-action' }, _('Update now'));
            update.addEventListener('click', function() {
                update.disabled = true;
                message.textContent = _('Starting the update…');
                message.classList.remove('is-error');
                return fs.exec('/usr/bin/junwrt-update', ['install']).then(function(result) {
                    var data = JSON.parse(result.stdout);
                    if (Number(result.code) !== 0 || data.error) throw new Error(data.error);
                    location.href = page;
                }).catch(function(error) {
                    update.disabled = false;
                    message.textContent = error.message || _('The update could not start.');
                    message.classList.add('is-error');
                });
            });
            actions.appendChild(update);
            actions.appendChild(E('a', { 'class': 'ju-button ju-secondary cbi-button-neutral', href: page }, _('Details')));
        }

        return E('div', { 'class': 'jun-ui jun-update-banner' }, [
            E('link', { rel: 'stylesheet', href: L.resource('view/modem/junwrt-ui.css') }),
            E('section', { 'class': 'ju-card' }, [
                E('div', { 'class': 'ju-row' }, [E('div', { 'class': 'ju-row-main' }, [title, detail, message]), actions])
            ])
        ]);
    }
});
