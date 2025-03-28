#!/bin/bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

mkdir -p grafana
curl -sfLS https://github.com/edgecomllc/eupf/archive/refs/tags/v0.7.0.tar.gz |
  tar -C grafana -xzv --strip-components=3 --wildcards 'eupf-*/.deploy/grafana'
