import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { X509Certificate } from "node:crypto";
import forge from "node-forge";
import { ensureTls, hasNameConstraints } from "../src/mobile/tls";
import { dpapiAvailable, protectWithDpapi, readKey, unprotectWithDpapi, writeKey } from "../src/mobile/keyStore";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "ppm-tls-"));
  dirs.push(d);
  return d;
};
const hasOpenssl = (() => {
  try {
    execFileSync("openssl", ["version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

describe("local CA for the phone", () => {
  it("is name-constrained to private networks, localhost and .local, and lasts at most three years", () => {
    const dir = tmp();
    const t = ensureTls(dir, ["192.168.1.23"], "pc");
    expect(t.caRenewed).toBe(false);
    expect(hasNameConstraints(t.caCert)).toBe(true);
    const ca = forge.pki.certificateFromPem(t.caCert);
    expect((ca.validity.notAfter.getTime() - Date.now()) / 86_400_000).toBeLessThanOrEqual(1095);
    if (hasOpenssl) {
      const text = execFileSync("openssl", ["x509", "-noout", "-text", "-in", join(dir, "ca.crt")], { encoding: "utf8" });
      expect(text).toMatch(/Name Constraints: critical/);
      for (const r of ["IP:10.0.0.0/255.0.0.0", "IP:172.16.0.0/255.240.0.0", "IP:192.168.0.0/255.255.0.0", "DNS:localhost", "DNS:local"]) expect(text).toContain(r);
      // The server certificate is valid under the constraint …
      expect(execFileSync("openssl", ["verify", "-CAfile", join(dir, "ca.crt"), join(dir, "server.crt")], { encoding: "utf8" })).toContain("OK");
    }
  });

  it.skipIf(!hasOpenssl)("cannot vouch for a public website even with its key", () => {
    const dir = tmp();
    ensureTls(dir, ["192.168.1.23"], "pc");
    const caKey = forge.pki.privateKeyFromPem(readKey(join(dir, "ca.key"))!);
    const caCert = forge.pki.certificateFromPem(readFileSync(join(dir, "ca.crt"), "utf8"));
    const keys = forge.pki.rsa.generateKeyPair(1024);
    const fake = forge.pki.createCertificate();
    fake.publicKey = keys.publicKey;
    fake.serialNumber = "01";
    fake.validity.notBefore = new Date(Date.now() - 86_400_000);
    fake.validity.notAfter = new Date(Date.now() + 86_400_000);
    fake.setSubject([{ name: "commonName", value: "www.example.com" }]);
    fake.setIssuer(caCert.subject.attributes);
    fake.setExtensions([{ name: "subjectAltName", altNames: [{ type: 2, value: "www.example.com" }, { type: 7, ip: "8.8.8.8" }] }]);
    fake.sign(caKey, forge.md.sha256.create());
    writeFileSync(join(dir, "fake.crt"), forge.pki.certificateToPem(fake));
    let out = "";
    try {
      out = execFileSync("openssl", ["verify", "-CAfile", join(dir, "ca.crt"), join(dir, "fake.crt")], { encoding: "utf8", stdio: "pipe" });
    } catch (e) {
      out = String((e as { stdout?: string; stderr?: string }).stderr ?? "") + String((e as { stdout?: string }).stdout ?? "");
    }
    expect(out).toMatch(/permitted subtree violation|name constraints/i);
  });

  it("replaces an older CA without the name constraint and makes a new server certificate", () => {
    const dir = tmp();
    // An unconstrained CA as made before the constraint was added.
    const keys = forge.pki.rsa.generateKeyPair(1024);
    const old = forge.pki.createCertificate();
    old.publicKey = keys.publicKey;
    old.serialNumber = "02";
    old.validity.notBefore = new Date(Date.now() - 86_400_000);
    old.validity.notAfter = new Date(Date.now() + 3650 * 86_400_000);
    old.setSubject([{ name: "commonName", value: "PPM lokal CA (pc)" }]);
    old.setIssuer([{ name: "commonName", value: "PPM lokal CA (pc)" }]);
    old.setExtensions([{ name: "basicConstraints", cA: true, critical: true }]);
    old.sign(keys.privateKey, forge.md.sha256.create());
    writeKey(join(dir, "ca.key"), forge.pki.privateKeyToPem(keys.privateKey));
    writeFileSync(join(dir, "ca.crt"), forge.pki.certificateToPem(old));
    writeFileSync(join(dir, "server.json"), JSON.stringify({ addresses: "192.168.1.23" }));
    const t = ensureTls(dir, ["192.168.1.23"], "pc");
    expect(t.caRenewed).toBe(true);
    expect(hasNameConstraints(t.caCert)).toBe(true);
    expect(ensureTls(dir, ["192.168.1.23"], "pc").caRenewed).toBe(false);
  });

  it("keeps the CA key encrypted with DPAPI on Windows and readable only by the user elsewhere", () => {
    const dir = tmp();
    ensureTls(dir, ["192.168.1.23"], "pc");
    if (dpapiAvailable()) {
      expect(existsSync(join(dir, "ca.key"))).toBe(false);
      const blob = readFileSync(join(dir, "ca.key.dpapi"), "utf8");
      expect(blob).not.toContain("PRIVATE KEY");
      expect(unprotectWithDpapi(protectWithDpapi("hemmelig"))).toBe("hemmelig");
    } else {
      expect(readFileSync(join(dir, "ca.key"), "utf8")).toContain("PRIVATE KEY");
      if (process.platform !== "win32") expect(statSync(join(dir, "ca.key")).mode & 0o077).toBe(0);
    }
    expect(readKey(join(dir, "ca.key"))).toContain("PRIVATE KEY");
  });
});

describe("unreadable CA key", () => {
  it("makes a new CA instead of failing, and always covers 127.0.0.1", () => {
    const dir = tmp();
    const first = ensureTls(dir, ["10.1.0.65"], "pc");
    expect(new X509Certificate(first.cert).subjectAltName).toContain("IP Address:127.0.0.1");
    expect(new X509Certificate(first.cert).subjectAltName).toContain("IP Address:10.1.0.65");
    // A damaged or foreign key file (on Windows: a DPAPI blob for another user).
    if (dpapiAvailable()) writeFileSync(join(dir, "ca.key.dpapi"), "AQAAANCMnd8BFdERjHoAwE/Cl+s=");
    else writeFileSync(join(dir, "ca.key"), "ødelagt");
    const second = ensureTls(dir, ["10.1.0.65"], "pc");
    expect(second.caRenewed).toBe(true);
    expect(second.caFingerprint).not.toBe(first.caFingerprint);
  });
});
