# 5G Core Deployment Helper

**5gdeploy** is a set of scripts to deploy and control 5G network.
It is primarily useful for running an emulated 5G network in Docker Compose environment.

![5gdeploy logo](docs/5gdeploy-logo.svg)

This software is in early development.
Features are being added gradually.
Breaking changes and force pushes may happen frequently.

Places of interest:

* [installation guide](docs/INSTALL.md)
* [netdef](netdef): JSON document that defines the structure of a 5G network
* [netdef-compose](netdef-compose): CLI command to generate Compose context from NetDef
* [multi-host deployment](docs/multi-host.md)
* [traffic generators](docs/trafficgen.md)
* [scenario](scenario): concrete scenarios
