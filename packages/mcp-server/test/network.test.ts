import { describe, expect, it } from "vitest";
import { isVirtualAdapter, lanAddresses, networkKey, parseLinuxGateway, parseWindowsGateway } from "../src/mobile/network";

const v4 = (address: string) => ({ address, family: "IPv4" as const, internal: false, netmask: "255.255.255.0", mac: "00:00:00:00:00:00", cidr: null });

describe("which network the computer is on (review E2)", () => {
  it("ignores virtual adapters (Hyper-V/WSL, VirtualBox, Docker, VPN) and link-local addresses", () => {
    expect(["vEthernet (WSL)", "VirtualBox Host-Only Network", "docker0", "br-1a2b", "vboxnet0", "Tailscale", "VMware Network Adapter VMnet8"].every(isVirtualAdapter)).toBe(true);
    expect(["Wi-Fi", "Ethernet", "wlan0", "eth0", "en0"].some(isVirtualAdapter)).toBe(false);
    const addrs = lanAddresses({
      "Wi-Fi": [v4("192.168.1.23")],
      "vEthernet (WSL)": [v4("172.20.48.1")],
      "VirtualBox Host-Only Network": [v4("192.168.56.1")],
      Ethernet: [v4("169.254.10.2"), v4("8.8.8.8")],
    } as never);
    expect(addrs).toEqual(["192.168.1.23"]);
  });

  it("finds the default gateway and its MAC on Linux", () => {
    const route = "Iface\tDestination\tGateway \tFlags\tRefCnt\tUse\tMetric\tMask\nwlan0\t00000000\t0101A8C0\t0003\t0\t0\t600\t00000000\nwlan0\t0001A8C0\t00000000\t0001\t0\t0\t600\t00FFFFFF\n";
    const arp = "IP address       HW type     Flags       HW address            Mask     Device\n192.168.1.1      0x1         0x2         AA:BB:CC:DD:EE:FF     *        wlan0\n";
    const gw = parseLinuxGateway(route, arp);
    expect(gw).toEqual({ ip: "192.168.1.1", mac: "aa:bb:cc:dd:ee:ff", iface: "wlan0" });
    expect(networkKey(gw)).toBe("router:aa:bb:cc:dd:ee:ff");
    // A default route only through Docker is not a home network.
    expect(parseLinuxGateway("Iface\tDestination\tGateway\tFlags\ndocker0\t00000000\t010011AC\t0003\n", "")).toBeNull();
    // Without a MAC the network cannot be told, so there is no autostart.
    expect(networkKey(parseLinuxGateway(route, ""))).toBeNull();
  });

  it("reads the gateway from PowerShell on Windows", () => {
    expect(parseWindowsGateway('{"ip":"192.168.1.1","iface":"Wi-Fi","mac":"AA-BB-CC-DD-EE-FF"}')).toEqual({ ip: "192.168.1.1", mac: "aa:bb:cc:dd:ee:ff", iface: "Wi-Fi" });
    expect(parseWindowsGateway('{"ip":"172.20.48.1","iface":"vEthernet (WSL)","mac":"00-15-5D-00-00-01"}')).toBeNull();
    expect(networkKey(parseWindowsGateway('{"ip":"192.168.1.1","iface":"Wi-Fi","mac":"00-00-00-00-00-00"}'))).toBeNull();
    expect(parseWindowsGateway("{}")).toBeNull();
    expect(parseWindowsGateway("ikke json")).toBeNull();
  });
});
