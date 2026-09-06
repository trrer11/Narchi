/** §246 native WebAuthn — kein Extra-NPM-Paket. */

function b64urlToBuf(s: string): ArrayBuffer {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

function bufToB64url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function passkeysSupported(): boolean {
  return typeof window !== "undefined" && typeof window.PublicKeyCredential === "function";
}

function publicKeyFromOptions(opts: Record<string, unknown>): PublicKeyCredentialCreationOptions {
  const user = opts.user as { id: string; name: string; displayName: string };
  const rp = opts.rp as { id: string; name: string };
  return {
    rp,
    user: { id: b64urlToBuf(user.id), name: user.name, displayName: user.displayName },
    challenge: b64urlToBuf(String(opts.challenge)),
    pubKeyCredParams: opts.pubKeyCredParams as PublicKeyCredentialParameters[],
    timeout: Number(opts.timeout) || 120000,
    authenticatorSelection: opts.authenticatorSelection as AuthenticatorSelectionCriteria,
    attestation: "none",
  };
}

export function credentialToJson(cred: PublicKeyCredential): Record<string, unknown> {
  const att = cred.response as AuthenticatorAttestationResponse | AuthenticatorAssertionResponse;
  const base: Record<string, unknown> = {
    id: cred.id,
    rawId: bufToB64url(cred.rawId),
    type: cred.type,
    response: {},
  };
  const resp: Record<string, unknown> = {
    clientDataJSON: bufToB64url(att.clientDataJSON),
  };
  if ("attestationObject" in att) {
    resp.attestationObject = bufToB64url((att as AuthenticatorAttestationResponse).attestationObject);
  }
  if ("authenticatorData" in att) {
    const asr = att as AuthenticatorAssertionResponse;
    resp.authenticatorData = bufToB64url(asr.authenticatorData);
    resp.signature = bufToB64url(asr.signature);
    if (asr.userHandle) resp.userHandle = bufToB64url(asr.userHandle);
  }
  base.response = resp;
  return base;
}

export { publicKeyFromOptions, b64urlToBuf, bufToB64url };
