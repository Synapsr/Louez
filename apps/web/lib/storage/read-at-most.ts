/**
 * The first `maxBytes` bytes of a stored object's body, which announced
 * `announced` bytes. The body is cancelled once read, whatever happened, so a
 * store that ignores the requested range never makes the app hold more. A
 * body that ends before what it announced (up to `maxBytes`) was cut: an
 * error, never a shorter file. The bytes kept are copied into one array of
 * their own, so no larger chunk stays referenced.
 */
export async function readAtMost(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
  announced: number,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let length = 0;
  const reader = body.getReader();
  try {
    while (length < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      const kept = value.subarray(0, maxBytes - length);
      chunks.push(kept);
      length += kept.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  if (length < Math.min(announced, maxBytes)) {
    throw new Error(`The stored object's body ended after ${length} of ${announced} bytes.`);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
