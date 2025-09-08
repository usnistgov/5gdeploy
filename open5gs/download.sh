#!/bin/bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
TAG=${1:-v2.7.6}

curl -sfLS "https://github.com/open5gs/open5gs/raw/${TAG}/misc/db/open5gs-dbctl" -o open5gs-dbctl
