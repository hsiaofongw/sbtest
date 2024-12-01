# 封包格式设计

下列列出所有应用过的封包格式，如非特别指出，默认使用最新版本的封包。

# Version 0

最初版本的封包结构：

| Offset | Length | Name    | Description                                                   |
| ------ | ------ | ------- | ------------------------------------------------------------- |
| 0      | 8      | `CliTx` | Client written timestamp, in millisecon resolution Unix epoch |

说明：封包的全部内容就是 8 字节的毫秒级 UNIX 时间戳，简单的结构使得它的兼容性很好，只需要很简单的 Echo server 的配合就能正常工作。

# Version 1

为了向后兼容旧版的 dummy echo server，同时提供新的去程、返程延时分别打印的功能，设计下列结构的封包：

| Offset | Length | Name       | Description                                                         |
| ------ | ------ | ---------- | ------------------------------------------------------------------- |
| 0      | 23     | `Preamble` | Magic Octets Sequence (See [3])                                     |
| 23     | 9      | (Reserved) | Reserved, padding with all zeros                                    |
| 32     | 8      | `Rev`      | Versioning, 1 by default (See [2], same as below)                   |
| 40     | 8      | `CliTx`    | Client written timestamp, in millisecond resolution Unix epoch      |
| 48     | 8      | `SrvTx`    | Server written timestamp, in millisecond resolution Unix epoch      |
| 56     | 8      | `SeqNum`   | Sequence Number, set by client, 0-based, monolithically increasing. |

其中，`Rev` 的内部结构如下表所示：

| Offset | Length | Name       | Description                         |
| ------ | ------ | ---------- | ----------------------------------- |
| 0      | 2      | (Reserved) | Reserved, padding with all zeros    |
| 2      | 2      | `RevMajor` | Major revision, in unsigned integer |
| 4      | 2      | `RevMinor` | Minor revision, in unsigned integer |
| 6      | 2      | `RevPatch` | Patch revision, in unsigned integer |

额外说明：

1. 总长度 64 字节。所有长度的单位都使用“字节”。
2. 所有 multibyte 数据类型的存储采用大字序 (big-endian)，也叫 network-endian。
3. `Preamble` 的内容恒为这样的字节序列：`6e 6f 64 65 20 6c 61 74 65 6e 63 79 2d 6d 65 61 73 75 72 65 2e 6a 73`。
