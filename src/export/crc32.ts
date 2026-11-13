/** Table-driven CRC-32 (polynomial 0xedb88320, as zip uses) over a list of chunks. */

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC-32 of the concatenation of `chunks`, as an unsigned 32-bit value. */
export function crc32(chunks: readonly Uint8Array[]): number {
  let c = 0xffffffff;
  for (const u8 of chunks) {
    for (let i = 0, n = u8.length; i < n; i++) c = TABLE[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}
