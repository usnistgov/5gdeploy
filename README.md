# 5G Core Deployment Helper

**5gdeploy** is a set of scripts to deploy and control 5G network.
It is primarily useful for running an emulated 5G network in Docker Compose environment.

This software is in early development.
Features are being added gradually.
Breaking changes and force pushes may happen frequently.

Places of interest:

* [installation guide](docs/INSTALL.md)
* [multi-host deployment](docs/multi-host.md)
* [netdef](netdef): JSON document that defines the structure of a 5G network
* [netdef-compose](netdef-compose): CLI command to generate Compose context from NetDef
* [scenario](scenario): concrete scenarios
