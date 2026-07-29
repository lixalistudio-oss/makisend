function hexToUint8Array(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}

function uint8ArrayToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function encrypt(
  plainText: string,
  secretKeyHex: string,
): Promise<string> {
  if (!plainText) return "";

  const encodedText = new TextEncoder().encode(plainText);
  const keyData = hexToUint8Array(secretKeyHex);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encryptedBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    cryptoKey,
    encodedText,
  );

  return JSON.stringify({
    iv: uint8ArrayToHex(iv),
    data: uint8ArrayToHex(new Uint8Array(encryptedBuffer)),
  });
}

export async function decrypt(
  encryptedJson: string,
  secretKeyHex: string,
): Promise<string> {
  if (!encryptedJson) return "";

  const { iv, data } = JSON.parse(encryptedJson);
  const ivBuffer = hexToUint8Array(iv);
  const dataBuffer = hexToUint8Array(data);
  const keyData = hexToUint8Array(secretKeyHex);

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );

  const decryptedBuffer = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: ivBuffer },
    cryptoKey,
    dataBuffer,
  );

  return new TextDecoder().decode(decryptedBuffer);
}
