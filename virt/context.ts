import path from "node:path";

import yaml from "js-yaml";
import { Netmask } from "netmask";
import * as shlex from "shlex";

import * as compose from "../compose/mod.js";
import type { ComposeService, ComposeVolume } from "../types/mod.js";
import { assert, parseCpuset, scriptCleanup, setupCpuIsolation } from "../util/mod.js";
import { iterVM } from "./helper.js";

export type VMNetwork = [net: string, hostNetif: string];

export interface VMOptions {
  name: string;
  nCores: number;
  networks: readonly VMNetwork[];
}

interface VMContext extends VMOptions {
  vmrunVolume: ComposeVolume;
}

/** Contextual information and helpers while converting VM list into Compose context. */
export class VirtComposeContext extends compose.ComposeContext {
  private kern?: ComposeService;
  private base?: ComposeService;

  public createCtrlif(hostNetif: string): void {
    const vmctrl = new Netmask(this.defineNetwork("vmctrl"));
    const ip = vmctrl.first;

    const s = this.defineService("virt_ctrlif", virtDockerImage, []);
    s.network_mode = "host";
    s.cap_add.push("NET_ADMIN");
    compose.setCommands(s, (function*() {
      yield* scriptCleanup();
      yield* makeMacvlan("macvtap", "vmctrl", compose.ip2mac(ip), hostNetif, "vmctrl");
      yield `ip addr replace ${ip}/24 dev vmctrl`;
      yield "msg Idling";
      yield "tail -f &";
      yield "wait $!";
    })());
  }

  private createKern(): ComposeService {
    compose.defineVolume(this.c, vmbuildVolume.source);
    const s = this.defineService("virt_kern", "rclone/rclone", []);
    compose.annotate(s, "only_if_needed", 1);
    s.network_mode = "none";
    s.volumes.push({
      type: "bind",
      source: "/boot",
      target: "/hostboot",
      read_only: true,
    }, vmbuildVolume);
    s.command = [
      "copyto",
      "--copy-links",
      "/hostboot/vmlinuz",
      "/vmbuild/vmlinuz",
    ];
    return s;
  }

  private createBase(): ComposeService {
    this.kern ??= this.createKern();
    this.defineNetwork("vmbuild", { wantNAT: true });
    const s = this.defineService("virt_base", virtDockerImage, ["vmbuild"]);
    compose.annotate(s, "only_if_needed", 1);
    s.depends_on[this.kern.container_name] = { condition: "service_completed_successfully" };
    applyLibguestfsCommon(s);
    for (const key of Object.keys(s.environment).filter((key) => /_proxy/i.test(key))) {
      delete s.environment[key]; // eslint-disable-line @typescript-eslint/no-dynamic-delete
    }
    s.volumes.push(vmbuildVolume, {
      type: "bind",
      source: "/etc/docker/daemon.json",
      target: "/etc/docker/daemon.json",
      read_only: true,
    });
    s.environment.XDG_CACHE_HOME = "/vmbuild/cache";
    s.working_dir = "/vmbuild";
    compose.setCommands(s, [
      "if [[ -f base.done ]]; then",
      "  msg base.qcow2 already exists",
      "  exit 0",
      "fi",
      "cat /etc/docker/daemon.json >daemon.json",
      `chown -R ${owner} .`,
      "msg Building base.qcow2",
      `yasu ${owner}:$(stat -c %g /dev/kvm) virt-builder debian-12 ${shlex.join([
        "--size", "20G",
        "--format", "qcow2",
        "-o", "base.qcow2",
        "--run-command", "apt-mark hold grub-pc",
        "--uninstall", uninstall.join(","),
        "--update",
        "--install", install.join(","),
        "--run-command", "apt-mark unhold grub-pc",
        "--delete", "/etc/ssh/ssh_host_*",
        "--run-command", "curl -fsLS https://get.docker.com | bash",
        "--copy-in", "daemon.json:/etc/docker/",
        "--copy-in", "/gtp5g:/",
        "--firstboot", "/gtp5g-load.sh",
      ])}`,
      "msg base.qcow2 built successfully",
      "touch base.done",
    ]);
    return s;
  }

