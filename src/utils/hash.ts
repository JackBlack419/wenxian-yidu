/**
 * hash — WebCrypto digest helpers shared by the JVM-based components.
 *
 * Both JavaRuntimeManager (downloaded JRE archives) and
 * OpenDataLoaderPdfClient (jars unpacked from a packed XPI install) verify
 * SHA-256 digests; this is the single implementation so the two callers can
 * never drift (different casing, different null-handling).
 */

import { safeDebug } from "./logger";

/**
 * Lowercase hex SHA-256 of `data`, or null when WebCrypto is unavailable
 * (callers treat null as "cannot verify" and degrade to accept-with-log).
 */
export async function sha256Hex(data: Uint8Array): Promise<string | null> {
  try {
    const subtle = (globalThis as any).crypto?.subtle;
    if (!subtle?.digest) return null;
    const digest = new Uint8Array(await subtle.digest("SHA-256", data));
    let hex = "";
    for (let i = 0; i < digest.length; i++) {
      hex += digest[i].toString(16).padStart(2, "0");
    }
    return hex;
  } catch (e) {
    safeDebug("[文献译读] hash: " + e);
    return null;
  }
}
