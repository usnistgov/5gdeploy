#!/bin/bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

curl -sfLS "https://github.com/open5gs/open5gs/raw/v2.7.2/misc/db/open5gs-dbctl" -o open5gs-dbctl