  public defineVM(opts: VMOptions): ComposeService {
    this.base ??= this.createBase();

    const { name, networks } = opts;
    const vmrunVolume: ComposeVolume = {
      type: "volume",
      source: `vm_${name}`,
      target: "/vmrun",
    };
    compose.defineVolume(this.c, vmrunVolume.source);
    const vmc = { ...opts, vmrunVolume };

    const vm = this.defineService(`vm_${name}`, virtDockerImage, networks.map(([net]) => net));
    const netplan = this.makeNetplan(vmc, vm);

    const prep = this.defineService(`vmprep_${name}`, virtDockerImage, []);
    prep.depends_on[this.base.container_name] = { condition: "service_completed_successfully" };
    this.createPrep(vmc, prep, netplan);

    vm.depends_on[prep.container_name] = { condition: "service_completed_successfully" };
    this.createRun(vmc, vm);

    return vm;
  }

  private makeNetplan({ networks }: VMContext, vm: ComposeService) {
    const ethernets: Record<string, unknown> = {};
    for (const [net] of networks) {
      const [ip, macaddress] = compose.getIPMAC(vm, net);
      ethernets[net] = {
        "set-name": net,
        match: { macaddress },
        dhcp4: false,
        dhcp6: false,
        "accept-ra": false,
        "link-local": [],
        addresses: [`${ip}/24`],
      };
    }
    return {
      network: {
        ethernets,
      },
    };
  }

  private createPrep({ name, nCores, vmrunVolume }: VMContext, s: ComposeService, netplan: unknown): void {
    compose.annotate(s, "only_if_needed", 1);
    s.network_mode = "none";
    applyLibguestfsCommon(s);
    s.volumes.push({
      ...vmbuildVolume,
      read_only: true,
    }, vmrunVolume, {
      type: "bind",
      source: path.join(process.env.HOME ?? "/root", ".ssh/id_ed25519.pub"),
      target: "/id_ed25519.pub",
      read_only: true,
    });

    const cpuset = parseCpuset(`0-${nCores - 1}`);
    assert(cpuset.length >= 2);
    const insideCommands = [
      "dpkg-reconfigure openssh-server",
      ...setupCpuIsolation(cpuset.slice(0, 1), cpuset.slice(1)),
    ];

    s.working_dir = "/vmrun";
    compose.setCommands(s, [
      "if [[ -f vm.done ]]; then",
      "  msg vm.qcow2 already exists",
      "  exit 0",
      "fi",
      "msg Preparing VM disk image",
      "cat /id_ed25519.pub >id_ed25519.pub",
      `echo ${shlex.quote(yaml.dump(netplan, { sortKeys: true }))} >01-netcfg.yaml`,
      "install /vmbuild/base.qcow2 vm.qcow2",
      `chown -R ${owner} .`,
      `yasu ${owner}:$(stat -c %g /dev/kvm) virt-sysprep ${shlex.join([
        "-a", "vm.qcow2",
        "--hostname", `vm-${name}.5gdeploy`,
        "--copy-in", "01-netcfg.yaml:/etc/netplan/",
        "--run-command", `bash -c ${shlex.quote(insideCommands.join("\n"))}`,
        "--root-password", "password:0000",
        "--ssh-inject", "root:file:id_ed25519.pub",
      ])}`,
      "msg vm.qcow2 built successfully",
      "touch vm.done",
    ]);
  }

  private createRun(vmc: VMContext, s: ComposeService): void {
    const { name, nCores, vmrunVolume } = vmc;
    compose.annotate(s, "vmname", name);
    compose.annotate(s, "cpus", nCores);
    s.privileged = true;
    s.volumes.push(vmrunVolume);
    s.working_dir = "/vmrun";
    compose.setCommands(s, this.makeRunCommands(vmc, s));
    s.network_mode = "host";
    s.stdin_open = true;
    s.tty = true;
  }

