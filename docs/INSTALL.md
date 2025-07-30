# Installation Guide

5gdeploy supports Linux distributions based on Ubuntu 20.04, 22.04, and 24.04.

## Dependencies

To setup a single-host deployment or the *primary* host of a multi-host deployment, these should be installed:

* Node.js 22.x
* Docker Engine 28.x
* APT packages:
  * `httpie jq`: used in bash scripts
  * `wireshark-common`: for capturing traffic traces with `dumpcap` in scenarios
  * `python3-libconf`: used by `oai/libconf_convert.py`
  * `linux-generic` or `linux-lowlatency`: kernel headers for building gtp5g kernel module
* Snap packages:
  * `yq`: used in bash scripts

Run these commands to install dependencies:

```bash
# install system packages
sudo apt update
echo 'wireshark-common wireshark-common/install-setuid boolean true' | sudo debconf-set-selections
sudo DEBIAN_FRONTEND=noninteractive apt install -y httpie jq python3-libconf wireshark-common
sudo adduser $(id -un) wireshark
sudo snap install yq

# install Node.js 22.x
http --ignore-stdin GET https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | sudo gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" | sudo tee /etc/apt/sources.list.d/nodesource.list
sudo apt update
sudo DEBIAN_FRONTEND=noninteractive apt install -y nodejs

# install and configure Docker
http --ignore-stdin GET https://get.docker.com | bash
sudo adduser $(id -un) docker
sudo mkdir -p /etc/docker
jq -n '{
  "data-root": "/home/docker",
  "log-driver": "local",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  },
  dns: ["1.1.1.1", "2606:4700:4700::1111", "8.8.8.8", "2001:4860:4860::8888"]
}' | sudo tee /etc/docker/daemon.json
sudo systemctl restart docker
```

Logout and login again, so that your account has the necessary group memberships.

## Install 5gdeploy and Build Docker Images

This repository must be cloned at `~/5gdeploy`.
To install 5gdeploy and build Docker images of open-source 5G implementations:

```bash
cd ~/5gdeploy
./install.sh
```

If you need to rebuild a Docker image for any reason:

```bash
cd ~/5gdeploy
./docker/build.sh ueransim
# change 'ueransim' to the image that you want to rebuild
```

### Installation Options
The following optional arguments can be passed to `./install.sh`:
* `--pipework-version <version>`: Specify a **branch**, **tag**, or **commit hash** to use for Pipework (_default: [9ba97f1735022fb5f811d9c2a304dda33fae1ad1](https://github.com/jpetazzo/pipework)_)
* `--eupf-version <version>`: Specify a **branch** or **commit hash** to use for eUPF (_default: [main](https://github.com/edgecomllc/eupf)_)
* `--free5gc-version <version>`: Specify a **branch**, **tag**, or **commit hash** to use for free5GC (_default: [master](https://github.com/free5gc/free5gc-compose)_)
* `--free5gc-webconsole-version <version>`: Specify a **branch**, **tag**, or **commit hash** to use for free5GC Web Console (_default: [f4932d569dd0045fc31baca062a05d7b34e3e8e0](https://github.com/free5gc/webconsole)_)
* `--gnbsim-version <version>`: Specify a **branch**, **tag**, or **commit hash** to use for gNBSim (_default: [d3fce7e35a69b9f5d670242a93b7d1bee8842ecf](https://github.com/omec-project/gnbsim)_)
* `--gtp5g-version <version>`: Specify a **branch**, **tag**, or **commit hash** to use for gtp5g (_default: [v0.9.13](https://github.com/free5gc/gtp5g)_)
* `--oai-fed-version <version>`: Specify a **branch**, **tag**, or **commit hash** to use for OAI-CN5G (_default: [master](https://gitlab.eurecom.fr/oai/cn5g/oai-cn5g-fed)_)
* `--oai-nwdaf-version <version>`: Specify a **branch**, **tag**, or **commit hash** to use for OAI-CN5G-NWDAF (_default: [http2_server_support](https://gitlab.eurecom.fr/oai/cn5g/oai-cn5g-nwdaf)_)
* `--open5gs-version <version>`: Specify a **release** to use for Open5GS (_default: [2.7.2](https://hub.docker.com/r/gradiant/open5gs)_)
* `--packetrusher-version <version>`: Specify a **branch**, **tag**, or **commit hash** to use for PacketRusher (_default: [80a7f4bc63d9563a8ec58ba126440d94018a35a2](https://github.com/HewlettPackard/PacketRusher)_)
* `--sockperf-version <version>`: Specify a **branch**, **tag**, or **commit hash** to use for sockperf (_default: [19accb5229503dac7833f03713b978cb7fc48762](https://github.com/Mellanox/sockperf)_)
* `--srsran5g-version <version>`: Specify a **release** to use for srsRAN Project (_default: [24_10_1](https://hub.docker.com/r/gradiant/srsran-5g)_)
* `--ueransim-version <version>`: Specify a **branch**, **tag**, or **commit hash** to use for UERANSIM (_default: [2fc85e3e422b9a981d330bf6ff945136bfae97f3](https://github.com/aligungr/UERANSIM)_)
* `--dpdk-version <version>`: Specify a **branch**, **tag**, or **commit hash** to use for DPDK (_default: [v24.11](https://github.com/DPDK/dpdk)_)

## Secondary Host

See [multi-host deployment](multi-host.md) page for concepts of multi-host deployment.
For a multi-host deployment, a *secondary* host needs only:

* Docker Engine
* kernel headers, if gtp5g is used

The *primary* host should have SSH config and `id_ed25519` key to access each *secondary* host.
The SSH user on each *secondary* host should be added to the `docker` group.
The SSH host key of each *secondary* host should be added to the `known_hosts` file on the *primary* host.
If the command below does not work, re-check these SSH requirements.

When using [generate.sh](../scenario/generate.sh), the Compose folder and relevant Docker images are automatically uploaded to secondary hosts.
Otherwise, they can be manually uploaded:

```bash
# upload the Compose folder
# (change these IP addresses to the secondary hosts in your setup)
~/5gdeploy/upload.sh ~/compose/20230601 192.168.60.2 192.168.60.3

# upload Docker images
# (change these IP addresses to the secondary hosts in your setup)
~/5gdeploy/upload.sh docker 192.168.60.2 192.168.60.3

# or, upload from within a generated scenario
~/compose/20230601/compose.sh upload
```
