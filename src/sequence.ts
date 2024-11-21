export class KMPDFA {
  private state: number;
  public readonly dfa: Array<Record<number, number>>;
  public readonly alphabet: Set<number>;
  public readonly pattern: Uint8Array;

  constructor(pattern: Uint8Array) {
    if (!(pattern instanceof Uint8Array)) {
      throw TypeError(
        "Expecting pattern is a instance (or sub-class) of Uint8Array"
      );
    }

    if (pattern.byteLength === 0) {
      throw TypeError("Expecting an non-empty pattern");
    }

    this.state = 0;
    this.pattern = pattern;
    this.dfa = new Array(this.pattern.byteLength);
    const alphabet = new Set<number>();
    for (let i = 0; i < this.pattern.byteLength; ++i) {
      this.dfa[i] = {};
      alphabet.add(this.pattern[i]);
    }
    this.alphabet = alphabet;
    this.dfa[0][this.pattern[0]] = 1;
    for (let x = 0, i = 1; i < this.pattern.byteLength; ++i) {
      for (const ch of this.alphabet) {
        this.dfa[i][ch] = this.dfa[x][ch] ?? 0;
      }
      this.dfa[i][this.pattern[i]] = i + 1;
      x = this.dfa[x][this.pattern[i]] ?? 0;
    }
  }

  public isAccepted(): boolean {
    return this.pattern.byteLength === this.state;
  }

  public getState(): number {
    return this.state;
  }

  public reset(): void {
    this.state = 0;
  }

  public write(seq: Uint8Array): number {
    if (!(seq instanceof Uint8Array)) {
      throw TypeError(
        "Expecting seq is a instance (or sub-class) of Uint8Array"
      );
    }

    for (let i = 0; i < seq.byteLength; ++i) {
      this.state = this.dfa[this.state][seq[i]] ?? 0;
      if (this.state === this.pattern.length) {
        return i + 1;
      }
    }

    return seq.length;
  }
}
