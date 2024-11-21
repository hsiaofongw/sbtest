import { KMPDFA } from "./sequence";

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

function main() {
  for (let cI = 0; cI < testCases.length; ++cI) {
    console.log("Testing case index:", cI);
    const testCase = testCases[cI];
    console.log(testCase);
    const { pat, txt } = testCase;
    const kmpDfa = new KMPDFA(pat);
    console.log("dfa:", kmpDfa.dfa);
    const bytesTaken = kmpDfa.write(txt);
    const isSeqAccepted = kmpDfa.isAccepted();
    const actual = { bytesTaken, isSeqAccepted };
    const passed =
      bytesTaken === testCase.bytesTake &&
      isSeqAccepted === testCase.shouldAccept;
    console.log("Actual:", actual);
    const expected = {
      bytesTaken: testCase.bytesTake,
      isSeqAccepted: testCase.shouldAccept,
    };
    console.log("Expected:", expected);
    console.log("Passed:", passed);
    if (!passed) {
      throw "Test Failed at idx:" + String(cI);
    }
  }
}

main();
