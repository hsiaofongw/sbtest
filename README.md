# TCP 分组往返延时测试工具

## 最小工作示例

在服务端启动一个 echo server:

```
ncat --keep-open --listen 12345 --exec '/usr/bin/cat'
```

在客户端：

```
node ./latency-measure.js <server_host> <server_port> <tick_interval_seconds>
```

## 待办

1. 增加 server 类型支持：`'echo'`，`'timestamp'`。默认仍然假定 server 类型为 `'echo'`；
2. 对于 `'timestamp'` 类型的 server，增加分别打印去程和回程的延时的功能，并且用文档规范数据包格式；
3. 增加对 SOCKS 代理的支持；
4. 增加一个“类型”的必填命令行参数（`--type`, `-t`），取值范围：`'client'` 和 `'server'`。当 `--type` 为 `'client'` 时，行为和 demo 版本一样。当 `--type` 为 `'server'` 时，还应当通过 `--mode` 指定服务器如何响应请求，`--mode` 的取值有：`'echo'` 和 `'timestamp'`，默认 `'echo'`。
