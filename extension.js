import GObject from 'gi://GObject';
import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import { Extension, gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

const SPARKLINE_WIDTH = 280;
const SPARKLINE_HEIGHT = 30;
const HISTORY_SIZE = 30;
const NOTIFY_COOLDOWN_MS = 5 * 60 * 1000;

function parseHosts(str) {
    return str.split(',')
        .map(h => h.trim())
        .filter(h => h.length > 0);
}

class HostMetrics {
    constructor() {
        this.rtt = null;
        this.jitter = null;
        this.packetLoss = null;
        this.downloadSpeed = null;
        this.history = [];
    }

    pushRtt(value) {
        this.history.push(value);
        if (this.history.length > HISTORY_SIZE)
            this.history.shift();
    }
}

function colorClass(prefix, value, good, warn) {
    if (value === null) return '';
    if (value <= good) return `${prefix}-good`;
    if (value <= warn) return `${prefix}-warn`;
    return `${prefix}-bad`;
}

const PingBarIndicator = GObject.registerClass(
class PingBarIndicator extends PanelMenu.Button {
    _init(extension) {
        super._init(0.0, 'PingBar');

        this._extension = extension;
        this._settings = extension.getSettings();
        this._timeoutId = null;
        this._updateCount = 0;
        this._hostMetrics = new Map();
        this._lastNotifyTime = 0;

        // Top bar: box layout with individual metric labels
        this._box = new St.BoxLayout({ style_class: 'speed-net-box' });
        this.add_child(this._box);

        this._speedLabel = new St.Label({ text: '', y_align: Clutter.ActorAlign.CENTER, style_class: 'speed-label' });
        this._speedSep = new St.Label({ text: '', y_align: Clutter.ActorAlign.CENTER, style_class: 'speed-net-sep' });
        this._rttLabel = new St.Label({ text: '...', y_align: Clutter.ActorAlign.CENTER, style_class: 'speed-net-label' });
        this._rttSep = new St.Label({ text: '', y_align: Clutter.ActorAlign.CENTER, style_class: 'speed-net-sep' });
        this._jitterLabel = new St.Label({ text: '', y_align: Clutter.ActorAlign.CENTER, style_class: 'speed-net-label' });
        this._jitterSep = new St.Label({ text: '', y_align: Clutter.ActorAlign.CENTER, style_class: 'speed-net-sep' });
        this._lossLabel = new St.Label({ text: '', y_align: Clutter.ActorAlign.CENTER, style_class: 'speed-net-label' });

        this._box.add_child(this._speedLabel);
        this._box.add_child(this._speedSep);
        this._box.add_child(this._rttLabel);
        this._box.add_child(this._rttSep);
        this._box.add_child(this._jitterLabel);
        this._box.add_child(this._jitterSep);
        this._box.add_child(this._lossLabel);

        // Popup menu
        this._buildMenu();

        // Start polling
        this._update();
        this._startTimer();

        // React to settings changes
        this._settingsChangedId = this._settings.connect('changed', () => {
            this._stopTimer();
            this._rebuildMenu();
            this._update();
            this._startTimer();
        });
    }

    _rebuildMenu() {
        this.menu.removeAll();
        this._menuContent = null;
        this._buildMenu();
    }

    _buildMenu() {
        this._menuContent = [];
        this._hostMenuItems = new Map();

        const hosts = parseHosts(this._settings.get_string('target-host'));
        const showSparkline = this._settings.get_boolean('show-sparkline');

        for (const host of hosts) {
            if (!this._hostMetrics.has(host))
                this._hostMetrics.set(host, new HostMetrics());

            const headerItem = new PopupMenu.PopupMenuItem('', { reactive: false });
            const headerLabel = new St.Label({
                text: `── ${host} ──`,
                style_class: 'speed-net-host-header',
            });
            headerItem.add_child(headerLabel);
            this.menu.addMenuItem(headerItem);
            this._menuContent.push(headerItem);

            const items = {};
            const metricDefs = [
                { key: 'rtt', label: 'RTT', icon: '⏱' },
                { key: 'jitter', label: 'Jitter', icon: '〰' },
                { key: 'packetLoss', label: 'Packet Loss', icon: '📉' },
                { key: 'downloadSpeed', label: 'Download', icon: '⬇' },
            ];

            for (const m of metricDefs) {
                const item = new PopupMenu.PopupMenuItem('', { reactive: false });
                const label = new St.Label({
                    text: `${m.icon}  ${m.label}: ...`,
                    style_class: 'speed-net-menu-item',
                });
                item.add_child(label);
                this.menu.addMenuItem(item);
                this._menuContent.push(item);
                items[m.key] = label;
            }

            this._hostMenuItems.set(host, items);

            if (showSparkline) {
                const sparkItem = new PopupMenu.PopupMenuItem('', { reactive: false });
                this._drawingAreas = this._drawingAreas || new Map();
                this._drawingAreas.set(host, this._makeSparkline(host, sparkItem));
                this.menu.addMenuItem(sparkItem);
                this._menuContent.push(sparkItem);
            }
        }

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const settingsItem = new PopupMenu.PopupMenuItem('⚙  Settings');
        settingsItem.connect('activate', () => {
            this._extension.openPreferences();
        });
        this.menu.addMenuItem(settingsItem);
    }

    _makeSparkline(host, parentItem) {
        const area = new St.DrawingArea({
            width: SPARKLINE_WIDTH,
            height: SPARKLINE_HEIGHT,
            style_class: 'speed-net-sparkline',
        });

        area.connect('repaint', () => {
            const cr = area.get_context();
            const [w, h] = area.get_surface_size();
            const metrics = this._hostMetrics.get(host);
            const data = metrics ? metrics.history : [];

            cr.setSourceRGBA(0.3, 0.3, 0.3, 1);
            cr.rectangle(0, 0, w, h);
            cr.fill();

            if (data.length < 2) {
                cr.setSourceRGBA(0.5, 0.5, 0.5, 1);
                cr.moveTo(0, h / 2);
                cr.lineTo(w, h / 2);
                cr.stroke();
                return;
            }

            const min = Math.min(...data);
            const max = Math.max(...data);
            const range = max - min || 1;
            const stepX = w / (data.length - 1);

            const good = this._settings.get_int('rtt-threshold-good');
            const warn = this._settings.get_int('rtt-threshold-warn');
            const latest = data[data.length - 1];
            let r = 0.3, g = 0.7, b = 1;
            if (latest <= good) {
                r = 0.3; g = 0.8; b = 0.3;
            } else if (latest <= warn) {
                r = 1; g = 0.8; b = 0.2;
            } else {
                r = 0.9; g = 0.2; b = 0.2;
            }

            cr.setLineWidth(1.5);
            cr.setSourceRGBA(r, g, b, 1);
            cr.moveTo(0, h - ((data[0] - min) / range) * (h - 2) - 1);

            for (let i = 1; i < data.length; i++) {
                const y = h - ((data[i] - min) / range) * (h - 2) - 1;
                cr.lineTo(i * stepX, y);
            }
            cr.stroke();
        });

        parentItem.add_child(area);
        return area;
    }

    _startTimer() {
        const interval = this._settings.get_int('update-interval');
        this._timeoutId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            interval,
            () => {
                this._update();
                return GLib.SOURCE_CONTINUE;
            }
        );
    }

    _stopTimer() {
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = null;
        }
    }

    _update() {
        const hosts = parseHosts(this._settings.get_string('target-host'));
        const pingCount = this._settings.get_int('ping-count');
        const speedUrl = this._settings.get_string('speed-test-url');
        const showSpeed = this._settings.get_boolean('show-download-speed');
        this._updateCount++;

        for (const host of hosts) {
            const metrics = this._hostMetrics.get(host);
            if (!metrics) continue;

            this._runPingAsync(host, pingCount, metrics);

            if (showSpeed && this._updateCount % 6 === 1) {
                this._runSpeedTestAsync(host, speedUrl, metrics);
            }
        }
    }

    _runPingAsync(host, count, metrics) {
        try {
            const proc = Gio.Subprocess.new(
                ['ping', '-c', String(count), '-q', host],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
            );

            proc.communicate_utf8_async(null, null, (source, res) => {
                try {
                    const [, stdout] = source.communicate_utf8_finish(res);
                    this._parsePingOutput(stdout, metrics);
                } catch (e) {
                    log(`PingBar: ping failed for ${host}: ${e.message}`);
                    metrics.rtt = null;
                    metrics.jitter = null;
                    metrics.packetLoss = null;
                }
                this._updateLabels();
            });
        } catch (e) {
            log(`PingBar: failed to spawn ping for ${host}: ${e.message}`);
        }
    }

    _parsePingOutput(text, metrics) {
        const lossMatch = text.match(/(\d+(?:\.\d+)?)%\s+packet loss/);
        if (lossMatch) {
            metrics.packetLoss = parseFloat(lossMatch[1]);
        }

        const rttMatch = text.match(/rtt min\/avg\/max\/mdev\s*=\s*[\d.]+\/([\d.]+)\/[\d.]+\/([\d.]+)\s*ms/);
        if (rttMatch) {
            const rtt = parseFloat(rttMatch[1]);
            metrics.rtt = rtt;
            metrics.jitter = parseFloat(rttMatch[2]);
            metrics.pushRtt(rtt);
        }
    }

    _runSpeedTestAsync(host, customUrl, metrics) {
        const url = customUrl && customUrl.trim()
            ? customUrl
            : `http://${host}/`;

        try {
            const proc = Gio.Subprocess.new(
                ['curl', '-o', '/dev/null', '-s', '-w', '%{speed_download}',
                 '--max-time', '5', url],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
            );

            proc.communicate_utf8_async(null, null, (source, res) => {
                try {
                    const [, stdout] = source.communicate_utf8_finish(res);
                    const bytesPerSec = parseFloat(stdout.trim());
                    if (!isNaN(bytesPerSec) && bytesPerSec > 0) {
                        metrics.downloadSpeed = (bytesPerSec * 8) / 1_000_000;
                    } else {
                        metrics.downloadSpeed = null;
                    }
                } catch (e) {
                    log(`PingBar: speed test failed for ${host}: ${e.message}`);
                    metrics.downloadSpeed = null;
                }
                this._updateLabels();
            });
        } catch (e) {
            log(`PingBar: failed to spawn curl for ${host}: ${e.message}`);
        }
    }

    _updateLabels() {
        const hosts = parseHosts(this._settings.get_string('target-host'));
        const showRtt = this._settings.get_boolean('show-rtt');
        const showJitter = this._settings.get_boolean('show-jitter');
        const showLoss = this._settings.get_boolean('show-packet-loss');
        const showSpeed = this._settings.get_boolean('show-download-speed');
        const colorEnabled = this._settings.get_boolean('enable-color-coding');
        const rttGood = this._settings.get_int('rtt-threshold-good');
        const rttWarn = this._settings.get_int('rtt-threshold-warn');
        const jitterGood = this._settings.get_int('jitter-threshold-good');
        const jitterWarn = this._settings.get_int('jitter-threshold-warn');
        const lossGood = this._settings.get_int('loss-threshold-good');
        const lossWarn = this._settings.get_int('loss-threshold-warn');
        const notify = this._settings.get_boolean('notify-on-spike');
        const rttSpike = this._settings.get_int('rtt-spike-threshold');
        const lossThresh = this._settings.get_int('loss-threshold');

        const primaryHost = hosts[0];
        const m = primaryHost ? this._hostMetrics.get(primaryHost) : null;

        // Update each metric label
        if (m) {
            // Download speed
            if (showSpeed && m.downloadSpeed !== null) {
                const speed = m.downloadSpeed;
                this._speedLabel.set_text(`↓ ${speed >= 1 ? speed.toFixed(1) : speed.toFixed(2)} Mbps`);
                this._speedLabel.show();
                this._speedSep.set_text('│');
                this._speedSep.show();
            } else if (showSpeed) {
                this._speedLabel.set_text('↓ ...');
                this._speedLabel.show();
                this._speedSep.set_text('│');
                this._speedSep.show();
            } else {
                this._speedLabel.set_text('');
                this._speedLabel.hide();
                this._speedSep.set_text('');
                this._speedSep.hide();
            }

            // RTT
            if (showRtt && m.rtt !== null) {
                this._rttLabel.set_text(`${m.rtt.toFixed(1)}ms`);
                this._rttLabel.remove_style_class_name('rtt-good');
                this._rttLabel.remove_style_class_name('rtt-warn');
                this._rttLabel.remove_style_class_name('rtt-bad');
                if (colorEnabled) {
                    const cls = colorClass('rtt', m.rtt, rttGood, rttWarn);
                    if (cls) this._rttLabel.add_style_class_name(cls);
                }
                this._rttLabel.show();
                this._rttSep.set_text('│');
                this._rttSep.show();
            } else if (showRtt) {
                this._rttLabel.set_text('...ms');
                this._rttLabel.remove_style_class_name('rtt-good');
                this._rttLabel.remove_style_class_name('rtt-warn');
                this._rttLabel.remove_style_class_name('rtt-bad');
                this._rttLabel.show();
                this._rttSep.set_text('│');
                this._rttSep.show();
            } else {
                this._rttLabel.set_text('');
                this._rttLabel.hide();
                this._rttSep.set_text('');
                this._rttSep.hide();
            }

            // Jitter
            if (showJitter && m.jitter !== null) {
                this._jitterLabel.set_text(`±${m.jitter.toFixed(1)}ms`);
                this._jitterLabel.remove_style_class_name('jitter-good');
                this._jitterLabel.remove_style_class_name('jitter-warn');
                this._jitterLabel.remove_style_class_name('jitter-bad');
                if (colorEnabled) {
                    const cls = colorClass('jitter', m.jitter, jitterGood, jitterWarn);
                    if (cls) this._jitterLabel.add_style_class_name(cls);
                }
                this._jitterLabel.show();
                this._jitterSep.set_text('│');
                this._jitterSep.show();
            } else if (showJitter) {
                this._jitterLabel.set_text('±...ms');
                this._jitterLabel.remove_style_class_name('jitter-good');
                this._jitterLabel.remove_style_class_name('jitter-warn');
                this._jitterLabel.remove_style_class_name('jitter-bad');
                this._jitterLabel.show();
                this._jitterSep.set_text('│');
                this._jitterSep.show();
            } else {
                this._jitterLabel.set_text('');
                this._jitterLabel.hide();
                this._jitterSep.set_text('');
                this._jitterSep.hide();
            }

            // Packet Loss
            if (showLoss && m.packetLoss !== null) {
                this._lossLabel.set_text(`${m.packetLoss.toFixed(0)}%`);
                this._lossLabel.remove_style_class_name('loss-good');
                this._lossLabel.remove_style_class_name('loss-warn');
                this._lossLabel.remove_style_class_name('loss-bad');
                if (colorEnabled) {
                    const cls = colorClass('loss', m.packetLoss, lossGood, lossWarn);
                    if (cls) this._lossLabel.add_style_class_name(cls);
                }
                this._lossLabel.show();
            } else if (showLoss) {
                this._lossLabel.set_text('...%');
                this._lossLabel.remove_style_class_name('loss-good');
                this._lossLabel.remove_style_class_name('loss-warn');
                this._lossLabel.remove_style_class_name('loss-bad');
                this._lossLabel.show();
            } else {
                this._lossLabel.set_text('');
                this._lossLabel.hide();
            }

            // Tooltip
            const lines = [];
            hosts.forEach(h => {
                const hm = this._hostMetrics.get(h);
                if (!hm) return;
                lines.push(`${h}:`);
                if (hm.rtt !== null) lines.push(`  RTT: ${hm.rtt.toFixed(2)}ms`);
                if (hm.jitter !== null) lines.push(`  Jitter: ${hm.jitter.toFixed(2)}ms`);
                if (hm.packetLoss !== null) lines.push(`  Loss: ${hm.packetLoss.toFixed(1)}%`);
                if (hm.downloadSpeed !== null) lines.push(`  Down: ${hm.downloadSpeed.toFixed(2)} Mbps`);
            });
            this._rttLabel.tooltip_text = lines.join('\n');

            if (notify) {
                this._checkNotification(m, primaryHost, rttSpike, lossThresh);
            }
        }

        // Update dropdown items
        for (const [host, items] of this._hostMenuItems) {
            const hm = this._hostMetrics.get(host);
            if (!hm) continue;

            if (showSpeed) {
                items.downloadSpeed.set_text(
                    hm.downloadSpeed !== null
                        ? `⬇  Download: ${hm.downloadSpeed.toFixed(2)} Mbps`
                        : '⬇  Download: ...'
                );
            }
            items.rtt.set_text(
                hm.rtt !== null ? `⏱  RTT: ${hm.rtt.toFixed(2)} ms` : '⏱  RTT: ...'
            );
            items.jitter.set_text(
                hm.jitter !== null ? `〰  Jitter: ${hm.jitter.toFixed(2)} ms` : '〰  Jitter: ...'
            );
            items.packetLoss.set_text(
                hm.packetLoss !== null ? `📉  Packet Loss: ${hm.packetLoss.toFixed(1)}%` : '📉  Packet Loss: ...'
            );
        }

        // Queue redraw of all sparklines
        if (this._drawingAreas) {
            for (const area of this._drawingAreas.values()) {
                area.queue_repaint();
            }
        }
    }

    _checkNotification(metrics, host, rttSpike, lossThresh) {
        const now = Date.now();
        if (now - this._lastNotifyTime < NOTIFY_COOLDOWN_MS)
            return;

        let msg = null;
        if (metrics.rtt !== null && metrics.rtt > rttSpike) {
            msg = `High latency to ${host}: ${metrics.rtt.toFixed(0)}ms`;
        } else if (metrics.packetLoss !== null && metrics.packetLoss > lossThresh) {
            msg = `Packet loss to ${host}: ${metrics.packetLoss.toFixed(0)}%`;
        }

        if (msg) {
            this._lastNotifyTime = now;
            Main.notify('PingBar', msg);
        }
    }

    destroy() {
        this._stopTimer();
        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = null;
        }
        super.destroy();
    }
});

export default class PingBarExtension extends Extension {
    enable() {
        this._indicator = new PingBarIndicator(this);
        Main.panel.addToStatusArea(this.metadata.uuid, this._indicator);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
