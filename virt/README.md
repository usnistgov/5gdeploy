# 5gdeploy/virt

Package **virt** contains scripts to start virtual machines.

## bash scripts

* **build.sh** prepares a virtual machine image with Docker and gtp5g kernel module: `./virt/build.sh INDEX HOST-IP`
* **start.sh** launches a virtual machine: `./virt/start.sh INDEX HOST-IP HOST-MAC`

Arguments:

* *INDEX*: VM ID, between 2 and 254.
* *HOST-IP*: host IP address for SSH; empty string means localhost.
* *HOST-MAC*: host MAC address for MACVLAN interface creation.
