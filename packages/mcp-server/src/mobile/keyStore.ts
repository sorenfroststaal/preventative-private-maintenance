/**
 * Keeps the local CA's private key at rest. On Windows the key is encrypted with DPAPI for the
 * current Windows user (via PowerShell's ProtectedData), so a copied file is useless on another
 * account or computer. Elsewhere the key is a file only the user can read (mode 0600).
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const PS = (script: string, input: string): string =>
  execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { input, encoding: "utf8", windowsHide: true }).trim();

const PROTECT = "Add-Type -AssemblyName System.Security; $b=[Text.Encoding]::UTF8.GetBytes([Console]::In.ReadToEnd()); [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($b,$null,'CurrentUser'))";
const UNPROTECT = "Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()); [Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect($b,$null,'CurrentUser'))";

export const dpapiAvailable = () => process.platform === "win32";

export function protectWithDpapi(text: string): string {
  return PS(PROTECT, text);
}
export function unprotectWithDpapi(b64: string): string {
  return PS(UNPROTECT, b64);
}

/** Writes the key: `<base>.dpapi` on Windows, otherwise `<base>` with mode 0600. Removes the other form. */
export function writeKey(base: string, pem: string): void {
  if (dpapiAvailable()) {
    writeFileSync(`${base}.dpapi`, protectWithDpapi(pem), { mode: 0o600 });
    rmSync(base, { force: true });
  } else writeFileSync(base, pem, { mode: 0o600 });
}

/**
 * Reads the key, or null when there is none or it cannot be decrypted (another Windows user, a restored
 * profile); the caller then makes a new CA. A plain key found on Windows is encrypted in place.
 */
export function readKey(base: string): string | null {
  if (dpapiAvailable() && existsSync(`${base}.dpapi`)) {
    try {
      const pem = unprotectWithDpapi(readFileSync(`${base}.dpapi`, "utf8"));
      return pem.includes("PRIVATE KEY") ? pem : null;
    } catch {
      return null;
    }
  }
  if (!existsSync(base)) return null;
  const pem = readFileSync(base, "utf8");
  if (dpapiAvailable()) writeKey(base, pem);
  return pem;
}

export const keyExists = (base: string) => existsSync(base) || (dpapiAvailable() && existsSync(`${base}.dpapi`));
