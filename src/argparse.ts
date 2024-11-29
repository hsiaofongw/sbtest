import {
  Readable,
  Transform,
  TransformCallback,
  TransformOptions,
  WritableOptions,
  Writable,
} from "stream";
import { pipeline } from "stream/promises";

export const valTypeStr = "string";
export const valTypeInt = "int";
export const valTypeBool = "boolean";
export const valTypeFlt = "float";

export type BasicType =
  | typeof valTypeStr
  | typeof valTypeInt
  | typeof valTypeBool
  | typeof valTypeFlt;

export type ArgvDescriptor = {
  shortKey?: string;
  fullKey: string;
  description: string;
  type: BasicType;
  allowedValues?: string[];
  required?: boolean;
  defaultValue?: any;
};

const syntaxKey = "key";
const syntaxValue = "value";
type SyntaxNodeType = typeof syntaxKey | typeof syntaxValue;
type SyntaxNode = {
  type: SyntaxNodeType;
  content: string;
};

type SemanticNode = {
  key: string;
  type: BasicType;
  content: string;
};

export type FltValNode = {
  type: typeof valTypeFlt;
  key: string;
  value: number;
};

export type StrValNode = {
  type: typeof valTypeStr;
  key: string;
  value: string;
};

export type IntValNode = {
  type: typeof valTypeInt;
  key: string;
  value: number;
};

export type BoolValNode = {
  type: typeof valTypeBool;
  key: string;
  value: boolean;
};

export type ValNode = FltValNode | IntValNode | BoolValNode | StrValNode;

export const modeClient = "client";
export const modeServer = "server";

export const paramKeyHelp = "--help";
export const paramKeyHost = "--host";
export const paramKeyPort = "--port";
export const paramKeyMode = "--mode";
export const paramKeyInterval = "--interval";
export const paramKeyVersion = "--version";
export const paramKeyDebug = "--debug";
export const paramKeyDualTrip = "--dual-trip";
export const paramKeyWS = "--websocket";
export const paramKeyWSUri = "--websocket-uri";
export const paramKeyHttp2 = "--http2";
export const paramKeyHttp2Uri = "--http2-uri";

export const defaultArgDefines: ArgvDescriptor[] = [
  {
    shortKey: "-h",
    fullKey: paramKeyHelp,
    description: "Show help and usage.",
    type: valTypeBool,
  },
  {
    shortKey: "-H",
    fullKey: paramKeyHost,
    description: "Hostname to connect to. Only allows in client mode.",
    type: valTypeStr,
  },
  {
    shortKey: "-p",
    fullKey: paramKeyPort,
    description:
      "Port of the endpoint to connect to, or to listen when running in server mode.",
    type: valTypeInt,
  },
  {
    shortKey: "-m",
    fullKey: paramKeyMode,
    description:
      "Mode to work on, supported values are: server, client (default).",
    type: valTypeStr,
    allowedValues: [modeClient, modeServer],
  },
  {
    shortKey: "-i",
    fullKey: paramKeyInterval,
    description:
      "Interval (in miliseconds) to ping when working in client mode, 1000 by default.",
    type: valTypeInt,
    defaultValue: 1000,
  },
  {
    shortKey: "-d",
    fullKey: paramKeyDebug,
    description: "Print debugging information.",
    type: valTypeBool,
  },
  {
    shortKey: "-D",
    fullKey: paramKeyDualTrip,
    description:
      "Enable dual trip latency tracking, when enabled, the server would tag each packet with timestamp.",
    type: valTypeBool,
  },
  {
    shortKey: "-W",
    fullKey: paramKeyWS,
    description: "Use WebSocket as low level transport.",
    type: valTypeBool,
  },
  {
    fullKey: paramKeyWSUri,
    description: "WebSocket connection string, this also implies -W.",
    type: valTypeStr,
  },
  {
    fullKey: paramKeyHttp2,
    description: "Use HTTP2 as low level transport.",
    type: valTypeBool,
  },
  {
    fullKey: paramKeyHttp2Uri,
    description: "HTTP2 connection string, the HTTP2 endpoint to connect to.",
    type: valTypeStr,
  },
  {
    shortKey: "-V",
    fullKey: paramKeyVersion,
    description: "Show the revision of this build.",
    type: valTypeBool,
  },
];

export function getArgDescriptionLine(argDef: ArgvDescriptor) {
  const keys: string[] = [];
  if (argDef.shortKey) {
    keys.push(argDef.shortKey);
  }
  if (argDef.fullKey) {
    keys.push(argDef.fullKey);
  }

  if (keys.length === 0) {
    return "";
  }

  return keys
    .concat(argDef.type === valTypeBool ? [] : [`<${argDef.type}>`])
    .concat(argDef.description)
    .join("\t");
}

