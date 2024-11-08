# 5gdeploy/virt

Package **virt** contains scripts to start virtual machines that can be used as part of a [multi-host deployment](../docs/multi-host.md).
This allows certain network functions to have better isolation than what's provided by Docker.

## Terminology

The virtual machines use KVM technology.
Each virtual machine is referred to as a *KVM guest*.

The hypervisor host is usually a physical machine and is referred to as a *physical host*.
Nevertheless, it is possible to use an existing virtual machine as a "physical host", as long as "nested virtualization" is allowed.

The term *host* in "multi-host deployment" differs from "physical host" here.
A "host" in that context refers to an operating system with its own kernel and Docker Engine, which could be either a physical machine or a KVM guest.

## Define KVM Guests

You can define one or more KVM guests with the `virt` command:

```bash
corepack pnpm -s virt \
  --vm='a | 192.168.60.2(10-19) | vmctrl@02:00:00:00:00:02,n6@02:00:00:00:06:02' \
  --vm='b | 192.168.60.3(10-19) | vmctrl@02:00:00:00:00:03,n6@02:00:00:00:06:03' \
  --vm='c | 192.168.60.3(20-29) | vmctrl@02:00:00:00:00:03,n6@02:00:00:00:06:03' \
  --ctrlif='02:00:00:00:00:01'
```

`--vm` flag defines a KVM guest.
This flag is repeatable.
You should define all KVM guests needed in a deployment on the same command line, so that they can be controlled together.

Each `--vm` flag value consists of three parts, separated by `|` character:

1. virtual machine name
2. placement of the virtual machine, including physical host IP and CPU isolation 
3. network interfaces of the virtual machine

The virtual machine name must be a lowercase letter followed by zero or more lowercase letters or digits.
It is used as the hostname within the KVM guest and as part of the Docker volume/container names on the physical host.
The other parts are described in next sections.

### Placement and CPU Isolation

The placement portion of `--vm` flag adopts a similar syntax as the multi-host `--place` flag.
It has a physical host IP address, followed by a cpuset within parentheses.
Both portions are mandatory.

The cpuset should have one or more cores, preferably on the same NUMA socket.
The KVM guest would receive the same quantity of CPU cores, of which the first core is unreserved and all other cores are reserved for Docker containers only.

### Network Interfaces

The network interfaces portion of `--vm` flag is a comma separated list where each item is a *guest netif definition* with one of these syntaxes:

* *guest-ifname*`@`*host-ifname* (MACVTAP)
  * Example: `vmctrl@a4:bf:01:cc:75:97`
* *guest-ifname*`@`*host-mac* (MACVTAP)
  * Example: `vmctrl@enp26s0f1`
* *guest-ifname*`@`*host-mac*`+pci=`*host-pci* (PCI passthrough)
  * Example: `vmctrl@a4:bf:01:cc:75:97+pci=0000:1a:00.1`
* *guest-ifname*`@VF+pci=`*host-pci* (SR-IOV)
  * Example: `vmctrl@VF+pci=0000:1a:00.1`

You can have up to 16 distinct guest netif names, across all KVM guests.

In MACVTAP mode, the guest netif is mapped to a MACVTAP subinterface attached to the physical host netif, which may be specified as either MAC address or ifname.
If the host has multiple netifs with the same MAC address (e.g. a VLAN netif and a non-VLAN netif), you should use the *host-ifname* syntax.

In PCI passthrough mode, the PCI device of the Ethernet adapter is passed to the KVM guest for its exclusive use.
Before launching the VM, you must enable IOMMU on the host.
Each PCI device can appear in only one guest netif definition, but you will be able to create additional MACVLAN subinterfaces within the KVM guest.
Device binding to `vfio-pci` driver is performed automatically; after stopping the VM, you may need to manually re-bind the device to kernel driver before it can be used in the host.

In SR-IOV mode, a number of Virtual Functions (VFs) are created on the PCI device and these VFs are passed to the KVM guest, while the Physical Function (PF) remains on the host.
Before launching the VM, you must enable IOMMU on the host, and bind the PF to its usual kernel driver.
Each PF may appear in one or more guest netif definitions across one or more KVM guests, as long as the total VF quantity does not exceed PF hardware limits.
There cannot be any other VFs not used by 5gdeploy, as those will be deleted during initialization.
This feature is currently only tested with i40e + iavf drivers.

### Control Interface

As part of network interfaces portion of `--vm` flag, every KVM guest must have a `vmctrl` network interface.
This is used for SSH access into the guest operating system.
The KVM guest cannot gain Internet access through this interface.

`--ctrlif` flag specifies a physical host netif on the primary host that is used for reaching the KVM guests.
It may be specified as either a MAC address or an existing ifname.
All these physical host netifs must be bridged through an external switch or other mechanisms.

