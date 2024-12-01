# sbtest: A stream-based TCP latency tester

![githubactionbadgeforbranchmain](https://github.com/hsiaofongw/sbtest/actions/workflows/build.yaml/badge.svg?branch=main)

## Basic usage

First launch an simple echo server in the server side where you are testing latency against:

```
ncat --keep-open --listen 12345 --exec '/usr/bin/cat'
```

An echo server only has to be as simple as be capable of echoing bytes as is.

Then in the client side where the connection is initiated from, runs the client program:

```
node ./dist/app.js --connect tcp://localhost:12345 --interval 1000
```

This would test the round-trip TCP latency between the client and the endpoint peer specified by the `--connect` parameter.

Other protocols like WebSocket, HTTP2 are also supported. Please refers to the help:

```
node ./dist/app.js --help
```

## Print single trip latency

If the server tag a timestamp on the packet it receives, then the client might be able to guess out how long it takes for the packet from here to there (i.e. onward) and from there back to here (i.e. backward).

And yes we have implemented such feature to do this:

```
node ./dist/app.js --listen --port 12345 -D
```

Then the clients that connects to this endpoint would have single trip latency measurements (both onward and backward latency) printed on its stdout.

We already deploy a demo server ready to be testing:

```
node ./dist/app.js --connect 'wss://demo-sbtest-ws.exploro.one' --interval 1000
```

## WebSocket and HTTP2

WebSocket and HTTP2 are both good at traversing NAT, and can be easily forward by nowadays popular CDN services, therefore make it more adapated to today's actual situation.

Also, direct TCP connectivity requires public IP reachability or a properly functioning tunnel set up. Hence, it would be pretty useful if it is able to test the round-trip delay directly on a application layer's stream.

You can easily set up a WebSocket/HTTP2 echo server like the follows:

```
node dist/app.js --listen --port <port> --websocket  # for WebSocket as transport
node dist/app.js --listen --port <port> --http2  # for HTTP2 as transport
```

And use proper connection string to connects to it:

```
node dist/app.js --connect ws://<hostname>:<port> --interval 1000  # or use 'wss:' if TLS is needed
node dist/app.js --connect http://<hostname>:<port> --interval 1000  # or use 'https:' if TLS is needed
```

## Build from source

cd into this project's directory, then invokes:

```
npm install    # do this only at first build or after the dependency list (i.e. package.json) has been updated.
npm run build
```

If all goes well, the artifact output would be in `dist/app.js` related to current directory. You might ship this JavaScript script file to anywhere needed, without having to ship the whole `node_modules` dependencies together. Only a lts-versioned Node runtime is needed to installed for running it.

Also one could use the script at [scripts/build-docker-image.sh](scripts/build-docker-image.sh) to build an OCI container image, and the entrypoint has already set to `node path/to/script.js`.

For compliance and safety requirements, it's also ok to use docker to build it and docker to run it, i.e., build it in a container (or any sandboxed environment) and also run it inside a container (or any sandboxed environment). This is viable because the project only relys on Node runtime itself, and everything else from the libs had been already packed into the bundled output before it was built.

## Todos

1. Supports proxy (tunnel, not gateway) type like SOCKS5, and HTTP Connect.
2. Prometheus metrics, for monitoring, visulization, alerting and analysis.
3. Supports `ProxyCommand` like that in ssh, so that these standard I/O based tunnel tools would then become useful to this.
4. Supports web target (i.e. running in browser environment). However, in that case, WebSocket might become the only available transport protocol that could use.
5. Allow optionally adjust the total size of PDU that are gonna used to exchange with the server, like that in `ping`, one could utilize this feature to study how does the size of PDU affects the behavior of the network.
6. the 'daemon mode', allows a client to connects to it, and initiate ping tests on behalf of clients, and clients can use query apis to query currently ongoing pings, so, a daemon of this application serve as a ping resource objects manager, and a headless client. Think of it as a docker daemon but it only in charge of ping resource objects not container resource objects.
