#!/bin/ash
set -euo pipefail
CT=$1
shift
NS=$(basename $(docker inspect $CT --format='{{.NetworkSettings.SandboxKey}}'))

if [[ $# -gt 0 ]]; then
  ip netns exec $NS "$@"
else
  echo ip netns exec $NS
fi
