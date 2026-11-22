# Set up a second vault from a second device
This is how to set up a second device with it's own vault using exclusively the Livesync plugin in Obsidian. The assumptions are as follows:
1. The server is setup with one device and one or more vaults as in https://github.com/vrtmrz/obsidian-livesync/blob/main/docs/setup_own_server.md
2. That first device and the second device both have the Obsidian Livesync plugin installed, where only the first device and vault have a complete setup.

To add any additional vaults across any additional devices, you need to create a new database and sync it to the server. Follow steps 1-16 below for that. To access that vault from other devices, follow steps 17-19.

1. On First Device, click `Copy the current settings to a Setup Uri`
2. Enter an encryption password
3. On second device, click `Connect with Setup URI`
4. Paste the Setup-URI and enter the encryption password
5. Test Settings and Continue
6. Click `Apply setings only (advanced)
7. At this point, click the cancel button at the bottom. 
8. At the `Scram Enabled` window, click `Keep LiveSync disabled`
9. Go to settings > Self-hosted LiveSync > Remote Configuration
10. In here, select your connection and edit it. Change your Database Name to something else (e.g. change `obsidiannotes` to `professionalnotes`)
11. Run `Check server requirements` and click `Test Connection and Save`.
11. Click the back button to go back into the `Settings` for the current vault's LiveSync plugin.
12. Scroll down to Maintenance and Recovery > Maintenance
13. Next to `Overwrite Server Data with This Device's Files` Click `Schedule and Restart`.
14. This will open a `Final Confirmation` window. Perform final confirmation and click `I Understand, Overwrite Server`
15. You will get a `No Synchronization Settings Found` message. Click `Use this device's settings`.
16. You're done. Go back to the plugin settings in Obsidian and click `Copy the current settings to a Setup Uri`, again entering a password.
17. On your first device, create a new Vault, enable livesync. 
18. On setup, click `I am adding a device to an existing synchronisation setup` then paste this new setting, enter password. 
19. Determine how you want to handle syncing and now the two devices should be linked with the second vault.

