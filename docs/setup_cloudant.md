# Cloudant Setup

## Creating an Instance

In these instructions, create IBM Cloudant Instance for trial.

1. Hit the "Create Resource" button.  
   ![step 1](../instruction_images/cloudant_1.png)

1. In IBM Cloud Catalog, search "Cloudant".  
   ![step 2](../instruction_images/cloudant_2.png)

1. You can choose "Lite plan" for free.  
   ![step 3](../instruction_images/cloudant_3.png)

1. Select Multitenant(it's the default) and the region as you like.  
   ![step 4](../instruction_images/cloudant_4.png)

1. Be sure to select "IAM and Legacy credentials" for "Authentication Method".  
   ![step 5](../instruction_images/cloudant_5.png)

1. Select Lite and be sure to check the capacity.  
   ![step 6](../instruction_images/cloudant_6.png)

1. And hit "Create" on the right panel.  
   ![step 7](../instruction_images/cloudant_7.png)

1. When all of the above steps have been done, open "Resource list" on the left pane. you can see the Cloudant instance in the "Service and software". Click it.  
   ![step 8](../instruction_images/cloudant_8.png)

1. In resource details, there's information to connect from Self-hosted LiveSync.  
   Copy the "External Endpoint(preferred)" address. <sup>(\*1)</sup>. We use this address later, with the database name.  
   ![step 9](../instruction_images/cloudant_9.png)

## Database setup

1.  Hit the "Launch Dashboard" button, Cloudant dashboard will be shown.  
    Yes, it's almost CouchDB's fauxton.  
    ![step 1](../instruction_images/couchdb_1.png)

1.  First, you have to enable the CORS option.  
    Hit the Account menu and open the "CORS" tab.  
    Initially, "Origin Domains" is set to "Restrict to specific domains"., so set to "All domains(\*)"  
    _NOTE: of course We want to set "app://obsidian.md" but it's not acceptable on Cloudant._
    ![step 2](../instruction_images/couchdb_2.png)

1.  Next, Open the "Databases" tab and hit the "Create Database" button.  
    Enter the name as you like <sup>(\*2)</sup> and Hit the "Create" button below.  
    ![step 3](../instruction_images/couchdb_3.png)

1.  If the database was shown with joyful messages, the setup is almost done.  
    And, once you have confirmed that you can create a database, usually there is no need to open this screen.  
    You can create a database from Self-hosted LiveSync.
    ![step 4](../instruction_images/couchdb_4.png)

### Credentials Setup

1.  Back into IBM Cloud, Open the "Service credentials". You'll get an empty list, hit the "New credential" button.  
    ![step 1](../instruction_images/credentials_1.png)

1.  The dialog to create a credential will be shown.  
    type any name or leave it default, hit the "Add" button.  
    ![step 2](../instruction_images/credentials_2.png)  
    _NOTE: This "name" is not related to your username that uses in Self-hosted LiveSync._

1.  Back to "Service credentials", the new credential should be created.  
    open details.  
    ![step 3](../instruction_images/credentials_3.png)  
    The username and password pair is inside this JSON.  
    "username" and "password" are so.  
    follow the figure, it's  
    "apikey-v2-2unu15184f7o8emr90xlqgkm2ncwhbltml6tgnjl9sd5"<sup>(\*3)</sup> and "c2c11651d75497fa3d3c486e4c8bdf27"<sup>(\*4)</sup>

## Self-hosted LiveSync settings

![Setting](../images/remote_db_setting.png)

The Setting should be as below:

| Items         | Value | example                                                           |
| ------------- | ----- | ----------------------------------------------------------------- |
| URI           | (\*1) | https://xxxxxxxxxxxxxxxxx-bluemix.cloudantnosqldb.appdomain.cloud |
| Username      | (\*3) | apikey-v2-2unu15184f7o8emr90xlqgkm2ncwhbltml6tgnjl9sd5            |
| Password      | (\*4) | c2c11651d75497fa3d3c486e4c8bdf27                                  |
| Database name | (\*2) | sync-test                                                         |
