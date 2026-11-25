// Local device lock for BankrDex (passkey via WebAuthn, or a PIN fallback).
// This is a convenience lock on this browser only: wallets still require their own signature
// approval for every transaction. Nothing here is sent to a server.

const STORAGE_KEY_CREDENTIAL = 'bankrdex_biometric_credential';
const STORAGE_KEY_LEGACY_ENROLLED = 'bankrdex_biometric_enrolled';
const STORAGE_KEY_LEGACY_PIN = 'bankrdex_security_pin';
const STORAGE_KEY_PIN_HASH = 'bankrdex_pin_hash';
const STORAGE_KEY_PIN_ATTEMPTS = 'bankrdex_pin_attempts';
const PIN_PATTERN = /^\d{4,6}$/;
const PIN_ITERATIONS = 150_000;
const MAX_PIN_ATTEMPTS = 5;
const PIN_LOCKOUT_MS = 60_000;

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable in private or sandboxed contexts.
  }
}

function toBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  const array = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  array.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(length);
  window.crypto.getRandomValues(bytes);
  return bytes;
}

// Drop plaintext secrets written by older versions (including the old "8888" default).
function clearLegacySecrets(): void {
  writeStorage(STORAGE_KEY_LEGACY_PIN, null);
  writeStorage(STORAGE_KEY_LEGACY_ENROLLED, null);
}

export async function checkBiometricHardwareSupport(): Promise<boolean> {
  if (typeof window === 'undefined' || !window.PublicKeyCredential) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

export function isBiometricEnrolled(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean(readStorage(STORAGE_KEY_CREDENTIAL));
}

export function setBiometricEnrolled(status: boolean): void {
  if (typeof window === 'undefined') return;
  if (!status) writeStorage(STORAGE_KEY_CREDENTIAL, null);
}

// Registers a platform passkey (Touch ID / Face ID / Windows Hello) for this browser.
export async function enrollBiometrics(): Promise<boolean> {
  if (typeof window === 'undefined' || !(await checkBiometricHardwareSupport())) return false;
  try {
    const credential = await navigator.credentials.create({
      publicKey: {
        challenge: randomBytes(32),
        rp: { name: 'BankrDex', id: window.location.hostname },
        user: { id: randomBytes(16), name: 'bankrdex-local', displayName: 'BankrDex device lock' },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'required',
          residentKey: 'discouraged',
        },
        timeout: 60_000,
        attestation: 'none',
      },
    });
    if (!(credential instanceof PublicKeyCredential)) return false;
    writeStorage(STORAGE_KEY_CREDENTIAL, toBase64Url(credential.rawId));
    clearLegacySecrets();
    return true;
  } catch (error) {
    console.info('Passkey registration was cancelled or failed:', error);
    return false;
  }
}

// Returns true only when the registered passkey completes user verification.
// Cancelling, timing out, or an unsupported browser all return false.
export async function authenticateWithBiometrics(): Promise<boolean> {
  const credentialId = typeof window === 'undefined' ? null : readStorage(STORAGE_KEY_CREDENTIAL);
  if (!credentialId || !window.PublicKeyCredential) return false;
  try {
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: randomBytes(32),
        rpId: window.location.hostname,
        allowCredentials: [{ type: 'public-key', id: fromBase64Url(credentialId) }],
        userVerification: 'required',
        timeout: 60_000,
      },
    });
    if (!(assertion instanceof PublicKeyCredential)) return false;
    const response = assertion.response as AuthenticatorAssertionResponse;
    // authenticatorData flags byte (offset 32): bit 0 = user present, bit 2 = user verified.
    const flags = new Uint8Array(response.authenticatorData)[32] ?? 0;
    return toBase64Url(assertion.rawId) === credentialId && (flags & 0x05) === 0x05;
  } catch (error) {
    console.info('Passkey verification was cancelled or failed:', error);
    return false;
  }
}

async function derivePinHash(pin: string, salt: Uint8Array<ArrayBuffer>): Promise<string> {
  const key = await window.crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await window.crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PIN_ITERATIONS },
    key,
    256
  );
  return toBase64Url(bits);
}

export function isValidPin(pin: string): boolean {
  return PIN_PATTERN.test(pin);
}

export function hasPin(): boolean {
  return typeof window !== 'undefined' && Boolean(readStorage(STORAGE_KEY_PIN_HASH));
}

export async function setPin(pin: string): Promise<void> {
  if (!isValidPin(pin)) throw new Error('PIN must be 4 to 6 digits.');
  const salt = randomBytes(16);
  const hash = await derivePinHash(pin, salt);
  writeStorage(STORAGE_KEY_PIN_HASH, `${toBase64Url(salt)}.${hash}`);
  writeStorage(STORAGE_KEY_PIN_ATTEMPTS, null);
  clearLegacySecrets();
}

export function clearPin(): void {
  writeStorage(STORAGE_KEY_PIN_HASH, null);
  writeStorage(STORAGE_KEY_PIN_ATTEMPTS, null);
}

export type PinCheckResult =
  | { ok: true }
  | { ok: false; reason: 'no-pin' | 'invalid' | 'locked'; retryAfterMs?: number; attemptsLeft?: number };

export async function verifyPin(pin: string): Promise<PinCheckResult> {
  const stored = readStorage(STORAGE_KEY_PIN_HASH);
  if (!stored) return { ok: false, reason: 'no-pin' };

  const [failures, lockedUntil] = (readStorage(STORAGE_KEY_PIN_ATTEMPTS) || '0:0').split(':').map(Number);
  const now = Date.now();
  if (lockedUntil > now) return { ok: false, reason: 'locked', retryAfterMs: lockedUntil - now };

  const [salt, expectedHash] = stored.split('.');
  const matches = isValidPin(pin) && salt && expectedHash
    ? await derivePinHash(pin, fromBase64Url(salt)) === expectedHash
    : false;
  if (matches) {
    writeStorage(STORAGE_KEY_PIN_ATTEMPTS, null);
    return { ok: true };
  }

  const nextFailures = (Number.isFinite(failures) ? failures : 0) + 1;
  if (nextFailures >= MAX_PIN_ATTEMPTS) {
    writeStorage(STORAGE_KEY_PIN_ATTEMPTS, `0:${now + PIN_LOCKOUT_MS}`);
    return { ok: false, reason: 'locked', retryAfterMs: PIN_LOCKOUT_MS };
  }
  writeStorage(STORAGE_KEY_PIN_ATTEMPTS, `${nextFailures}:0`);
  return { ok: false, reason: 'invalid', attemptsLeft: MAX_PIN_ATTEMPTS - nextFailures };
}
