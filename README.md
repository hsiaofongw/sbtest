# TCP Latency Tester

## Minimum working example

First launch an simple echo server in the server side where you are testing latency against:

```
ncat --keep-open --listen 12345 --exec '/usr/bin/cat'
```

An echo server only has to be as simple as be capable of simply echoing byte stream.

Then in the client side where the connection is initiated from runs the client program:

```
node ./latency-measure.js --mode client --host <host> --port <port> --interval <millisecond>
```

## Todos

1. Supports the `'server'` mode.
2. Be capable of printing out single trip latency where possible.
3. Supports proxy type like `SOCKS`.
