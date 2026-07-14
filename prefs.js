import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class PingBarPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage({
            title: 'Settings',
            icon_name: 'network-transmit-receive-symbolic',
        });
        window.add(page);

        // ── General ──
        const generalGroup = new Adw.PreferencesGroup({
            title: 'General',
            description: 'Configure targets and polling',
        });
        page.add(generalGroup);

        const hostRow = new Adw.EntryRow({ title: 'Target Hosts' });
        hostRow.set_text(settings.get_string('target-host'));
        hostRow.set_title('Separate multiple hosts with commas');
        hostRow.connect('changed', () => settings.set_string('target-host', hostRow.get_text()));
        generalGroup.add(hostRow);

        const intervalRow = new Adw.SpinRow({
            title: 'Update Interval (seconds)',
            subtitle: 'How often to refresh metrics',
            adjustment: new Gtk.Adjustment({
                lower: 1, upper: 300, step_increment: 1, page_increment: 10,
                value: settings.get_int('update-interval'),
            }),
        });
        settings.bind('update-interval', intervalRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        generalGroup.add(intervalRow);

        const pingCountRow = new Adw.SpinRow({
            title: 'Ping Count',
            subtitle: 'Packets per host per update',
            adjustment: new Gtk.Adjustment({
                lower: 1, upper: 100, step_increment: 1, page_increment: 5,
                value: settings.get_int('ping-count'),
            }),
        });
        settings.bind('ping-count', pingCountRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        generalGroup.add(pingCountRow);

        const speedIntervalRow = new Adw.SpinRow({
            title: 'Speed Test Interval (cycles)',
            subtitle: 'Run download test every N cycles (6 ≈ 60s)',
            adjustment: new Gtk.Adjustment({
                lower: 1, upper: 60, step_increment: 1, page_increment: 5,
                value: settings.get_int('speed-test-interval'),
            }),
        });
        settings.bind('speed-test-interval', speedIntervalRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        generalGroup.add(speedIntervalRow);

        // ── Display ──
        const displayGroup = new Adw.PreferencesGroup({
            title: 'Display',
            description: 'Choose what to show in the top bar',
        });
        page.add(displayGroup);

        const colorToggle = new Adw.SwitchRow({
            title: 'Enable Color Coding',
            subtitle: 'Color each metric independently by its value',
        });
        settings.bind('enable-color-coding', colorToggle, 'active', Gio.SettingsBindFlags.DEFAULT);
        displayGroup.add(colorToggle);

        const toggles = [
            { key: 'show-rtt', title: 'Show RTT', subtitle: 'Round-trip time' },
            { key: 'show-jitter', title: 'Show Jitter', subtitle: 'RTT variation' },
            { key: 'show-packet-loss', title: 'Show Packet Loss', subtitle: 'Lost packet percentage' },
            { key: 'show-download-speed', title: 'Show Download Speed', subtitle: 'Throughput in Mbps' },
            { key: 'show-sparkline', title: 'Show Sparkline', subtitle: 'Mini history graph in menu' },
        ];
        for (const t of toggles) {
            const row = new Adw.SwitchRow({ title: t.title, subtitle: t.subtitle });
            settings.bind(t.key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
            displayGroup.add(row);
        }

        // ── Color Thresholds ──
        const colorGroup = new Adw.PreferencesGroup({
            title: 'Color Thresholds',
            description: 'Green → Yellow → Red ranges per metric',
        });
        page.add(colorGroup);

        const addThresholds = (label, prefix, gMax, wMax, gUnit) => {
            const gRow = new Adw.SpinRow({
                title: `${label} Good ≤ ${gUnit}`,
                adjustment: new Gtk.Adjustment({
                    lower: 1, upper: wMax, step_increment: 1, page_increment: 10,
                    value: settings.get_int(`${prefix}-threshold-good`),
                }),
            });
            settings.bind(`${prefix}-threshold-good`, gRow, 'value', Gio.SettingsBindFlags.DEFAULT);
            colorGroup.add(gRow);

            const wRow = new Adw.SpinRow({
                title: `${label} Warn ≤ ${gUnit}`,
                subtitle: `Above this value → red`,
                adjustment: new Gtk.Adjustment({
                    lower: 1, upper: 1000, step_increment: 5, page_increment: 10,
                    value: settings.get_int(`${prefix}-threshold-warn`),
                }),
            });
            settings.bind(`${prefix}-threshold-warn`, wRow, 'value', Gio.SettingsBindFlags.DEFAULT);
            colorGroup.add(wRow);
        };

        addThresholds('RTT', 'rtt', 500, 1000, 'ms');
        addThresholds('Jitter', 'jitter', 50, 100, 'ms');
        addThresholds('Loss', 'loss', 50, 100, '%');

        // ── Notifications ──
        const notifGroup = new Adw.PreferencesGroup({
            title: 'Notifications',
            description: 'Desktop alerts when connection degrades',
        });
        page.add(notifGroup);

        const notifToggle = new Adw.SwitchRow({
            title: 'Enable notifications',
            subtitle: 'Alert on latency spikes or packet loss',
        });
        settings.bind('notify-on-spike', notifToggle, 'active', Gio.SettingsBindFlags.DEFAULT);
        notifGroup.add(notifToggle);

        const spikeRow = new Adw.SpinRow({
            title: 'RTT spike threshold (ms)',
            adjustment: new Gtk.Adjustment({
                lower: 10, upper: 5000, step_increment: 10, page_increment: 50,
                value: settings.get_int('rtt-spike-threshold'),
            }),
        });
        settings.bind('rtt-spike-threshold', spikeRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        notifGroup.add(spikeRow);

        const lossRow = new Adw.SpinRow({
            title: 'Packet loss threshold (%)',
            adjustment: new Gtk.Adjustment({
                lower: 1, upper: 100, step_increment: 1, page_increment: 5,
                value: settings.get_int('loss-threshold'),
            }),
        });
        settings.bind('loss-threshold', lossRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        notifGroup.add(lossRow);

        // ── Speed Test ──
        const speedGroup = new Adw.PreferencesGroup({
            title: 'Speed Test',
            description: 'Custom URL for download speed measurement',
        });
        page.add(speedGroup);

        const urlRow = new Adw.EntryRow({ title: 'Speed Test URL' });
        urlRow.set_text(settings.get_string('speed-test-url'));
        urlRow.connect('changed', () => settings.set_string('speed-test-url', urlRow.get_text()));
        speedGroup.add(urlRow);
    }
}
