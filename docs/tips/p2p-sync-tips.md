---
title: "Peer-to-Peer Synchronisation Tips"
livesync-version: 0.25.24
tags:
    - tips
    - p2p
authors:
    - vorotamoroz
---

# Peer-to-Peer Synchronisation Tips

> [!IMPORTANT]
> Peer-to-peer synchronisation is still an experimental feature. Although we have made every effort to ensure its reliability, it may not function correctly in all environments.

## Difficulties with Peer-to-Peer Synchronisation

It is often the case that peer-to-peer connections do not function correctly, for instance, when using mobile data services.
In such circumstances, we recommend connecting all devices to a single Virtual Private Network (VPN). It is advisable to select a service, such as Tailscale, which facilitates direct communication between peers wherever possible.
Should one be in an environment where even Tailscale is unable to connect, or where it cannot be lawfully installed, please continue reading.

## A More Detailed Explanation

The failure of a Peer-to-Peer connection via WebRTC can be attributed to several factors. These may include an unsuccessful UDP hole-punching attempt, or an intermediary gateway intentionally terminating the connection. Troubleshooting this matter is not a simple undertaking. Furthermore, and rather unfortunately, gateway administrators are typically aware of this type of network behaviour. Whilst a legitimate purpose for such traffic can be cited, such as for web conferencing, this is often insufficient to prevent it from being blocked.

This situation, however, is the primary reason that our project does not provide a TURN server. Although it is said that a TURN server within WebRTC does not decrypt communications, the project holds the view that the risk of a malicious party impersonating a TURN server must be avoided. Consequently, configuring a TURN server for relay communication is not currently possible through the user interface. Furthermore, there is no official project TURN server, which is to say, one that could be monitored by a third party.

We request that you provide your own server, using your own Fully Qualified Domain Name (FQDN), and subsequently enter its details into the advanced settings.
For testing purposes, Cloudflare's Real-Time TURN Service is exceedingly convenient and offers a generous amount of free data. However, it must be noted that because it is a well-known destination, such traffic is highly conspicuous. There is also a significant possibility that it may be blocked by default. We advise proceeding with caution.
