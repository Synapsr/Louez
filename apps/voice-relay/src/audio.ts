// G.711 mu-law decode for local interruption detection only. Audio sent to
// OpenAI/Twilio stays PCMU/8 kHz: no lossy transcoding or container headers.
export function mulawRms(bytes: Uint8Array): number {
  if (!bytes.length) return 0;
  let energy = 0;
  for (const byte of bytes) {
    const value = ~byte & 255;
    let sample = (((value & 15) << 3) + 132) << ((value & 112) >> 4);
    sample = value & 128 ? 132 - sample : sample - 132;
    energy += sample * sample;
  }
  return Math.sqrt(energy / bytes.length);
}

export class InterruptionDetector {
  private speechMs = 0;
  private quietMs = 0;
  private speaking = false;
  constructor(private readonly threshold: number) {}
  push(bytes: Uint8Array): boolean {
    const ms = bytes.length / 8;
    if (mulawRms(bytes) >= this.threshold) {
      this.speechMs += ms;
      this.quietMs = 0;
      if (!this.speaking && this.speechMs >= 120) {
        this.speaking = true;
        return true;
      }
    } else {
      this.quietMs += ms;
      if (this.quietMs >= 350) {
        this.speaking = false;
        this.speechMs = 0;
      }
    }
    return false;
  }
}

export function pcmWav(bytes: Buffer, rate = 24000): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + bytes.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(bytes.length, 40);
  return Buffer.concat([header, bytes]);
}
