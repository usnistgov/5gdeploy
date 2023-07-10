# Installation Guide

5gdeploy supports Ubuntu 22.04 operating system only.

Run these commands to install dependencies:

```bash
# install system packages
sudo apt update
echo 'wireshark-common wireshark-common/install-setuid boolean true' | sudo debconf-set-selections
sudo DEBIAN_FRONTEND=noninteractive apt install -y httpie jq wireshark-common
sudo adduser $(id -un) wireshark

# install Node.js 20.x
http --ignore-stdin GET https://deb.nodesource.com/setup_20.x | sudo -E bash -
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
  dns: ["1.1.1.1"]
}' | sudo tee /etc/docker/daemon.json
sudo systemctl restart docker
```

Logout and login again, so that your account has the necessary group memberships.

This repository should be cloned at `~/5gdeploy`, then:

```bash
# install NPM dependencies
cd ~/5gdeploy
corepack pnpm install
```

Additional steps are defined within each scenario.
When you run these steps, you should never use `sudo` unless specifically instructed to do so.
Excessive `sudo` usage would mess up file permissions and cause unexpected errors.
