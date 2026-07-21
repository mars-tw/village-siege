# Public monitoring template

This directory provides secret-free Prometheus, blackbox-exporter, alert-rule, and Grafana provisioning files. The default targets assume containers named `server`, `client`, `blackbox-exporter`, and `prometheus` share a private network. Prometheus directly scrapes the server's internal-only `/metrics` endpoint and uses blackbox-exporter for external health semantics.

Mount the files at these conventional paths:

- `prometheus.yml` to `/etc/prometheus/prometheus.yml:ro`
- `alerts/` to `/etc/prometheus/rules:ro`
- `blackbox.yml` to `/etc/blackbox_exporter/config.yml:ro`
- `grafana/provisioning/` to `/etc/grafana/provisioning:ro`
- `grafana/dashboards/` to `/var/lib/grafana/dashboards:ro`

The template probes `/health/ready` on the server and `/_health` on the client. Server metrics cover room and player gauges, WebSocket origin rejections, recovery fail-stops, tick and persistence duration, persistence failures, process memory, and uptime. Alerts cover endpoint availability, recovery and persistence failures, mean tick time above 80 ms, and mean persistence time above 500 ms. The latency thresholds are conservative starting points and should be tuned from production baselines.

The template does not expose Prometheus, Grafana, or blackbox-exporter publicly, choose Grafana credentials, or configure an alert receiver. Set credentials and receiver integrations through your deployment's secret store, and place any public UI behind authenticated TLS. Reconnect rates and backup freshness still require application metrics or a separate textfile exporter before alerts can be added reliably.
