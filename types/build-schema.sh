#!/bin/bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
TJSG="$(corepack pnpm bin)/ts-json-schema-generator"

$TJSG -o iperf3.schema.json -p iperf3.ts -t Report --additional-properties
$TJSG -o netdef.schema.json -p netdef.ts -t Network
$TJSG -o srsgnb.schema.json -p srsran.ts -t GnbConfig
