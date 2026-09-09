import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import { appSecret, sha256Hex } from "../utils/hash.ts";

/**
 * Šifrování zákaznických přístupových údajů — AES-256-GCM.
 *
 * Klíč: CREDENTIALS_ENCRYPTION_KEY (32 bajtů hex). V demo režimu se
 * odvodí z APP_SECRET, aby šlo aplikaci vyzkoušet; v produkci je
 * povinný a odvození se odmítne.
 *
 * Do databáze jde jen ciphertext (marketing.integration_secrets) a otisk.
 * Do logů a do prohlížeče nikdy nic z toho.
 */
function key(): Buffer {
  const hex = process.env.CREDENTIALS_ENCRYPTION_KEY;
  if (hex && /^[0-9a-f]{64}$/i.test(hex)) return Buffer.from(hex, "hex");
  if (process.env.APP_MODE === "production") {
    throw new Error("CREDENTIALS_ENCRYPTION_KEY musí být v produkci nastavený (64 hex znaků).");
  }
  return createHash("sha256").update("credentials:" + appSecret()).digest();
}

export function encryptCredentials(data: Record<string, string>): { ciphertext: string; fingerprint: string } {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const plain = Buffer.from(JSON.stringify(data), "utf8");
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${enc.toString("base64url")}`,
    fingerprint: fingerprintOf(data),
  };
}

export function decryptCredentials(ciphertext: string | null | undefined): Record<string, string> {
  if (!ciphertext) return {};
  const [v, ivB, tagB, encB] = ciphertext.split(".");
  if (v !== "v1" || !ivB || !tagB || !encB) throw new Error("Neplatný formát uložených údajů");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB, "base64url"));
  const dec = Buffer.concat([decipher.update(Buffer.from(encB, "base64url")), decipher.final()]);
  return JSON.parse(dec.toString("utf8")) as Record<string, string>;
}

/** Otisk pro porovnání „stejný klíč?“ — nikdy z něj nejde klíč zpět. */
export function fingerprintOf(data: Record<string, string>): string {
  const main = data.api_key ?? data.access_token ?? data.secret ?? JSON.stringify(data);
  return sha256Hex(main).slice(0, 16);
}

/** Zobrazitelný zbytek klíče: '…a1b2'. Celý klíč se po uložení už neukazuje. */
export function maskovat(value: string): string {
  if (!value) return "";
  return `…${value.slice(-4)}`;
}
