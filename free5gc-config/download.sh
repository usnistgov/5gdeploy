#!/bin/bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
TAG=${1:-master}

if [[ -d free5gc-compose ]]; then
  git -C free5gc-compose fetch
  git -C free5gc-compose checkout "${TAG}"
else
  git clone --branch "${TAG}" https://github.com/free5gc/free5gc-compose.git
fi
