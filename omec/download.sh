#!/bin/bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

git clone https://github.com/omec-project/upf.git
make -C upf docker-build
