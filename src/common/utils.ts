// utils.ts
import sanitizeHtml from "sanitize-html";
// --- Helper Functions (Pure JS, no Node Buffer needed) ---

// Converts a Hex string (like your env variable) into raw bytes (Uint8Array)
function hexToUint8Array(hex: string): Uint8Array {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
    }
    return bytes;
}

// Converts raw bytes back into a Hex string
function uint8ArrayToHex(bytes: Uint8Array): string {
    return Array.from(bytes)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}


// --- The Main Functions ---

/**
 * Encrypts plain text for database storage
 */
export async function encrypt(plainText: string, secretKeyHex: string): Promise<string> {
    if (!plainText) return "";

    // STEP 1: Translate Text to Binary
    const encodedText = new TextEncoder().encode(plainText);

    // STEP 2: Import the Secret Key
    const keyData = hexToUint8Array(secretKeyHex);
    const cryptoKey = await crypto.subtle.importKey(
        "raw",
        keyData,
        { name: "AES-GCM", length: 256 },
        false, // Cannot be exported out of memory (secure)
        ["encrypt", "decrypt"]
    );

    // STEP 3: Generate the IV (12 random bytes)
    const iv = crypto.getRandomValues(new Uint8Array(12));

    // STEP 4: Execute the Encryption
    // Note: Web Crypto automatically calculates and attaches the Auth Tag 
    // to the end of this output buffer!
    const encryptedBuffer = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: iv },
        cryptoKey,
        encodedText
    );

    // FINAL PACKAGING: Combine IV and Ciphertext into a JSON string for your DB
    return JSON.stringify({
        iv: uint8ArrayToHex(iv),
        data: uint8ArrayToHex(new Uint8Array(encryptedBuffer))
    });
}

/**
 * Decrypts the JSON string back to plain text
 */
export async function decrypt(encryptedJson: string, secretKeyHex: string): Promise<string> {
    if (!encryptedJson) return "";

    // STEP 1: Unpackage the Data
    const { iv, data } = JSON.parse(encryptedJson);
    const ivBuffer = hexToUint8Array(iv);
    const dataBuffer = hexToUint8Array(data);

    // STEP 2: Import the Secret Key
    const keyData = hexToUint8Array(secretKeyHex);
    const cryptoKey = await crypto.subtle.importKey(
        "raw",
        keyData,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
    );

    // STEP 3 & 4: Execute Decryption (and verify Auth Tag automatically)
    const decryptedBuffer = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: ivBuffer },
        cryptoKey,
        dataBuffer
    );

    // STEP 5: Translate Binary back to Text
    return new TextDecoder().decode(decryptedBuffer);
}

 // Set the different allowed email tags for the email sending
    const allowedEmailTags = [
      // Typography & Headings
      "h1", "h2", "h3", "h4", "h5", "h6", "p", "br", "hr", "pre", "code",
      
      // Layout & Container Elements
      "div", "address", "blockquote",
      
      // Table Elements (Crucial for Email Layouts)
      "table", "tbody", "thead", "tfoot", "tr", "td", "th", "col", "colgroup", "caption",
      
      // Links
      "a",
      
      // Lists
      "ul", "ol", "li", "dl", "dt", "dd",
      
      // Inline Formatting & Semantic Emphasis
      "span", "strong", "b", "em", "i", "u", "s", "small", "sub", "sup", 
      "abbr", "cite", "data", "dfn", "kbd", "mark", "q", "samp", "time", "var",

      // Semantic Modern Structural Elements (Supported by modern webmail, falls back gracefully to div-like behavior in Outlook)
      "article", "aside", "footer", "header", "main", "section"
    ];
    export function cleanHtml(html: string): string
    {
        const cleanedHtml = sanitizeHtml(html, 
    {
      allowedTags: allowedEmailTags,
      allowedAttributes: {
        'a': [ 'href' ]
      },
      allowedIframeHostnames: ['www.youtube.com']
    }); // Sanitize and scrub untrusted HTML from the incoming request payload
      return cleanedHtml
    }
   