class NormalizeWords extends Transform {
  constructor(opts: TransformOptions = {}) {
    super({ ...opts, objectMode: true });
  }

  _transform(
    chunk: string,
    encoding: BufferEncoding,
    callback: TransformCallback
  ): void {
    if (typeof chunk !== "string") {
      throw TypeError(`Expecting object of type string, got: ${chunk}`);
    }

    if (chunk.match(/^-[a-zA-Z0-9]+$/)) {
      chunk
        .slice(1)
        .split("")
        .forEach((key) => {
          this.push(`-${key}`);
        });
    } else if (chunk.match(/^--[a-zA-Z0-9][a-zA-Z0-9\-]+=[^\s]+$/)) {
      const kvParts = chunk.split("=");
      const [k, v] = kvParts;
      if (k && v) {
        this.push(k);
        this.push(v);
      }
    } else {
      this.push(chunk);
    }
    callback();
  }
}

class ExpandShortKey extends Transform {
  public readonly argDefs: Iterable<ArgvDescriptor>;
  public readonly argDefMaps: Record<string, ArgvDescriptor>;

  constructor(argDefs: Iterable<ArgvDescriptor>, opts: TransformOptions = {}) {
    super({ ...opts, objectMode: true });
    this.argDefs = argDefs;
    this.argDefMaps = {};
    for (const def of argDefs) {
      if (def.shortKey) {
        this.argDefMaps[def.shortKey] = def;
      }
    }
  }

  _transform(
    chunk: string,
    encoding: BufferEncoding,
    callback: TransformCallback
  ): void {
    if (typeof chunk !== "string") {
      throw TypeError(`Expecting object of type string, got: ${chunk}`);
    }

    const def = this.argDefMaps[chunk];
    if (def) {
      this.push(def.fullKey);
    } else {
      this.push(chunk);
    }
    callback();
  }
}

class SyntaxParse extends Transform {
  constructor(opts: TransformOptions = {}) {
    super({ ...opts, objectMode: true });
  }

  _transform(
    chunk: string,
    encoding: BufferEncoding,
    callback: TransformCallback
  ): void {
    if (typeof chunk !== "string") {
      throw TypeError(`Expecting object of type string, got: ${chunk}`);
    }

    const nd: SyntaxNode = {
      type: chunk.startsWith("--") ? syntaxKey : syntaxValue,
      content: chunk,
    };
    this.push(nd);
    callback();
  }
}

class SemanticParse extends Transform {
  private paringNode: SemanticNode | undefined;
  private readonly argDefsMap: Record<string, ArgvDescriptor>;

  constructor(argDefs: Iterable<ArgvDescriptor>, opts: TransformOptions = {}) {
    super({ ...opts, objectMode: true });
    this.paringNode = undefined;
    this.argDefsMap = {};
    for (const def of argDefs) {
      this.argDefsMap[def.fullKey] = def;
    }
  }

  private unpairedError(key: string): SyntaxError {
    return new SyntaxError(`Expecting a value for key ${key}`);
  }

  _transform(
    chunk: SyntaxNode,
    encoding: BufferEncoding,
    callback: TransformCallback
  ): void {
    if (!(chunk.type && typeof chunk.content === "string")) {
      throw TypeError(`Expecting object of type SyntaxNode, got: ${chunk}`);
    }

    if (this.paringNode !== undefined) {
      // expecting a value
      if (chunk.type !== syntaxValue) {
        callback(this.unpairedError(this.paringNode.key));
        return;
      }

      this.paringNode.content = chunk.content;
      this.push(this.paringNode);
      this.paringNode = undefined;
      callback();
      return;
    }

    // expecting a key, quietly drops unknown chunks
    if (chunk.type !== syntaxKey) {
      callback();
      return;
    }

    const def = this.argDefsMap[chunk.content];
    if (!def) {
      callback(new SyntaxError(`Unknown key ${chunk.content}`));
      return;
    }

    if (def.type === valTypeBool) {
      this.push({
        type: def.type,
        key: chunk.content,
        content: String(true),
      } as SemanticNode);
      callback();
      return;
    }

    this.paringNode = { type: def.type, key: chunk.content, content: "" };
    callback();
  }

  _flush(callback: TransformCallback): void {
    if (this.paringNode !== undefined) {
      callback(this.unpairedError(this.paringNode.key));
      return;
    }
    callback();
  }
}

class ValueTypeCheckPass extends Transform {
  constructor(opts: TransformOptions = {}) {
    super({ ...opts, objectMode: true });
  }

