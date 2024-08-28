#!/bin/bash
set -euo pipefail
INPUT="${1:-compose.yml}"

yq -o tsv '.services | map([
  .container_name,
  (.annotations["5gdeploy.host"] | with(select(.==""); .="PRIMARY")),
  (.network_mode | with(select(.|not); .="-")),
  .cpuset,
  .annotations["5gdeploy.cpuset_warning"]
])' "$INPUT" | sort -k2,2 -k1,1 | column -t -N CONTAINER,HOST,NETNS,CPUSET,CPUSET-WARNING
