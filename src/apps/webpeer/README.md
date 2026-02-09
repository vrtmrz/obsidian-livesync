# A pseudo client for Self-hosted LiveSync Peer-to-Peer Sync mode

## What is it for?

This is a pseudo client for the Self-hosted LiveSync Peer-to-Peer Sync mode. It is a simple pure-client-side web-application that can be connected to the Self-hosted LiveSync in peer-to-peer.

As long as you have a browser, it starts up, so if you leave it opened some device, it can replace your existing remote servers such as CouchDB.

> [!IMPORTANT]
> Of course, it has not been fully tested. Rather, it was created to be tested.

This pseudo client actually receives the data from other devices, and sends if some device requests it. However, it does not store **files** in the local storage. If you want to purge the data, please purge the browser's cache and indexedDB, local storage, etc.

## How to use it?

We can build the application by running the following command:

```bash
$ deno task build
```

Then, open the `dist/index.html` in the browser. It can be configured as the same as the Self-hosted LiveSync (Same components are used[^1]).

## Some notes

I will launch this application in the github pages later, so will be able to use it without building it. However, that shares the origin. Hence, the application that your have built and deployed would be more secure.


[^1]: Congrats! I made it modular. Finally...

