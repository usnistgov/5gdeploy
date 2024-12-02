import type { ComposeService } from "../types/compose";

/** Allow libuhd to be used inside a container. */
export function prepareContainer(s: ComposeService, mountImages: boolean): void {
  s.privileged = true;

  // /dev/bus/usb must be a bind volume and not in s.devices; putting this in s.devices would
  // cause UHD to report "USB open failed: insufficient permissions" error when the USRP
  // hardware is initialized for the first time after re-plugging, because UHD may reset the
  // USRP hardware from high-speed to SuperSpeed, changing its inode device number
  s.volumes.push({
    type: "bind",
    source: "/dev/bus/usb",
    target: "/dev/bus/usb",
  });

  if (mountImages) {
    s.volumes.push({
      type: "bind",
      source: "/usr/local/share/uhd/images",
      target: "/usr/local/share/uhd/images",
      read_only: true,
    });
  }
}
