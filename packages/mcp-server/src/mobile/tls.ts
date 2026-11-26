/**
 * Local certificates for the iPhone web app: a CA made on this computer (installed once on the phone)
 * and a server certificate for the computer's LAN addresses, signed by that CA. Nothing leaves the
 * computer. iOS requires SHA-256, RSA >= 2048, subjectAltName, serverAuth and at most 825 days.
 *
 * The CA carries a critical name constraint: it can only vouch for private IPv4 ranges, `localhost`
 * and `.local` names. Even if its key were stolen, it cannot be used to impersonate other websites
 * to the phone. The CA key is encrypted with DPAPI on Windows (keyStore.ts).
 */
import { generateKeyPairSync, X509Certificate } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import forge from "node-forge";
import { keyExists, readKey, writeKey } from "./keyStore";

export interface TlsMaterial {
  key: string;
  cert: string;
  caCert: string;
  /** DER of the CA, served for installation on the phone. */
  caDer: Buffer;
  /** SHA-256 fingerprint of the CA, shown in the app so the user can compare. */
  caFingerprint: string;
}

const DAY = 86_400_000;
/** The CA lasts three years; it is renewed (and must be installed again) 60 days before it expires. */
export const CA_DAYS = 1095;

/** Private ranges the CA may sign for: [address, mask]. */
export const PERMITTED_IP_RANGES: [string, string][] = [
  ["10.0.0.0", "255.0.0.0"],
  ["172.16.0.0", "255.240.0.0"],
  ["192.168.0.0", "255.255.0.0"],
  ["169.254.0.0", "255.255.0.0"],
  ["127.0.0.0", "255.0.0.0"],
];
export const PERMITTED_DNS = ["localhost", "local"];

const ipBytes = (ip: string) => String.fromCharCode(...ip.split(".").map(Number));

/** DER of NameConstraints { permittedSubtrees } (RFC 5280 4.2.1.10): iPAddress [7] and dNSName [2]. */
function nameConstraintsDer(): string {
  const { asn1 } = forge;
  const subtree = (name: forge.asn1.Asn1) => asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [name]);
  const subtrees = [
    ...PERMITTED_IP_RANGES.map(([ip, mask]) => subtree(asn1.create(asn1.Class.CONTEXT_SPECIFIC, 7, false, ipBytes(ip) + ipBytes(mask)))),
    ...PERMITTED_DNS.map((d) => subtree(asn1.create(asn1.Class.CONTEXT_SPECIFIC, 2, false, d))),
  ];
  const permitted = asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, subtrees);
  return asn1.toDer(asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [permitted])).getBytes();
}

/** True when the CA has the name constraint (CAs made before it was added are replaced). */
export function hasNameConstraints(certPem: string): boolean {
  const c = forge.pki.certificateFromPem(certPem);
  return c.extensions.some((e: { id?: string; critical?: boolean }) => e.id === "2.5.29.30" && e.critical === true);
}

function rsaPair(): { privateKey: forge.pki.rsa.PrivateKey; publicKey: forge.pki.rsa.PublicKey; pem: string } {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs1", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
  const priv = forge.pki.privateKeyFromPem(privateKey) as forge.pki.rsa.PrivateKey;
  const pub = forge.pki.setRsaPublicKey(priv.n, priv.e);
  return { privateKey: priv, publicKey: pub, pem: privateKey };
}

const serial = () => {
  const b = forge.random.getBytesSync(16);
  return (0x40 | (b.charCodeAt(0) & 0x3f)).toString(16).padStart(2, "0") + forge.util.bytesToHex(b.slice(1));
};

function makeCa(hostname: string): { keyPem: string; certPem: string } {
  const k = rsaPair();
  const cert = forge.pki.createCertificate();
  cert.publicKey = k.publicKey;
  cert.serialNumber = serial();
  cert.validity.notBefore = new Date(Date.now() - DAY);
  cert.validity.notAfter = new Date(Date.now() + CA_DAYS * DAY);
  const attrs = [
    { name: "commonName", value: `PPM lokal CA (${hostname})` },
    { name: "organizationName", value: "Preventative Private Maintenance" },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: "basicConstraints", cA: true, critical: true },
    { name: "keyUsage", keyCertSign: true, cRLSign: true, critical: true },
    { name: "subjectKeyIdentifier" },
    { id: "2.5.29.30", critical: true, value: nameConstraintsDer() },
  ]);
  cert.sign(k.privateKey, forge.md.sha256.create());
  return { keyPem: k.pem, certPem: forge.pki.certificateToPem(cert) };
}

