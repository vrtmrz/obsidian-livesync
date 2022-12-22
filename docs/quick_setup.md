# Quick setup
The Setup wizard has been implemented since v0.15.0. This simplifies the initial setup.

Note: The subsequent devices should be set up using the `Copy setup URI` and `Open setup URI`.

## How to open and use wizard
Open from `🪄 Setup wizard` in the setting dialogue. If there is no configuration or no synchronisation settings have been activated, it should already be open.

![](../images/quick_setup_1.png)

### Discard the existing configuration and set up
If you have made any settings, this button allows you to discard them all before setting up.

### Do not discard the existing configuration and set up
Simply reconfigure. Be careful. In wizard mode, you cannot see all configuration items, even if they have been configured.

Pressing `Next` on any of these will put the configuration dialog into wizard mode.

### Wizard mode

![](../images/quick_setup_2.png)

We can set it up step by step.

## Remote Database configuration

### Remote database configuration 

Enter the information in the database we have set up.  

![](../images/quick_setup_3.png)  

### End to End Encryption

![](../images/quick_setup_4.png)

If End to End encryption is enabled, the possibility of a third party who does not know the Passphrase being able to read the contents of the Remote database if they are leaked is reduced. So we strongly recommend enabling it.  
Encryption is based on 256-bit AES-GCM.  
This setting can be disabled if you are inside a closed network and it is clear that you will not be accessed by third parties.

### Test database connection and Check database configuration

Here we can check the status of the connection to the database and the database settings.  

![](../images/quick_setup_5.png)  

#### Test Database Connection
Check whether we can connect to the database. If it fails, there are several reasons, but once you have done the `Check database configuration`, check if it fails there too.

#### Check database configuration

Check the database settings and fix any deficiencies on the spot.

![](../images/quick_setup_6.png)

This item may vary depending on the connection. In the above case, press all three Fix buttons.  
If the Fix buttons disappear and all become check marks, we are done.

![](../images/quick_setup_7.png)

### Next 
Go to the Local Database configuration.

### Discard exist database and proceed
Discard the contents of the Remote database and go to the Local Database configuration.

## Local Database configuration

![](../images/quick_setup_8.png)

Configure the local database. If we already have a Vaults with Self-hosted LiveSync installed and having the same directory name as currently we are setting up, please specify a different suffix than the Vault you have already set up here.

## Miscellaneous
Finally, finish the miscellaneous configurations and select a preset for synchronisation.

![](../images/quick_setup_9_1.png)

The `Show status inside editor` can be enabled to your liking. If enabled, the status is displayed in the top right-hand corner of the editor.

![](../images/quick_setup_9_2.png)

From Presets, select the synchronisation method we want to use and `Apply` to initialise and build the local and remote databases as required.  
If `All done!' is displayed, we are done. Automatically, `Copy setup URI` will open and we will be asked for a passphrase to encrypt the `Setup URI`.

![](../images/quick_setup_10.png)

Set the passphrase as you like.  
The Setup URI will be copied to the clipboard, which you can then transfer to the second and subsequent devices in some way.

# How to set up the second and subsequent units
After installing Self-hosted LiveSync on the device, select `Open setup URI` from the command palette and enter the setup URI you transferred. Afterwards, enter your passphrase and a setup wizard will open.  
Answer the following.

- `Yes` to `Importing LiveSync's conf, OK?`
- `Set it up as secondary or subsequent device` to `How would you like to set it up?`.

Then, The configuration will now take effect and replication will start. Your files will be synchronised soon!