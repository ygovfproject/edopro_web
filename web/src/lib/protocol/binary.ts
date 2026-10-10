// Little-endian binary reader/writer used by the packet codecs.

export class Reader {
  readonly view: DataView;
  off: number;

  constructor(data: Uint8Array, off = 0) {
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    this.off = off;
  }

  get length() {
    return this.view.byteLength;
  }
  get avail() {
    return this.view.byteLength - this.off;
  }
  private need(n: number) {
    if (this.avail < n) throw new RangeError(`buffer underflow: need ${n}, have ${this.avail}`);
  }
  u8() {
    this.need(1);
    return this.view.getUint8(this.off++);
  }
  i8() {
    this.need(1);
    return this.view.getInt8(this.off++);
  }
  u16() {
    this.need(2);
    const v = this.view.getUint16(this.off, true);
    this.off += 2;
    return v;
  }
  i16() {
    this.need(2);
    const v = this.view.getInt16(this.off, true);
    this.off += 2;
    return v;
  }
  u32() {
    this.need(4);
    const v = this.view.getUint32(this.off, true);
    this.off += 4;
    return v;
  }
  i32() {
    this.need(4);
    const v = this.view.getInt32(this.off, true);
    this.off += 4;
    return v;
  }
  u64() {
    this.need(8);
    const v = this.view.getBigUint64(this.off, true);
    this.off += 8;
    return v;
  }
  skip(n: number) {
    this.need(n);
    this.off += n;
  }
  bytes(n: number) {
    this.need(n);
    const out = new Uint8Array(this.view.buffer, this.view.byteOffset + this.off, n).slice();
    this.off += n;
    return out;
  }
  /** Reads `count` UTF-16LE code units and decodes up to the first NUL. */
  utf16(count: number) {
    const units: number[] = [];
    let ended = false;
    for (let i = 0; i < count; i++) {
      const u = this.u16();
      if (u === 0) ended = true;
      if (!ended) units.push(u);
    }
    return String.fromCharCode(...units);
  }
}

export class Writer {
  private buf: Uint8Array;
  private view: DataView;
  off = 0;

  constructor(size = 64) {
    this.buf = new Uint8Array(size);
    this.view = new DataView(this.buf.buffer);
  }
  private grow(n: number) {
    if (this.off + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.off + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf);
    this.buf = next;
    this.view = new DataView(next.buffer);
  }
  u8(v: number) {
    this.grow(1);
    this.view.setUint8(this.off++, v & 0xff);
    return this;
  }
  i8(v: number) {
    this.grow(1);
    this.view.setInt8(this.off++, v);
    return this;
  }
  u16(v: number) {
    this.grow(2);
    this.view.setUint16(this.off, v & 0xffff, true);
    this.off += 2;
    return this;
  }
  i16(v: number) {
    this.grow(2);
    this.view.setInt16(this.off, v, true);
    this.off += 2;
    return this;
  }
  u32(v: number) {
    this.grow(4);
    this.view.setUint32(this.off, v >>> 0, true);
    this.off += 4;
    return this;
  }
  i32(v: number) {
    this.grow(4);
    this.view.setInt32(this.off, v | 0, true);
    this.off += 4;
    return this;
  }
  u64(v: bigint) {
    this.grow(8);
    this.view.setBigUint64(this.off, BigInt.asUintN(64, v), true);
    this.off += 8;
    return this;
  }
  zeros(n: number) {
    this.grow(n);
    this.off += n; // buffer is zero-initialised
    return this;
  }
  bytes(data: Uint8Array) {
    this.grow(data.length);
    this.buf.set(data, this.off);
    this.off += data.length;
    return this;
  }
  /** Writes a fixed-size UTF-16LE field of `count` units, NUL padded/truncated. */
  utf16(text: string, count: number) {
    const max = count - 1; // keep room for the terminator
    for (let i = 0; i < count; i++) {
      this.u16(i < text.length && i < max ? text.charCodeAt(i) : 0);
    }
    return this;
  }
  finish() {
    return this.buf.slice(0, this.off);
  }
}
