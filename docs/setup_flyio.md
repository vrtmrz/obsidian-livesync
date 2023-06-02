# Setup CouchDB on fly.io

In some cases, the use of IBM Cloudant was found to be hard. We looked for alternatives, but there were no services available. Therefore, we have to build our own servers, which is quite a challenge. In this situation, with fly.io, most of the processes are simplified and only CouchDB needs to be configured.

This is how to configure fly.io and CouchDB on it for Self-hosted LiveSync.

It generally falls within the `Free Allowances` range in most cases.

**[Automatic setup using Colaboratory](#automatic-setup-using-colaboratory) is recommended, after reading this document through. It is reproducible and hard to fail.**

## Required materials

- A valid credit or debit card.

## Warning

- It will be `your` instance. Check the log regularly.

## Prerequisites

For simplicity, the following description assumes that the settings are as shown in the table below. Please read it in accordance with the actual settings you wish to make.

| Used in the text | Meaning and where to use    | Memo                                                                     |
| ---------------- | --------------------------- | ------------------------------------------------------------------------ |
| campanella       | Username                    | It is less likely to fail if it consists only of letters and numbers.    |
| dfusiuada9suy    | Password                    |                                                                          |
| nrt              | Region to make the instance | We can use any [region](https://fly.io/docs/reference/regions/) near us. |

## Steps with your computer

If you want to avoid installing anything, please skip to [Automatic setup using Colaboratory](#automatic-setup-using-colaboratory).

### 1. Install flyctl

- Mac or Linux

```sh
$ curl -L https://fly.io/install.sh | sh
```

- Windows

```powershell
$ iwr https://fly.io/install.ps1 -useb | iex
```

### 2. Sign up or Sign in to fly.io

- Sign up

```bash
$ fly auth signup
```

- Sign in

```bash
$ fly auth login
```

For more information, please refer [Sign up](https://fly.io/docs/hands-on/sign-up/) and [Sign in](https://fly.io/docs/hands-on/sign-in/).

### 3. Make configuration files

Please be careful, `nrt` is the region where near to Japan. Please use your preferred region.

1. Make fly.toml

```
$ flyctl launch --generate-name --detach --no-deploy --region nrt
Creating app in /home/vrtmrz/dev/fly/demo
Scanning source code
Could not find a Dockerfile, nor detect a runtime or framework from source code. Continuing with a blank app.
automatically selected personal organization: vorotamoroz
App will use 'nrt' region as primary

Created app 'billowing-dawn-6619' in organization 'personal'
Admin URL: https://fly.io/apps/billowing-dawn-6619
Hostname: billowing-dawn-6619.fly.dev
Wrote config file fly.toml
```

`billowing-dawn-6619` is an automatically generated name. It is used as the hostname. Please note it in something.  
Note: we can specify this without `--generate-name`, but does not recommend in the trial phases.

1. Make volume

```
$ flyctl volumes create --region nrt couchdata --size 2 --yes
        ID: vol_g67340kxgmmvydxw
      Name: couchdata
       App: billowing-dawn-6619
    Region: nrt
      Zone: 35b7
   Size GB: 2
 Encrypted: true
Created at: 02 Jun 23 01:19 UTC
```

3. Edit fly.toml  
   Changes:
   - Change exposing port from `8080` to `5984`
   - Mounting the volume `couchdata` created in step 2 under `/opt/couchdb/data`
   - Set `campanella` for the administrator of CouchDB
   - Customise CouchDB to use persistent ini-file; which is located under the data directory.
   - To use Dockerfile

```diff
# fly.toml app configuration file generated for billowing-dawn-6619 on 2023-06-02T10:18:59+09:00
#
# See https://fly.io/docs/reference/configuration/ for information about how to use this file.
#

app = "billowing-dawn-6619"
primary_region = "nrt"

[http_service]
-  internal_port = 8080
+  internal_port = 5984
  force_https = true
  auto_stop_machines = true
  auto_start_machines = true
  min_machines_running = 0

+[mounts]
+  source="couchdata"
+  destination="/opt/couchdb/data"
+
+[env]
+  COUCHDB_USER = "campanella"
+  ERL_FLAGS="-couch_ini /opt/couchdb/etc/default.ini /opt/couchdb/etc/default.d/ /opt/couchdb/etc/local.d /opt/couchdb/etc/local.ini /opt/couchdb/data/persistence.ini"
+
+[build]
+  dockerfile = "./Dockerfile"
```

4. Make `Dockerfile`  
   Create a Dockerfile that patches the start-up script to fix ini file permissions.

```dockerfile
FROM couchdb:latest
RUN sed -i '2itouch /opt/couchdb/data/persistence.ini && chmod +w /opt/couchdb/data/persistence.ini' /docker-entrypoint.sh
```

5. Set credential

```
flyctl secrets set COUCHDB_PASSWORD=dfusiuada9suy
```

### 4. Deploy

```
$ flyctl deploy --detach --remote-only
==> Verifying app config
Validating /home/vrtmrz/dev/fly/demo/fly.toml
Platform: machines
✓ Configuration is valid
--> Verified app config
==> Building image
Remote builder fly-builder-bold-sky-4515 ready
==> Creating build context
--> Creating build context done
==> Building image with Docker
--> docker host: 20.10.12 linux x86_64

-------------:SNIPPED:-------------

Watch your app at https://fly.io/apps/billowing-dawn-6619/monitoring

Provisioning ips for billowing-dawn-6619
  Dedicated ipv6: 2a09:8280:1::2d:240f
  Shared ipv4: 66.241.125.213
  Add a dedicated ipv4 with: fly ips allocate-v4
This deployment will:
 * create 1 "app" machine

No machines in group app, launching a new machine
  Machine e7845d1f297183 [app] has state: started
Finished launching new machines

NOTE: The machines for [app] have services with 'auto_stop_machines = true' that will be stopped when idling
```

Now your CouchDB has been launched. (Do not forget to delete it if no longer need).  
If failed, please check by `flyctl doctor`. Failure of remote build may be resolved by `flyctl` wireguard reset` or something.

```
$ flyctl status
App
  Name     = billowing-dawn-6619
  Owner    = personal
  Hostname = billowing-dawn-6619.fly.dev
  Image    = billowing-dawn-6619:deployment-01H1WWB3CK5Z9ZX71KHBSDGHF1
  Platform = machines

Machines
PROCESS ID              VERSION REGION  STATE   CHECKS  LAST UPDATED
app     e7845d1f297183  1       nrt     started         2023-06-02T01:43:34Z
```

### 5. Apply CouchDB configuration

After the initial setup, CouchDB needs some more customisations to be used from Self-hosted LiveSync. It can be configured in browsers or by HTTP-REST APIs.

This section is set up using the REST API.

1. Prepare environment variables.

- Mac or Linux:

```bash
export couchHost=https://billowing-dawn-6619.fly.dev
export couchUser=campanella
export couchPwd=dfusiuada9suy
```

- Windows

```powershell
set couchHost https://billowing-dawn-6619.fly.dev
set couchUser campanella
set couchPwd dfusiuada9suy
$creds = [System.Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes("${couchUser}:${couchPwd}"))
```

2. Perform cluster setup

- Mac or Linux

```bash
curl -X POST "${couchHost}/_cluster_setup" -H "Content-Type: application/json" -d "{\"action\":\"enable_single_node\",\"username\":\"${couchUser}\",\"password\":\"${couchPwd}\",\"bind_address\":\"0.0.0.0\",\"port\":5984,\"singlenode\":true}"  --user "${couchUser}:${couchPwd}"
```

- Windows

```powershell
iwr -UseBasicParsing -Method 'POST' -ContentType 'application/json; charset=utf-8' -Headers @{ 'Authorization' = 'Basic ' + $creds } "${couchHost}/_cluster_setup" -Body "{""action"":""enable_single_node"",""username"":""${couchUser}"",""password"":""${couchPwd}"",""bind_address"":""0.0.0.0"",""port"":5984,""singlenode"":true}"
```

Note: if the response code is not 200. We have to retry the request once again.
If you run the request several times and it does not result in 200, something is wrong. Please report it.

3. Configure parameters

- Mac or Linux

```bash
curl -X PUT "${couchHost}/_node/nonode@nohost/_config/chttpd/require_valid_user" -H "Content-Type: application/json" -d '"true"' --user "${couchUser}:${couchPwd}"
curl -X PUT "${couchHost}/_node/nonode@nohost/_config/chttpd_auth/require_valid_user" -H "Content-Type: application/json" -d '"true"' --user "${couchUser}:${couchPwd}"
curl -X PUT "${couchHost}/_node/nonode@nohost/_config/httpd/WWW-Authenticate" -H "Content-Type: application/json" -d '"Basic realm=\"couchdb\""' --user "${couchUser}:${couchPwd}"
curl -X PUT "${couchHost}/_node/nonode@nohost/_config/httpd/enable_cors" -H "Content-Type: application/json" -d '"true"' --user "${couchUser}:${couchPwd}"
curl -X PUT "${couchHost}/_node/nonode@nohost/_config/chttpd/enable_cors" -H "Content-Type: application/json" -d '"true"' --user "${couchUser}:${couchPwd}"
curl -X PUT "${couchHost}/_node/nonode@nohost/_config/chttpd/max_http_request_size" -H "Content-Type: application/json" -d '"4294967296"' --user "${couchUser}:${couchPwd}"
curl -X PUT "${couchHost}/_node/nonode@nohost/_config/couchdb/max_document_size" -H "Content-Type: application/json" -d '"50000000"' --user "${couchUser}:${couchPwd}"
curl -X PUT "${couchHost}/_node/nonode@nohost/_config/cors/credentials" -H "Content-Type: application/json" -d '"true"' --user "${couchUser}:${couchPwd}"
curl -X PUT "${couchHost}/_node/nonode@nohost/_config/cors/origins" -H "Content-Type: application/json" -d '"app://obsidian.md,capacitor://localhost,http://localhost"' --user "${couchUser}:${couchPwd}"
```

- Windows

```powershell
iwr -UseBasicParsing -Method 'PUT' -ContentType 'application/json; charset=utf-8' -Headers @{ 'Authorization' = 'Basic ' + $creds }  "${couchHost}/_node/nonode@nohost/_config/chttpd/require_valid_user" -Body  '"true"'
iwr -UseBasicParsing -Method 'PUT' -ContentType 'application/json; charset=utf-8' -Headers @{ 'Authorization' = 'Basic ' + $creds }  "${couchHost}/_node/nonode@nohost/_config/chttpd_auth/require_valid_user" -Body  '"true"'
iwr -UseBasicParsing -Method 'PUT' -ContentType 'application/json; charset=utf-8' -Headers @{ 'Authorization' = 'Basic ' + $creds }  "${couchHost}/_node/nonode@nohost/_config/httpd/WWW-Authenticate" -Body  '"Basic realm=\"couchdb\""'
iwr -UseBasicParsing -Method 'PUT' -ContentType 'application/json; charset=utf-8' -Headers @{ 'Authorization' = 'Basic ' + $creds }  "${couchHost}/_node/nonode@nohost/_config/httpd/enable_cors" -Body  '"true"'
iwr -UseBasicParsing -Method 'PUT' -ContentType 'application/json; charset=utf-8' -Headers @{ 'Authorization' = 'Basic ' + $creds }  "${couchHost}/_node/nonode@nohost/_config/chttpd/enable_cors" -Body  '"true"'
iwr -UseBasicParsing -Method 'PUT' -ContentType 'application/json; charset=utf-8' -Headers @{ 'Authorization' = 'Basic ' + $creds }  "${couchHost}/_node/nonode@nohost/_config/chttpd/max_http_request_size" -Body  '"4294967296"'
iwr -UseBasicParsing -Method 'PUT' -ContentType 'application/json; charset=utf-8' -Headers @{ 'Authorization' = 'Basic ' + $creds }  "${couchHost}/_node/nonode@nohost/_config/couchdb/max_document_size" -Body  '"50000000"'
iwr -UseBasicParsing -Method 'PUT' -ContentType 'application/json; charset=utf-8' -Headers @{ 'Authorization' = 'Basic ' + $creds }  "${couchHost}/_node/nonode@nohost/_config/cors/credentials" -Body  '"true"'
iwr -UseBasicParsing -Method 'PUT' -ContentType 'application/json; charset=utf-8' -Headers @{ 'Authorization' = 'Basic ' + $creds }  "${couchHost}/_node/nonode@nohost/_config/cors/origins" -Body  '"app://obsidian.md,capacitor://localhost,http://localhost"'
```

Note: Each of these should also be repeated until finished in 200.

### 6. Use it from Self-hosted LiveSync

Now the CouchDB is ready to use from Self-hosted LiveSync. We can use `https://billowing-dawn-6619.fly.dev` in URI, `campanella` in `Username` and `dfusiuada9suy` in `Password` on Self-hosted LiveSync. `Database name` could be anything you want.
`Enhance chunk size` could be up to around `100`.

## Automatic setup using Colaboratory

We can perform all these steps by using [this Colaboratory notebook](https://gist.github.com/vrtmrz/b437a539af25ef191bd452aae369242f) without installing anything.

## After testing / before creating a new instance

**Be sure to delete the instance. We can check instances on the [Dashboard](https://fly.io/dashboard/personal)**
