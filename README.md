# TCP Latency Tester

## Basic usage

First launch an simple echo server in the server side where you are testing latency against:

```
ncat --keep-open --listen 12345 --exec '/usr/bin/cat'
```

An echo server only has to be as simple as be capable of echoing bytes.

Then in the client side where the connection is initiated from, runs the client program:

```
node ./dist/bundle.js --mode client --host <host> --port <port> --interval <millisecond>
```

## Print single trip latency (advanced)

To make the program be capable of printing single trip latency, the server side have to be aware of the packet and be able to modify packet to tag the timestamp on it, hence the client program would be able to calculate the delta between the client timestamp and the server timestamp tagged on the packet.

Instead of launch a simple echo server, launch this program in server mode and with an additional `-D` option like this:

```
node ./dist/bundle.js --mode server -D --port 14148
```

Doing so would instruct the program working in server mode and modify the packet to tag the timestamp on it.

Then still use `--mode client` in client clide to connect to this endpoint as before.

## Screenshot

![Screenshot](./doc/screenshot/1.png)

## Todos

1. Supports proxy type like SOCKS5, and HTTP Connect.
2. Prometheus metrics, for monitoring, visulization, alerting and analysis.
3. Supports `ProxyCommand` like that in ssh, so that these standard I/O based tunnel tools would then become useful to this.
4. Supports web target (i.e. running in browser environment). However, in that case, WebSocket might become the only available transport protocol that could use.
5. Allow optionally adjust the total size of PDU that are gonna used to exchange with the server, like that in `ping`, one could utilize this feature to study how does the size of PDU affects the behavior of the network.
