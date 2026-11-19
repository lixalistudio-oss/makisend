/**
 * The 1x1 transparent GIF the pixel route always answers with (42 bytes): a GIF89a header, a
 * 1x1 logical screen with a 2-color table, a graphic control extension marking color 0 as
 * transparent, one image block, and the 0x3B trailer. Decoded once, when the module loads.
 */
const TRANSPARENT_GIF_BASE64 = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

export const TRANSPARENT_GIF: Uint8Array = Uint8Array.from(atob(TRANSPARENT_GIF_BASE64), (char) =>
  char.charCodeAt(0),
);
