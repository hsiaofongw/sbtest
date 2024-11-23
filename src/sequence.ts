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

  /**
   * 从一个 ringBuffer 中给定偏移位置开始读取最多 nbytes 字节。
   * @param seq 输入内容的 buffer 区域
   * @param offset 开始读的偏移地址，基址是 seq（作为 Buffer）的起始地址
   * @param nbytes 最大读取多少字节
   * @returns
   */
  public write(seq: Uint8Array, offset: number, nbytes: number): number {
    let didReads = 0;
    while (didReads < nbytes) {
      const cursor = (offset + didReads) % seq.byteLength;
      this.state = this.dfa[this.state][seq[cursor]] ?? 0;
      if (this.state == this.pattern.length) {
        return didReads + 1;
      }
      ++didReads;
    }
    return didReads;
  }
}

type TestCase = {
  pat: Buffer;
  txt: Buffer;
  shouldAccept: boolean;
  bytesTake: number;
};

const testCases: TestCase[] = [
  {
    pat: Buffer.from("31681"),
    txt: Buffer.from("69317316819"),
    shouldAccept: true,
    bytesTake: 10,
  },
  {
    pat: Buffer.from("31681"),
    txt: Buffer.from("6931731681"),
    shouldAccept: true,
    bytesTake: 10,
  },
  {
    pat: Buffer.from("31681"),
    txt: Buffer.from("31681123"),
    shouldAccept: true,
    bytesTake: 5,
  },
  {
    pat: Buffer.from("31681"),
    txt: Buffer.from("131681123"),
    shouldAccept: true,
    bytesTake: 6,
  },
  {
    pat: Buffer.from("31681"),
    txt: Buffer.from("316131681123"),
    shouldAccept: true,
    bytesTake: 9,
  },
  {
    pat: Buffer.from("31618"),
    txt: Buffer.from("316131681123"),
    shouldAccept: false,
    bytesTake: String("316131681123").length,
  },
  {
    pat: Buffer.from("12"),
    txt: Buffer.from("1"),
    shouldAccept: false,
    bytesTake: 1,
  },
  {
    pat: Buffer.from("123"),
    txt: Buffer.from([]),
    shouldAccept: false,
    bytesTake: 0,
  },
];

// export function test() {
//   for (let cI = 0; cI < testCases.length; ++cI) {
//     console.log("Testing case index:", cI);
//     const testCase = testCases[cI];
//     console.log(testCase);
//     const { pat, txt } = testCase;
//     const kmpDfa = new KMPDFA(pat);
//     console.log("dfa:", kmpDfa.dfa);
//     const bytesTaken = kmpDfa.write(txt);
//     const isSeqAccepted = kmpDfa.isAccepted();
//     const actual = { bytesTaken, isSeqAccepted };
//     const passed =
//       bytesTaken === testCase.bytesTake &&
//       isSeqAccepted === testCase.shouldAccept;
//     console.log("Actual:", actual);
//     const expected = {
//       bytesTaken: testCase.bytesTake,
//       isSeqAccepted: testCase.shouldAccept,
//     };
//     console.log("Expected:", expected);
//     console.log("Passed:", passed);
//     if (!passed) {
//       throw "Test Failed at idx:" + String(cI);
//     }
//   }
// }

// test();