function makeServerCert(ca: { keyPem: string; certPem: string }, addresses: string[], hostname: string): { keyPem: string; certPem: string } {
  const caKey = forge.pki.privateKeyFromPem(ca.keyPem);
  const caCert = forge.pki.certificateFromPem(ca.certPem);
  const k = rsaPair();
  const cert = forge.pki.createCertificate();
  cert.publicKey = k.publicKey;
  cert.serialNumber = serial();
  cert.validity.notBefore = new Date(Date.now() - DAY);
  cert.validity.notAfter = new Date(Date.now() + 800 * DAY);
  cert.setSubject([{ name: "commonName", value: addresses[0] ?? hostname }]);
  cert.setIssuer(caCert.subject.attributes);
  cert.setExtensions([
    { name: "basicConstraints", cA: false },
    { name: "keyUsage", digitalSignature: true, keyEncipherment: true, critical: true },
    { name: "extKeyUsage", serverAuth: true },
    {
      name: "subjectAltName",
      altNames: [...addresses.map((ip) => ({ type: 7, ip })), { type: 2, value: "localhost" }, { type: 2, value: `${hostname}.local` }],
    },
    { name: "authorityKeyIdentifier", keyIdentifier: caCert.generateSubjectKeyIdentifier().getBytes() },
  ]);
  cert.sign(caKey, forge.md.sha256.create());
  return { keyPem: k.pem, certPem: forge.pki.certificateToPem(cert) };
}

/**
 * Loads or creates the CA and server certificate in `dir`. A new server certificate is made when the
 * LAN addresses changed or it expires within 60 days; the CA is kept, so the phone need not reinstall it.
 * A CA without the name constraint, or expiring within 60 days, is replaced (`caRenewed`); the phone
 * must then install the new certificate.
 */
export function ensureTls(dir: string, lanAddresses: string[], hostname: string): TlsMaterial & { caRenewed: boolean } {
  mkdirSync(dir, { recursive: true });
  // Loopback is always included, so the computer itself (and tests) can reach the server too.
  const addresses = [...new Set([...lanAddresses, "127.0.0.1"])];
  const p = (n: string) => join(dir, n);
  let ca: { keyPem: string; certPem: string } | null = null;
  let caRenewed = false;
  if (keyExists(p("ca.key")) && existsSync(p("ca.crt"))) {
    const certPem = readFileSync(p("ca.crt"), "utf8");
    const keyPem = readKey(p("ca.key"));
    const fresh = Date.parse(new X509Certificate(certPem).validTo) - Date.now() > 60 * DAY;
    if (keyPem && fresh && hasNameConstraints(certPem)) ca = { keyPem, certPem };
    else caRenewed = true;
  }
  if (!ca) {
    ca = makeCa(hostname);
    writeKey(p("ca.key"), ca.keyPem);
    writeFileSync(p("ca.crt"), ca.certPem);
    for (const f of ["server.key", "server.crt", "server.json"]) rmSync(p(f), { force: true });
  }
  const wanted = [...addresses].sort().join(",");
  let server: { keyPem: string; certPem: string } | null = null;
  if (existsSync(p("server.key")) && existsSync(p("server.crt")) && existsSync(p("server.json"))) {
    const meta = JSON.parse(readFileSync(p("server.json"), "utf8")) as { addresses: string };
    const crt = readFileSync(p("server.crt"), "utf8");
    const notAfter = Date.parse(new X509Certificate(crt).validTo);
    if (meta.addresses === wanted && notAfter - Date.now() > 60 * DAY) server = { keyPem: readFileSync(p("server.key"), "utf8"), certPem: crt };
  }
  if (!server) {
    server = makeServerCert(ca, addresses, hostname);
    writeFileSync(p("server.key"), server.keyPem, { mode: 0o600 });
    writeFileSync(p("server.crt"), server.certPem);
    writeFileSync(p("server.json"), JSON.stringify({ addresses: wanted }));
  }
  const x = new X509Certificate(ca.certPem);
  return { key: server.keyPem, cert: server.certPem, caCert: ca.certPem, caDer: x.raw, caFingerprint: x.fingerprint256, caRenewed };
}
