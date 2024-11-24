import { AddressInfo } from "net";

export function formatFullAddr(
  family: string | undefined | null,
  host: string | undefined,
  port: number | string | undefined | null
) {
  const segs: string[] = [];
  if (family) {
    segs.push(family);
  }
  if (host) {
    if (family === "IPv6") {
      segs.push(`[${host}]`);
    } else {
      segs.push(host);
    }
  }
  if (port !== undefined && port !== null) {
    segs.push(String(port));
  }
  return segs.join(":");
}

export function formatAddrInfo(addr: AddressInfo | string | undefined | null) {
  if (addr === null || addr === undefined) {
    return "<unknown>";
  }

  if (typeof addr === "string") {
    return addr;
  }

  return formatFullAddr(addr.family, addr.address, addr.port);
}
