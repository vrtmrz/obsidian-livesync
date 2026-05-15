# User Guide: Peer-to-Peer Synchronisation (2026 Edition)

Peer-to-Peer (P2P) synchronisation has evolved significantly. This guide covers the essential setup and the new features introduced in the 2026 updates.

## 1. Core Concept: Server-less Freedom
P2P synchronisation allows your devices to talk directly to each other using WebRTC. A central server is not required for data storage, ensuring maximum privacy and "freedom."

## 2. Setting Up via P2P Status Pane
You no longer need to navigate through complex menus. Simply open the **P2P Server Status** (via the ribbon icon or command palette) and click the **⚙ (Cog)** icon.

This opens the **P2P Setup** dialogue where you can configure the essentials:
- **Room ID:** A unique identifier for your synchronisation group.
- **Password:** Your encryption key. Ensure all your devices use the exact same password. 
- **Device Name:** A recognisable name for the current device (e.g., `iphone-16`).

Once you have saved the settings, return to the **P2P Status Pane** and click the **Connect** button to join the network. 

*Tip: You can also toggle **Auto Connect** in the setup dialogue to automatically join the network whenever Obsidian starts.*

## 3. Real-time Control
The status pane in the right sidebar provides granular control over your synchronisation:

- **Signalling Status:** Shows if you are connected to the relay (🟢 Online).
- **Live-push (Broadcast):** Toggle "Broadcast changes" to notify other peers whenever you make an edit.
- **Watch:** Enable "Watch" on specific peers to automatically pull changes when they broadcast. This creates a "LiveSync-like" experience.

## 4. Enhanced Replication Dialogue (Bidirectional Sync)
If you want to synchronise manually, click the **🔄 (Replicate)** button next to a peer in the device list. This opens the **Replication Dialogue**.

Inside the dialogue, you can still see the **Server Status** at the top, so you will know if you are still connected while performing manual synchronisations.

When you trigger a synchronisation this way, the system now performs a **Bidirectional Synchronisation**:
1. **Pull:** It first fetches changes from the peer.
2. **Push:** If the pull is successful, it immediately pushes your local changes to that peer.

This "one-click" approach ensures both devices are perfectly in synchronisation without manual back-and-forth.

## 5. Technical Improvements in 2026
- **Decoupled Architecture:** The UI is now strictly separated from the core logic, making the plugin more stable across different platforms (Mobile, Desktop, and Web).
- **Svelte 5 UI:** The interface has been rebuilt for better responsiveness and clearer status indicators.
- **Security:** All data remains end-to-end encrypted. Even the signalling relay never sees your actual notes.

