# Quick setup
The plugin has so many configuration options to deal with different circumstances. However, there are not so many settings that are actually used. Therefore, `The Setup wizard` has been implemented to simplify the initial setup.

Note: Subsequent devices are recommended to be set up using the `Copy setup URI` and `Open setup URI`.

## The Setup wizard
Open the `🧙‍♂️ Setup wizard` in the settings dialogue. If the plugin has not been configured before, it should already be open.

![](../images/quick_setup_1.png)

- Discard the existing configuration and set up  
If you have changed any settings, this button allows you to discard all changes before setting up.

- Do not discard the existing configuration and set up  
Simply reconfigure. Be careful. In wizard mode, you cannot see all configuration items, even if they have been configured.

Pressing `Next` on one of the above options will put the configuration dialog into wizard mode.

### Wizard mode

![](../images/quick_setup_2.png)

Let's see how to use it step-by-step.

## Remote Database configuration

### Remote database configuration 

Enter the information for the database we have set up.  

![](../images/quick_setup_3.png)  


#### Test database connection and Check database configuration

We can check the connectivity to the database, and the database settings.

![](../images/quick_setup_5.png)  

#### Test Database Connection
Check whether we can connect to the database. If it fails, there are several possible reasons, but first attempt the `Check database configuration` check to see if it fails there too.

#### Check database configuration

Check the database settings and fix any problems on the spot.

![](../images/quick_setup_6.png)

This item may vary depending on the connection. In the above case, press all three Fix buttons.  
If the Fix buttons disappear and all become check marks, we are done.


### Confidentiality configuration

![](../images/quick_setup_4.png)

Encrypt your database in case of unintended database exposure; enable End to End encryption and the contents of your notes will be encrypted at the moment it leaves the device. We strongly recommend enabling it. And `Path Obfuscation` also obfuscates filenames. Now stable and recommended.  
Encryption is based on 256-bit AES-GCM.  
These setting can be disabled if you are inside a closed network and it is clear that you will not be accessed by third parties.

![](../images/quick_setup_7.png)

#### Next 
Go to the Sync Settings.

#### Discard existing database and proceed
Discard the contents of the Remote database and go to the Sync Settings.

### Sync Settings
Finally, finish the wizard by selecting a preset for synchronisation.

![](../images/quick_setup_9_1.png)

Select any synchronisation methods we want to use and `Apply` to initialise and build the local and remote databases as required. If `All done!` is displayed, we are done. Automatically, `Copy setup URI` will open and we will be asked for a passphrase to encrypt the `Setup URI`.

![](../images/quick_setup_10.png)

Set the passphrase as you like.  
The Setup URI will be copied to the clipboard, which you can then transfer to the second and subsequent devices in some way.

# How to set up the second and subsequent units
After installing Self-hosted LiveSync on the first device, select `Open setup URI` from the command palette and enter the setup URI you transferred. Afterwards, enter your passphrase and a setup wizard will open.  
Answer the following.

- `Yes` to `Importing LiveSync's conf, OK?`
- `Set it up as secondary or subsequent device` to `How would you like to set it up?`.

Then, The configuration will take effect and replication will start. Your files will be synchronised soon! You may need to close the settings dialog and reopen it to see the settings fields populated properly, but they will be set.
