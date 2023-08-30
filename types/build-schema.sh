#!/bin/bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

../node_modules/.bin/ts-json-schema-generator -p netdef.ts -t Network -o netdef.schema.json