  private *makeRunCommands({ name, nCores, networks }: VMContext, s: ComposeService): Iterable<string> {
    yield* scriptCleanup();
    const qemuFlags = [
      "-name", name,
      "-nodefaults", "-nographic", "-msg", "timestamp=on",
      "-chardev", "pty,id=charserial0", "-device", "isa-serial,chardev=charserial0,id=serial0", "-serial", "stdio",
      "-enable-kvm", "-machine", "accel=kvm,usb=off",
      "-cpu", "host", "-smp", `${nCores},sockets=1,cores=${nCores},threads=1`, "-m", "8192",
      "-drive", "if=virtio,file=vm.qcow2",
    ];
    const qemuRedirects = [];
    let fd = 3;
    for (const [net, hostNetif] of networks) {
      yield "";
      const [, mac] = compose.getIPMAC(s, net);
      const shortMac = mac.replaceAll(":", "");
      const netif = `vm-${shortMac}`;
      const netdev = `net-${shortMac}`;
      const tap = `vmtap-${shortMac}`;
      compose.disconnectNetif(this.c, s.container_name, net);
      yield* makeMacvlan("macvtap", netif, mac, hostNetif, `${s.container_name}:${net}`);
      yield `IFS=: read MAJOR MINOR < <(cat /sys/devices/virtual/net/${netif}/tap*/dev)`;
      yield `mknod -m 0666 /dev/${tap} c $MAJOR $MINOR`;
      qemuFlags.push(
        "-device", `virtio-net-pci,netdev=${netdev},mac=${mac}`,
        "-netdev", `tap,id=${netdev},vhost=on,fd=${fd}`,
      );
      qemuRedirects.push(`${fd}<>/dev/${tap}`);
      ++fd;
    }

    yield "";
    yield "msg Starting QEMU";
    yield `yasu $(stat -c %u vm.qcow2):$(stat -c %g /dev/kvm) qemu-system-x86_64 ${
      shlex.join(qemuFlags)} ${qemuRedirects.join(" ")} &`;
    yield "wait $!";
  }

  protected override makeComposeSh(): Iterable<string> {
    const self = this; // eslint-disable-line unicorn/no-this-assignment,@typescript-eslint/no-this-alias
    return compose.makeComposeSh(this.c, {
      act: "ssh",
      cmd: "ssh VM",
      desc: "SSH connect to VM.",
      *code() {
        yield "VMNAME=${1:-}"; // eslint-disable-line no-template-curly-in-string
        yield "if [[ -n $VMNAME ]]; then shift; fi";
        yield "case $VMNAME in";
        for (const [s, name] of iterVM(self.c)) {
          yield `  ${name}) exec ssh root@${compose.getIP(s, "vmctrl")} "$@";;`;
        }
        yield "  *) die VM not found;;";
        yield "esac";
      },
    }, {
      act: "keyscan",
      desc: "Update known_hosts with SSH host keys.",
      *code() {
        yield "[[ -f ~/.ssh/known_hosts ]] || touch ~/.ssh/known_hosts";
        for (const [s, name] of iterVM(self.c)) {
          const ip = compose.getIP(s, "vmctrl");
          yield `msg Updating known_hosts for ${name} at ${ip}`;
          yield `ssh-keygen -R ${ip}`;
          yield `ssh -o StrictHostKeyChecking=no root@${ip} hostname -f`;
        }
      },
    });
  }
}

const virtDockerImage = "5gdeploy.localhost/virt";

const vmbuildVolume: ComposeVolume = {
  type: "volume",
  source: "vmbuild",
  target: "/vmbuild",
};

const owner = 50086;

const uninstall = [
  "ifupdown",
];

const install = [
  "curl",
  "htop",
  "linux-headers-amd64",
  "make",
  "netplan.io",
  "wireshark-common",
];

function applyLibguestfsCommon(s: ComposeService): void {
  s.devices.push("/dev/kvm:/dev/kvm");
  s.volumes.push({
    type: "bind",
    source: "/lib/modules",
    target: "/lib/modules",
    read_only: true,
  });
  s.environment.LIBGUESTFS_DEBUG = "1";
  s.environment.SUPERMIN_KERNEL = "/vmbuild/vmlinuz";
}

function* makeMacvlan(ifType: "macvlan" | "macvtap", netif: string, mac: string, hostNetif: string, desc: string): Iterable<string> {
  if (/^(?:[\da-f]{2}:){5}[\da-f]{2}$/i.test(hostNetif)) {
    yield `HOSTIF=$(ip -j link show | jq -r '.[] | select(.address=="${hostNetif.toLowerCase()}") | .ifname' | tail -1)`;
    yield `[[ -n $HOSTIF ]] || die Host netif not found for ${hostNetif}`;
  } else {
    yield `HOSTIF=${shlex.quote(hostNetif)}`;
  }
  yield `msg Making ${ifType.toUpperCase()} ${netif} for ${desc} on $HOSTIF`;
  yield "ip link set $HOSTIF up";
  yield `ip link add link $HOSTIF name ${netif} type ${ifType} mode bridge`;
  yield `CLEANUPS=$CLEANUPS"; ip link del ${netif}"`;
  yield `ip link set ${netif} up address ${mac}`;
}
