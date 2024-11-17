# TCP 分组往返延时测试工具

最小工作示例：

在服务端启动一个 echo server:

```
ncat --keep-open --listen 12345 --exec '/usr/bin/cat'
```

在客户端：

```
node ./latency-measure.js
```
