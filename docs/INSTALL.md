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

This repository should be cloned at `~/5gdeploy`, then:

```bash
# install NPM dependencies
cd ~/5gdeploy
corepack pnpm install

# build utility Docker images
bash docker/build.sh bridge
bash docker/build.sh dn

# build JSON schema
bash types/build-schema.sh
```

Additional steps are defined within each scenario.
When you run these steps, you should never use `sudo` unless specifically instructed to do so.
Excessive `sudo` usage would mess up file permissions and cause unexpected errors.
