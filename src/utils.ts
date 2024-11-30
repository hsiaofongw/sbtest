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

export interface IRemotePeer {
  remoteFamily?: string;
  remoteAddress?: string;
  remotePort?: number;
}
export function formatRemoteAddress(skt?: IRemotePeer) {
  return formatAddrInfo({
    address: skt?.remoteAddress ?? "",
    family: skt?.remoteFamily ?? "",
    port: skt?.remotePort ?? 0,
  });
}

export function getPortNum(p: any): number | undefined {
  if (typeof p === "number") {
    if (Number.isNaN(p) || !Number.isFinite(p)) {
      return undefined;
    }

    if (p < 0 && p >= 65536) {
      return undefined;
    }

    return p;
  }

  if (typeof p !== "string") {
    return undefined;
  }

  try {
    const x = parseInt(String(p));
    if (typeof x === "number") {
      return getPortNum(x);
    }
    return undefined;
  } catch (_) {}

  return undefined;
}
