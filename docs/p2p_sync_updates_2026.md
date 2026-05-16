# User Guide: Peer-to-Peer Synchronisation (2026 Edition)

Peer-to-Peer (P2P) synchronisation has evolved significantly. This guide covers the essential setup and the new features introduced in the 2026 updates.

## 1. Core Concept: Server-less Freedom
P2P synchronisation allows your devices to talk directly to each other using WebRTC. A central server is not required for data storage, ensuring maximum privacy and "freedom."

## 2. Setting Up via P2P Status Pane
You no longer need to navigate through complex menus. Simply open the **P2P Status** (via the ribbon icon or command palette) and click the **⚙ (Cog)** icon.

This opens the **P2P Setup** dialogue where you can configure the essentials:
- **Room ID:** A unique identifier for your synchronisation group.
- **Passphrase:** Your encryption key. Ensure all your devices use the exact same passphrase. 
- **Device Name:** A recognisable name for the current device (e.g., `iphone-16`).

Once you have saved the settings, return to the **P2P Status Pane** and click the **Connect** button to join the network.

*Tip: You can also toggle **Auto Connect** in the setup dialogue to automatically join the network whenever Obsidian starts.*

## 3. Real-time Control
The status pane in the right sidebar provides granular control over your synchronisation:

- **Signalling Status:** Shows if you are connected to the relay (🟢 Online).
- **Live-push (Broadcast):** Toggle "Broadcast changes" to notify other peers whenever you make an edit.
- **Watch:** Enable "Watch" on specific peers to automatically pull changes when they broadcast. This creates a "LiveSync-like" experience.
- **Sync (🔄/🔁):** Mark specific peers as **sync targets**. Peers marked here will be included when you run the **"P2P: Sync with targets"** command (see section 5). Click the button next to a peer to toggle it on (🔄, highlighted) or off (🔁). This setting is persisted in your configuration.

## 4. Replication Dialogue
If you want to synchronise with a specific peer manually, use the **Replication** command or button. This opens the **Replication Dialogue** listing available devices.

Inside the dialogue, the **Server Status** card at the top confirms you are still connected while performing the sync.

Two actions are available per peer:

- **Sync** — Starts a bidirectional synchronisation (Pull then Push) and keeps the dialogue open so you can monitor progress or sync with additional peers.
- **Start Sync & Close** — Starts the same bidirectional sync in the background and **immediately closes the dialogue**, so you can continue working without waiting.

## 5. Syncing with Registered Targets via Command Palette

You can now trigger a synchronisation with all your pre-registered target peers in one step, without opening any UI.

1. Open the **Command Palette** (`Ctrl/Cmd + P`).
2. Run **"P2P: Sync with targets"**.

This command synchronises with every peer whose **SYNC** toggle is enabled in the **Detected Peers** list. If no targets are registered, or if the P2P server is not running, the command will notify you accordingly.

*Tip: Pair this command with a hotkey for a quick, keyboard-driven sync workflow.*

## 6. Technical Improvements in 2026
- **Decoupled Architecture:** The UI is now strictly separated from the core logic, making the plugin more stable across different platforms (Mobile, Desktop, and Web).
- **Svelte 5 UI:** The interface has been rebuilt for better responsiveness and clearer status indicators.
- **Security:** All data remains end-to-end encrypted. Even the signalling relay never sees your actual notes.

