# 5gdeploy/replace-sims

Command **replace-sims** replaces SIM cards in a [NetDef](../netdef) with information from a spreadsheet.
Each row of the spreadsheet represents one SIM card, which must have three columns: SUPI, K, OPC.
SIM cards in the spreadsheet are sequentially applied to subscribers in the NetDef, until either input is exhausted.

Scenairo [generate.sh](../scenario) script invokes this script automatically if `5gdeploy/sims.tsv` exists.
Combined with other features, this allows connecting physical UEs, without having to reflash SIM cards every time.
