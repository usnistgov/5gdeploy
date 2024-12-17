# 5gdeploy/netdef

Package **netdef** defines all aspects of a 5G network in JavaScript / TypeScript / JSON.
The typing is defined in [types/netdef.ts](../types/netdef.ts).

JSON schema equivalent of this typing is generated at `types/netdef.schema.json` during installation.
`validate` function validates a JSON object against this schema.

`helpers.ts` offers convenience functions on top of the NetDef JSON object.
Those are used by the rest of this codebase.
