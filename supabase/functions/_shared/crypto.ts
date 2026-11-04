const encoder = new TextEncoder();

export function randomToken(bytes = 32): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), b => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

export function sameValue(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

async function derive(password: string, salt: string, iterations: number, algorithm = 'SHA-256'): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({name: 'PBKDF2', salt: encoder.encode(salt), iterations, hash: algorithm}, key, algorithm === 'SHA-1' ? 160 : 256);
  return btoa(String.fromCharCode(...new Uint8Array(bits)));
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomToken(16);
  const iterations = 1000000;
  return `pbkdf2_sha256$${iterations}$${salt}$${await derive(password, salt, iterations)}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, count, salt, expected, extra] = encoded.split('$');
  const iterations = Number(count);
  if (extra || !salt || !expected || !Number.isInteger(iterations) || iterations < 1 || iterations > 10000000) return false;
  if (!['pbkdf2_sha256', 'pbkdf2_sha1'].includes(algorithm)) return false;
  return sameValue(await derive(password, salt, iterations, algorithm === 'pbkdf2_sha1' ? 'SHA-1' : 'SHA-256'), expected);
}