## Control KVM Guests

The `virt` command creates a *virtualization Compose context* in `~/compose/virt` directory.
You can control KVM guests with the following commands:

```bash
cd ~/compose/virt

# start KVM guests
./compose.sh upload && ./compose.sh up
# (allow 60 seconds after `up` returns, before continuing to next commands)

# update local known_hosts file
./compose.sh keyscan

# optional: SSH into a KVM guest, run commands over SSH
./compose.ssh ssh VMNAME
./compose.ssh ssh VMNAME docker ps -a

# stop KVM guests
./compose.sh down
```

You can use [netdef-compose](../netdef-compose/README.md) and [generate.sh](../scenario/README.md) scripts, as well as the scenario Compose contexts generated by those scripts, only if the KVM guests are running and you have updated the local known\_hosts file.
Before stopping the KVM guests, you should stop the scenario Compose context.

## How VMs are Built and Launched

This advanced topic describes the detailed procedure on how the KVM guests are built and launched.

KVM guests are built with [guestfs-tools](https://libguestfs.org) and executed with [QEMU](https://www.qemu.org/).
5gdeploy runs both steps in Docker containers.
VM images are stored in Docker volumes, where the volume names can be scoped per-operator and per-project via `--volume-prefix0` and `--volume-prefix1` flags.

The Compose file generated by `virt` command includes these containers:

* **virt\_kern**
  * one per physical host
  * copy kernel image to be used by guestfs build process
* **virt\_base**
  * one per physical host
  * depends on virt\_kern
  * build a base VM image with [virt-builder](https://libguestfs.org/virt-builder.1.html)
  * do nothing if the base VM image already exists
* **virt\_sriov*i*** (only if SR-IOV network interfaces are used)
  * one per physical host
  * setup PCI Virtual Functions
* **vmprep\_*vmname***
  * one per KVM guest
  * depends on virt\_base
  * customize the base VM image into per-VM image with [virt-sysprep](https://libguestfs.org/virt-sysprep.1.html)
  * do nothing if the per-VM image already exists
* **vm\_*vmname***
  * one per KVM guest
  * depends on vmprep\_*vmname* and virt\_sriov*i*
  * run the KVM guest
* **virt_ctrlif**
  * only one primary host
  * setup a `vmctrl` netif for the primary host

The VM image is based on Debian 12.
It is built in two steps: base image and per-VM image.
The base image is stored in `vmbuild` Docker volume, `base.qcow2` file.
It has upgraded system packages and contains the software packages needed on a secondary host:

* Docker Engine
* gtp5g kernel module source code
  * This is delivered in source code form, because the libguestfs appliance uses a different kernel version as the eventual VM.
    In order to have the gtp5g kernel module at runtime, it is compiled and installed in a firstrun script.

The per-VM image is stored in `vm_`*vmname* Docker volume, `vm.qcow2` file.
It additionally contains these changes:

* SSH public key of the operator
* root password changed to `0000`
* Netplan configuration to set the IP addresses
* systemd override files for CPU isolation

The `./compose.sh up` command brings up `virt_ctrlif` and `vm_`*vmname* containers only.
The build steps are triggered through dependency rules in the Compose file.
Each build step would be bypassed, if its output is already present.
If you need to re-run a build step for any reason, delete the relevant Docker volume on the physical host.

The `virt_ctrlif` container runs on the primary host only.
In the host netns, it locates a host netif identified by `--ctrlif` flag.
It then creates a "vmctrl" MACVLAN subinterface attached to this netif, and assigns the ".1" IP address of the `vmctrl` network.
The primary host can reach KVM guests through this subinterface.
When this container is stopped, the subinterface is deleted.

The `vm_`*vmname* container is started on the physical host intended for the KVM guest after the per-VM image has been built.
It then processes guest netif definitions:

* For each guest netif definition under MACVTAP mode, it locates the physical host netif and creates a MACVTAP subinterface attached to it.
  The MACVTAP subinterface consists of a virtual netif in the host netns and an associated TAP device node.
  The virtual netif is left as is, with no IP addresses assigned.
  The TAP device node is passed to the QEMU process as a file descriptor, which would appear in the guest as a virtio network device.
* For each guest netif definition under PCI passthrough mode, the PCI device is passed to the QEMU process via `vfio-pci` driver.

The `vm_`*vmname* container proceeds to launch QEMU process using the per-VM image as boot drive, with network devices as described above.
CPU affinity for guest CPU threads is configured via QEMU Machine Protocol.
The guest operating system configures netifs via netplan, matching devices via their MAC addresses.
When the container is stopped, the MACVTAP subinterfaces are deleted and the PCI devices are released.
