#!/bin/bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

$(corepack pnpm bin)/ts-json-schema-generator -p netdef.ts -t Network -o netdef.schema.json
$(corepack pnpm bin)/ts-json-schema-generator -p srsran.ts -t gnb.Config -o srsgnb.schema.json
