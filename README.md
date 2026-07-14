# PingBar

A GNOME Shell extension that monitors ping, jitter, and packet loss for your chosen hosts right in the top bar.

## Features

- **RTT, jitter, packet loss** — real-time metrics in the top bar
- **Multiple hosts** — monitor several targets simultaneously
- **Color-coded** — green / yellow / red per metric based on configurable thresholds
- **Sparkline** — mini history graph in the dropdown menu
- **Tooltip** — hover the label to see all hosts' stats
- **Notifications** — optional desktop alerts on latency spikes
- **Lightweight** — async subprocesses, no blocking, minimal network usage (~2.7 MB/day)

## Requirements

- GNOME Shell 45, 46, or 47

## Install

```bash
git clone https://github.com/HA-ir/pingbar.git
cd pingbar
./install.sh
```

Then restart GNOME Shell (Alt+F2 → `r` → Enter) and enable the extension:

```bash
gnome-extensions enable pingbar@hossein
```

Or use the GNOME Extensions app.

## Configuration

Open PingBar settings from:
- GNOME Extensions app
- Right-click the top bar indicator → Settings

| Setting | Default | Description |
|---|---|---|
| Target Hosts | `1.1.1.1,8.8.8.8` | Comma-separated hosts |
| Update Interval | 10s | How often to ping |
| Ping Count | 5 | Packets per host per update |
| RTT threshold | 20ms / 100ms | Green / Yellow / Red |
| Jitter threshold | 5ms / 20ms | Green / Yellow / Red |
| Loss threshold | 1% / 5% | Green / Yellow / Red |

## Uninstall

```bash
./uninstall.sh
```

## License

MIT
