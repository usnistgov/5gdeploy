# Installation Guide

5gdeploy supports Ubuntu 22.04 operating system only.

## Prepare Dependencies

* Docker Engine
* Node.js 20.x
* `httpie`, `jq`, `yq` commands for scripting
* `dumpcap` command for capturing traffic traces (optional)

Run these commands to install dependencies:

```bash
# install system packages
sudo apt update
echo 'wireshark-common wireshark-common/install-setuid boolean true' | sudo debconf-set-selections
sudo DEBIAN_FRONTEND=noninteractive apt install -y httpie jq wireshark-common
sudo adduser $(id -un) wireshark
sudo snap install yq

# install Node.js 20.x
http --ignore-stdin GET https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | sudo gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" | sudo tee /etc/apt/sources.list.d/nodesource.list
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
  dns: ["1.1.1.1", "2606:4700:4700::1111"]
}' | sudo tee /etc/docker/daemon.json
sudo systemctl restart docker
```

Logout and login again, so that your account has the necessary group memberships.

## Install 5gdeploy and Build Docker Images

This repository must be cloned at `~/5gdeploy`.
Open5GCore proprietary repository should be cloend at `~/phoenix-repo`.
Open source 5G implementations will be pulled from Docker registries or source code repositories.

```bash
cd ~/5gdeploy
./install.sh
```

If you do not have access to Open5GCore proprietary repository, disable it:

```bash
cd ~/5gdeploy
export NOPHOENIX=1
./install.sh
```

## Load gtp5g Kernel Module

Both free5GC UPF and PacketRusher require the [gtp5g](https://github.com/free5gc/gtp5g) kernel module.

Install the compiler:

```bash
sudo DEBIAN_FRONTEND=noninteractive apt install -y build-essential
```

Compile and load the kernel module:

```bash
bash ~/5gdeploy/free5gc/load-gtp5g.sh
```

You need to rerun `load-gtp5g.sh` after every reboot.

## Multi-Host Preparation

Some scenarios can/should be deployed over multiple hosts.
Typically, one host is designated as *primary* and all other hosts are designed as *secondary*.

The *primary* host should have everything described above.
The *secondary* hosts only need:

* Docker Engine
* kernel module for free5GC, if needed

The *primary* host should have SSH config and `id_ed25519` key to access each *secondary* host.
The SSH user on each *secondary* host should be added to the `docker` group.
The SSH host key of each *secondary* host should be added to the `known_hosts` file on the *primary* host.
If the command below does not work, re-check these SSH requirements.

Copy Docker images to *secondary* hosts:

```bash
cd ~/5gdeploy
./upload.sh docker 192.168.60.2 192.168.60.3
# change these IP addresses to the hosts in your setup
```
