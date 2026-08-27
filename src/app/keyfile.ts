/**
 * Titkosított kulcsfájl (.szkulcs).
 *
 * A leképezési tábla — ki kicsoda — a GDPR szerint önmagában is személyes adat:
 * az EDPB szóhasználatával "pszeudonimizálási titok". Ezért soha nem kerül a
 * kimeneti dokumentumba, hanem külön fájlba, jelszóval titkosítva.
 *
 * Hitelesített titkosítás (AES-256-GCM) van benne, nem puszta AES-CBC: így nem
 * lehet a kulcsfájlt észrevétlenül átírni.
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import type { Assignment } from '../pseudonym.js';

const MAGIC = 'SZIVECSKE-KULCS-1';

interface KeyPayload {
  created: string;
  entries: { entityId: string; original: string; replacement: string }[];
}

/** OWASP-hoz igazított scrypt paraméterek: lassú, de egy jelszóhoz elég. */
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, keylen: 32, maxmem: 64 * 1024 * 1024 };

/** A kulcsfájl jelszavának legrövidebb elfogadott hossza. */
export const MIN_PASSPHRASE_LENGTH = 8;

/**
 * A jelszó ellenőrzése — ITT, a bizalmi határ helyes oldalán.
 *
 * Eddig a 8 karakteres minimumot KIZÁRÓLAG a felületi gomb letiltott állapota
 * érvényesítette, az export pedig üres karakterláncot adott tovább, ha nem volt
 * jelszó. A kulcsszármaztatás ezt szó nélkül elfogadta: a fájl formálisan
 * AES-256-GCM-mel titkosított, valójában bárki kinyithatta. Márpedig a
 * leképezési tábla önmagában is személyes adat — a GDPR szerint ez a
 * "pszeudonimizálási titok".
 *
 * Az olvasás is ugyanezt követeli meg, két okból: egy ilyen jelszóval mi soha
 * nem írtunk fájlt, tehát a próbálkozás vagy elgépelés, vagy egy hibás
 * változattal készült fájl — és mindkettő esetben a lassú, 32 MB-os
 * kulcsszármaztatás lefuttatása is fölösleges.
 */
function checkPassphrase(passphrase: string): void {
  if (typeof passphrase !== 'string' || passphrase.trim().length === 0) {
    throw new Error(
      'A kulcsfájl jelszó nélkül nem használható: a leképezési táblát bárki kinyitná vele.',
    );
  }
  if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
    throw new Error(
      `A kulcsfájl jelszavának legalább ${MIN_PASSPHRASE_LENGTH} karakter hosszúnak kell lennie.`,
    );
  }
}

export async function writeKeyFile(
  outputPath: string,
  assignments: Map<string, Assignment>,
  passphrase: string,
): Promise<string> {
  checkPassphrase(passphrase);

  const payload: KeyPayload = {
    created: new Date().toISOString(),
    entries: [...assignments.values()].map((a) => ({
      entityId: a.entityId,
      original: a.original,
      replacement: a.display,
    })),
  };

  const keyPath = `${outputPath.replace(/\.[^.]+$/, '')}.szkulcs`;
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(passphrase, salt, SCRYPT.keylen, SCRYPT);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  const file = {
    magic: MAGIC,
    kdf: 'scrypt',
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: body.toString('base64'),
  };
  writeFileSync(keyPath, JSON.stringify(file, null, 1), 'utf8');
  return keyPath;
}

export function readKeyFile(keyPath: string, passphrase: string): KeyPayload {
  checkPassphrase(passphrase);

  const file = JSON.parse(readFileSync(keyPath, 'utf8')) as Record<string, string | number>;
  if (file.magic !== MAGIC) throw new Error('Ez nem Szivecske kulcsfájl.');
  const key = scryptSync(passphrase, Buffer.from(String(file.salt), 'base64'), SCRYPT.keylen, {
    N: Number(file.N),
    r: Number(file.r),
    p: Number(file.p),
    maxmem: SCRYPT.maxmem,
  });
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(String(file.iv), 'base64'));
  decipher.setAuthTag(Buffer.from(String(file.tag), 'base64'));
  const out = Buffer.concat([decipher.update(Buffer.from(String(file.data), 'base64')), decipher.final()]);
  return JSON.parse(out.toString('utf8')) as KeyPayload;
}
