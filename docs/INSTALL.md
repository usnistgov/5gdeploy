# Installation Guide

5gdeploy supports Ubuntu 22.04 operating system only.

## Dependencies

To setup a single-host deployment or the *primary* host of a multi-host deployment, these should be installed:

* Node.js 20.x
* Docker Engine
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
Open5GCore proprietary repository should be cloned at `~/phoenix-repo`.
Open source 5G implementations will be pulled from Docker registries or source code repositories.

```bash
cd ~/5gdeploy
./install.sh
```

If you do not have access to Open5GCore proprietary repository, disable it with `NOPHOENIX` environ:

```bash
cd ~/5gdeploy
export NOPHOENIX=1
./install.sh
```

If you need to rebuild a Docker image for any reason:

```bash
cd ~/5gdeploy
./docker/build.sh ueransim
# change 'ueransim' to the image that you want to rebuild
```

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
