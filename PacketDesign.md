# 封包格式设计

为了向后兼容旧版的 dummy echo server，同时提供新的去程、返程延时分别打印的功能，设计下列结构的封包：

| Offset | Length | Name       | Description                                                         |
| ------ | ------ | ---------- | ------------------------------------------------------------------- |
| 0      | 23     | `Preamble` | Magic Octets Sequence (See [3])                                     |
| 23     | 9      | (Reserved) | Reserved, padding with all zeros                                    |
| 32     | 8      | `Rev`      | Versioning, 1 by default (See [2], same as below)                   |
| 40     | 8      | `CliTx`    | Client written timestamp, in millisecond resolution Unix epoch      |
| 48     | 8      | `SrvTx`    | Server written timestamp, in millisecond resolution Unix epoch      |
| 56     | 8      | `SeqNum`   | Sequence Number, set by client, 0-based, monolithically increasing. |

额外说明：

1. 总长度 64 字节。
2. 所有 multibyte 数据类型的存储采用大字序 (big-endian)，也叫 network-endian。
3. `Preamble` 的内容恒为这样的字节序列：`6e 6f 64 65 20 6c 61 74 65 6e 63 79 2d 6d 65 61 73 75 72 65 2e 6a 73`。
