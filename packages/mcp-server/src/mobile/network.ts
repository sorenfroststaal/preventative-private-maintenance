/**
 * Which network the computer is on (review E2). Mobile access only starts by itself on a network the
 * user turned it on at. The network is recognised by the router: the default gateway's MAC address
 * (from the ARP table), so another café or hotel with the same address range does not match.
 * Virtual adapters (Hyper-V/WSL, VirtualBox, VMware, Docker, VPN) are ignored.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { isLanAddress } from "@ppm/core";

const VIRTUAL = /vethernet|virtualbox|vboxnet|vmware|vmnet|hyper-v|wsl|docker|^br-|^veth|^virbr|tailscale|zerotier|wireguard|^wg\d|^tun|^tap|^utun|loopback|npcap|bluetooth/i;
export const isVirtualAdapter = (name: string) => VIRTUAL.test(name);

/** Private IPv4 addresses on physical adapters (what the phone can reach and what the QR codes show). */
export function lanAddresses(ifaces: ReturnType<typeof networkInterfaces> = networkInterfaces()): string[] {
  const out: string[] = [];
  for (const [name, list] of Object.entries(ifaces)) {
    if (isVirtualAdapter(name)) continue;
    for (const i of list ?? []) if (i.family === "IPv4" && !i.internal && isLanAddress(i.address) && !i.address.startsWith("169.254.")) out.push(i.address);
  }
  return [...new Set(out)];
}

export interface Gateway {
  ip: string;
  mac: string | null;
  iface: string | null;
}

/** Linux: the default route in /proc/net/route (little-endian hex) and its MAC in /proc/net/arp. */
export function parseLinuxGateway(route: string, arp: string): Gateway | null {
  for (const line of route.split("\n").slice(1)) {
    const [iface, dest, gw, flags] = line.trim().split(/\s+/);
    if (!iface || dest !== "00000000" || !gw || gw === "00000000" || !(Number.parseInt(flags ?? "0", 16) & 2)) continue;
    if (isVirtualAdapter(iface)) continue;
    const ip = [6, 4, 2, 0].map((i) => Number.parseInt(gw.slice(i, i + 2), 16)).join(".");
    const row = arp.split("\n").find((l) => l.trim().split(/\s+/)[0] === ip);
    const mac = row?.trim().split(/\s+/)[3] ?? null;
    return { ip, mac: mac && mac !== "00:00:00:00:00:00" ? mac.toLowerCase() : null, iface };
  }
  return null;
}

/** Windows: JSON from Get-NetRoute/Get-NetNeighbor (see GATEWAY_PS). */
export function parseWindowsGateway(json: string): Gateway | null {
  try {
    const v = JSON.parse(json) as { ip?: string; mac?: string | null; iface?: string | null };
    if (!v.ip || v.ip === "0.0.0.0") return null;
    if (v.iface && isVirtualAdapter(v.iface)) return null;
    const mac = v.mac && !/^(00-){5}00$/.test(v.mac) ? v.mac.replace(/-/g, ":").toLowerCase() : null;
    return { ip: v.ip, mac, iface: v.iface ?? null };
  } catch {
    return null;
  }
}

const GATEWAY_PS =
  "$r = Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Where-Object { $_.NextHop -ne '0.0.0.0' -and $_.InterfaceAlias -notmatch 'vEthernet|VirtualBox|VMware|WSL|Hyper-V|Tailscale|ZeroTier|WireGuard|Bluetooth' } | Sort-Object { $_.RouteMetric + $_.InterfaceMetric } | Select-Object -First 1; " +
  "if ($r) { $n = Get-NetNeighbor -IPAddress $r.NextHop -ErrorAction SilentlyContinue | Select-Object -First 1; @{ ip = $r.NextHop; iface = $r.InterfaceAlias; mac = $n.LinkLayerAddress } | ConvertTo-Json -Compress } else { '{}' }";

export function defaultGateway(): Gateway | null {
  try {
    if (process.platform === "linux" && existsSync("/proc/net/route")) return parseLinuxGateway(readFileSync("/proc/net/route", "utf8"), existsSync("/proc/net/arp") ? readFileSync("/proc/net/arp", "utf8") : "");
    if (process.platform === "win32") return parseWindowsGateway(execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", GATEWAY_PS], { encoding: "utf8", windowsHide: true, timeout: 15_000 }));
  } catch {
    // Unknown network: autostart stays off.
  }
  return null;
}

/** A key for the current network: the router's MAC, or null when it cannot be told (then no autostart). */
export function networkKey(gw: Gateway | null = defaultGateway()): string | null {
  return gw?.mac ? `router:${gw.mac}` : null;
}
