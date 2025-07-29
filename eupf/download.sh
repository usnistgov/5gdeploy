#!/bin/bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
TAG=${1:-v0.7.0}

mkdir -p grafana
curl -sfLS "https://github.com/edgecomllc/eupf/archive/${TAG}.tar.gz" |
  tar -C grafana -xzv --strip-components=3 --wildcards 'eupf-*/.deploy/grafana'