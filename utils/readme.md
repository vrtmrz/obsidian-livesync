<!-- For translation: 20240206r0 -->
# Utilities
Here are some useful things.

## couchdb

### couchdb-init.sh
This script can configure CouchDB with the necessary settings by REST APIs.

#### Materials
- Mandatory: curl

#### Usage

```sh
export hostname=http://localhost:5984/
export username=couchdb-admin-username
export password=couchdb-admin-password
./couchdb-init.sh
```

curl result will be shown, however, all of them can be ignored if the script has been run completely.

## fly.io

### deploy-server.sh

A fully automated CouchDB deployment script. We can deploy CouchDB onto fly.io. The only we need is an account of it.

All omitted configurations will be determined at random. (And, it is preferred). The region is configured to `nrt`.
If Japan is not close to you, please choose a region closer to you. However, the deployed database will work if you leave it at all.

#### Materials
- Mandatory: curl, flyctl
- Recommended: deno

#### Usage
```sh
#export appname=
#export username=
#export password=
#export database=
#export passphrase=
export region=nrt #pick your nearest location
./deploy-server.sh
```

The result of this command is as follows.

```
-- YOUR CONFIGURATION --
URL     : https://young-darkness-25342.fly.dev
username: billowing-cherry-22580
password: misty-dew-13571
region  : nrt

-- START DEPLOYING --> 
An existing fly.toml file was found
Using build strategies '[the "couchdb:latest" docker image]'. Remove [build] from fly.toml to force a rescan
Creating app in /home/vorotamoroz/dev/obsidian-livesync/utils/flyio
We're about to launch your app on Fly.io. Here's what you're getting:

Organization: vorotamoroz              (fly launch defaults to the personal org)
Name:         young-darkness-25342     (specified on the command line)
Region:       Tokyo, Japan             (specified on the command line)
App Machines: shared-cpu-1x, 256MB RAM (specified on the command line)
Postgres:     <none>                   (not requested)
Redis:        <none>                   (not requested)

Created app 'young-darkness-25342' in organization 'personal'
Admin URL: https://fly.io/apps/young-darkness-25342
Hostname: young-darkness-25342.fly.dev
Wrote config file fly.toml
Validating /home/vorotamoroz/dev/obsidian-livesync/utils/flyio/fly.toml
Platform: machines
✓ Configuration is valid
Your app is ready! Deploy with `flyctl deploy`
Secrets are staged for the first deployment
==> Verifying app config
Validating /home/vorotamoroz/dev/obsidian-livesync/utils/flyio/fly.toml
Platform: machines
✓ Configuration is valid
--> Verified app config
==> Building image
Searching for image 'couchdb:latest' remotely...
image found: img_ox20prk63084j1zq

Watch your deployment at https://fly.io/apps/young-darkness-25342/monitoring

Provisioning ips for young-darkness-25342
  Dedicated ipv6: 2a09:8280:1::37:fde9
  Shared ipv4: 66.241.124.163
  Add a dedicated ipv4 with: fly ips allocate-v4

Creating a 1 GB volume named 'couchdata' for process group 'app'. Use 'fly vol extend' to increase its size
This deployment will:
 * create 1 "app" machine

No machines in group app, launching a new machine

WARNING The app is not listening on the expected address and will not be reachable by fly-proxy.
You can fix this by configuring your app to listen on the following addresses:
  - 0.0.0.0:5984
Found these processes inside the machine with open listening sockets:
  PROCESS        | ADDRESSES                             
-----------------*---------------------------------------
  /.fly/hallpass | [fdaa:0:73b9:a7b:22e:3851:7f28:2]:22  

Finished launching new machines

NOTE: The machines for [app] have services with 'auto_stop_machines = true' that will be stopped when idling

-------
Checking DNS configuration for young-darkness-25342.fly.dev

Visit your newly deployed app at https://young-darkness-25342.fly.dev/
-- Configuring CouchDB by REST APIs... -->
curl: (35) OpenSSL SSL_connect: Connection reset by peer in connection to young-darkness-25342.fly.dev:443 
{"ok":true}
""
""
""
""
""
""
""
""
""
<-- Configuring CouchDB by REST APIs Done!
OK!
Setup finished! Also, we can set up Self-hosted LiveSync instantly, by the following setup uri.
Passphrase of setup-uri will be printed only one time. Keep it safe!
--- configured ---
database       : obsidiannotes
E2EE passphrase: dark-wildflower-26467
--- setup uri  ---
obsidian://setuplivesync?settings=%5B%22gZkBwjFbLqxbdSIbJymU%2FmTPBPAKUiHVGDRKYiNnKhW0auQeBgJOfvnxexZtMCn8sNiIUTAlxNaMGF2t%2BCEhpJoeCP%2FO%2BrwfN5LaNDQyky1Uf7E%2B64A5UWyjOYvZDOgq4iCKSdBAXp9oO%2BwKh4MQjUZ78vIVvJp8Mo6NWHfm5fkiWoAoddki1xBMvi%2BmmN%2FhZatQGcslVb9oyYWpZocduTl0a5Dv%2FQviGwlYQ%2F4NY0dVDIoOdvaYS%2FX4GhNAnLzyJKMXhPEJHo9FvR%2FEOBuwyfMdftV1SQUZ8YDCuiR3T7fh7Kn1c6OFgaFMpFm%2BWgIJ%2FZpmAyhZFpEcjpd7ty%2BN9kfd9gQsZM4%2BYyU9OwDd2DahVMBWkqoV12QIJ8OlJScHHdcUfMW5ex%2F4UZTWKNEHJsigITXBrtq11qGk3rBfHys8O0vY6sz%2FaYNM3iAOsR1aoZGyvwZm4O6VwtzK8edg0T15TL4O%2B7UajQgtCGxgKNYxb8EMOGeskv7NifYhjCWcveeTYOJzBhnIDyRbYaWbkAXQgHPBxzJRkkG%2FpBPfBBoJarj7wgjMvhLJ9xtL4FbP6sBNlr8jtAUCoq4L7LJcRNF4hlgvjJpL2BpFZMzkRNtUBcsRYR5J%2BM1X2buWi2BHncbSiRRDKEwNOQkc%2FmhMJjbAn%2F8eNKRuIICOLD5OvxD7FZNCJ0R%2BWzgrzcNV%22%2C%22ec7edc900516b4fcedb4c7cc01000000%22%2C%22fceb5fe54f6619ee266ed9a887634e07%22%5D

Your passphrase of Setup-URI is:  patient-haze
This passphrase is never shown again, so please note it in a safe place.
```

All we have to do is copy the setup-URI (`obsidian`://...`) and open it from Self-hosted LiveSync on Obsidian.

If you did not install Deno, configurations will be printed again, instead of the setup-URI. In this case, we should configure it manually.

### delete-server.sh

The pair script of `deploy-server.sh`. We can delete the deployed server by this with fly.toml.

#### Materials

- Mandatory: flyctl, jq
- Recommended: none

#### Usage
```sh
./delete-server.sh 
```

```
App 'young-darkness-25342 is going to be scaled according to this plan:
  -1 machines for group 'app' on region 'nrt' of size 'shared-cpu-1x'
Executing scale plan
  Destroyed e28667eec57158 group:app region:nrt size:shared-cpu-1x
Destroyed app young-darkness-25342
```