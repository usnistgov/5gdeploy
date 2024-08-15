#!/bin/bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

$(corepack pnpm bin)/ts-json-schema-generator -o iperf3.schema.json -p iperf3.ts -t Report --additional-properties
$(corepack pnpm bin)/ts-json-schema-generator -o netdef.schema.json -p netdef.ts -t Network
$(corepack pnpm bin)/ts-json-schema-generator -o srsgnb.schema.json -p srsran.ts -t gnb.Config --additional-properties
