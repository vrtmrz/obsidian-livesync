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

For the first device, Setup URI, additional device, and two-way verification procedure, see [Set up peer-to-peer synchronisation](../setup_p2p.md). For the communication and privacy model, see [How peer-to-peer synchronisation works](../p2p.md).

> [!IMPORTANT]
> P2P is a supported opt-in feature, but WebRTC connectivity still depends on the networks available to every device. A direct connection cannot be guaranteed in every environment.

## A peer does not appear

Check discovery before changing any Vault settings:

1. Confirm that both devices use the same **Signalling relay URLs**, Group ID, and P2P passphrase.
2. Confirm that each device has a distinct device name.
3. Open `P2P Status` on both devices and confirm that each shows `Connected`.
4. Select `Refresh` after the other device joins.
5. If the peer remains absent, select `Disconnect`, then `Open connection` on the device which should be advertised again.

The signalling relay discovers peers; it does not prove that the networks can carry a WebRTC data connection.

## A peer appears but synchronisation cannot connect

WebRTC may fail when UDP hole punching is blocked by carrier-grade NAT, a firewall, a VPN policy, or an intermediary gateway.

Try these in order:

1. Put both devices on the same ordinary network and retry.
2. Remove a VPN temporarily if it blocks peer traffic, or use a trusted VPN such as Tailscale when it provides a reachable path between the devices.
3. In `P2P Configuration` -> `Advanced Settings`, configure a trusted TURN service.

TURN is a fallback for encrypted WebRTC traffic. It is different from the required signalling relay. The project does not operate an official TURN service. A TURN provider cannot read encrypted Vault contents, but it can observe connection metadata and traffic volume.

## A connected peer does not receive later edits

An open signalling connection does not automatically move every change.

- Use `Replicate now` to prove an explicit bidirectional round trip.
- Enable `Announce changes` on the source device before it dispatches notifications.
- Enable `Follow changes` for that source on the receiving device before it fetches in response.
- Use the peer's `More actions` menu only after the manual round trip works.

If the device was asleep, Obsidian was in the background, or the peer disconnected, run an explicit synchronisation after both devices are visible and connected.

## Mobile limitations

Keep Obsidian visible and the device awake during initial transfer, rebuild, or a large synchronisation. Wake Lock support is best effort and cannot prevent the operating system from suspending or terminating a background application.

## Collect evidence

If the same room works on one network but not another, include both network types in the report. Run `Generate full report for opening the issue with debug info`, remove credentials and private relay details, and state whether:

- both devices reached `Connected`;
- each device appeared in `Detected Peers`;
- a connection request appeared; and
- a TURN server or VPN was in use.
