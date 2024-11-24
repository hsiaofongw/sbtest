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

## Todos

1. Supports proxy type like `SOCKS`.
1. Prometheus metrics.