  _transform(
    chunk: SemanticNode,
    encoding: BufferEncoding,
    callback: TransformCallback
  ): void {
    if (chunk.type === valTypeBool) {
      const nd: BoolValNode = {
        key: chunk.key,
        type: valTypeBool,
        value: true,
      };
      this.push(nd);
      callback();
      return;
    } else if (chunk.type === valTypeFlt) {
      try {
        const x = parseFloat(chunk.content);
        if (typeof x === "number" && !Number.isNaN(x)) {
          const nd: FltValNode = { key: chunk.key, type: valTypeFlt, value: x };
          this.push(nd);
          callback();
          return;
        }
      } catch (_) {}
      callback(
        new TypeError(`Expecting a valid float value for key ${chunk.key}`)
      );
      return;
    } else if (chunk.type === valTypeInt) {
      try {
        const x = parseInt(chunk.content);
        if (typeof x === "number" && !Number.isNaN(x)) {
          const nd: IntValNode = { key: chunk.key, type: valTypeInt, value: x };
          this.push(nd);
          callback();
          return;
        }
      } catch (_) {}
      callback(
        new TypeError(`Expecting a valid integer value for key ${chunk.key}`)
      );
      return;
    } else if (chunk.type === valTypeStr) {
      const nd: StrValNode = {
        key: chunk.key,
        type: valTypeStr,
        value: String(chunk.content),
      };
      this.push(nd);
      callback();
      return;
    } else {
      throw Error(`Unknown type: ${chunk.type}`);
    }
  }
}

class ValueRangeCheckPass extends Transform {
  private argDefsMap: Record<string, ArgvDescriptor>;
  constructor(argDefs: Iterable<ArgvDescriptor>, opts: TransformOptions = {}) {
    super({ ...opts, objectMode: true });
    this.argDefsMap = {};
    for (const def of argDefs) {
      this.argDefsMap[def.fullKey] = def;
    }
  }

  _transform(
    chunk: ValNode,
    encoding: BufferEncoding,
    callback: TransformCallback
  ): void {
    const argDef = this.argDefsMap[chunk.key];
    const allowedVals = argDef?.allowedValues;
    if (!allowedVals || allowedVals.length === 0) {
      this.push(chunk);
      callback();
      return;
    }

    if (!allowedVals.includes(String(chunk.value))) {
      callback(
        new TypeError(
          `The value supplied for key ${chunk.key} must be one of: ${allowedVals}`
        )
      );
      return;
    }

    this.push(chunk);
    callback();
    return;
  }
}

class RequiredParamsCheckPass extends Transform {
  private argDefs: Array<ArgvDescriptor>;
  private occurs: Record<string, number>;
  private chunks: ValNode[];

  constructor(argDefs: Iterable<ArgvDescriptor>, opts: TransformOptions = {}) {
    super({ ...opts, objectMode: true });
    this.argDefs = Array.from(argDefs);
    this.occurs = {};
    this.chunks = [];
  }

  _transform(
    chunk: ValNode,
    encoding: BufferEncoding,
    callback: TransformCallback
  ): void {
    this.occurs[chunk.key] = (this.occurs[chunk.key] ?? 0) + 1;
    this.chunks.push(chunk);
    callback();
  }

  _flush(callback: TransformCallback): void {
    if (this.argDefs.length > 0) {
      const missingParam = this.argDefs.find(
        (def) => !!def.required && (this.occurs[def.fullKey] ?? 0) < 1
      );
      if (missingParam) {
        callback(
          new TypeError(
            `Missing required parameter of key ${missingParam?.fullKey}`
          )
        );
        return;
      }
    }

    for (const chunk of this.chunks) {
      this.push(chunk);
    }
    callback();
  }
}

class ValNodesCollector extends Writable {
  public value: ValNode[];
  constructor(opts: WritableOptions = {}) {
    super({ ...opts, objectMode: true });
    this.value = [];
  }

  _write(
    chunk: ValNode,
    encoding: BufferEncoding,
    callback: (err?: Error | null | undefined) => void
  ): void {
    this.value.push(chunk);
    callback();
  }
}

export function parseArgv(
  argvs: Iterable<string>,
  argDefines: Iterable<ArgvDescriptor> = defaultArgDefines
): Promise<Array<ValNode>> {
  const wordStream = Readable.from(argvs);
  const normalize = new NormalizeWords();
  const expandShortKey = new ExpandShortKey(argDefines);
  const syntaxParser = new SyntaxParse();
  const semanticParser = new SemanticParse(argDefines);
  const valueTypeCheckPass = new ValueTypeCheckPass();
  const valueRangeCheckPass = new ValueRangeCheckPass(argDefines);
  const requiredCheckPass = new RequiredParamsCheckPass(argDefines);
  const collector = new ValNodesCollector();

  return pipeline(
    wordStream,
    normalize,
    expandShortKey,
    syntaxParser,
    semanticParser,
    valueTypeCheckPass,
    valueRangeCheckPass,
    requiredCheckPass,
    collector
  )
    .then(() => {
      return collector.value;
    })
    .catch((e) => {
      console.error(e?.message || e);
      process.exit(1);
    });
}
