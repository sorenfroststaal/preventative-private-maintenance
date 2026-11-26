/**
 * Local certificates for the iPhone web app: a CA made on this computer (installed once on the phone)
 * and a server certificate for the computer's LAN addresses, signed by that CA. Nothing leaves the
 * computer. iOS requires SHA-256, RSA >= 2048, subjectAltName, serverAuth and at most 825 days.
 */
import { generateKeyPairSync, X509Certificate } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import forge from "node-forge";

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
  cert.validity.notAfter = new Date(Date.now() + 3650 * DAY);
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
 */
export function ensureTls(dir: string, addresses: string[], hostname: string): TlsMaterial {
  mkdirSync(dir, { recursive: true });
  const p = (n: string) => join(dir, n);
  let ca: { keyPem: string; certPem: string };
  if (existsSync(p("ca.key")) && existsSync(p("ca.crt"))) ca = { keyPem: readFileSync(p("ca.key"), "utf8"), certPem: readFileSync(p("ca.crt"), "utf8") };
  else {
    ca = makeCa(hostname);
    writeFileSync(p("ca.key"), ca.keyPem, { mode: 0o600 });
    writeFileSync(p("ca.crt"), ca.certPem);
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
  return { key: server.keyPem, cert: server.certPem, caCert: ca.certPem, caDer: x.raw, caFingerprint: x.fingerprint256 };
}
