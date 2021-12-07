# Setup CouchDB to your server


## Install CouchDB and access from PC or Mac

The easiest way to set up the CouchDB is using the [docker image]((https://hub.docker.com/_/couchdb)).

But some additional configurations are required in `local.ini` to use from Self-hosted LiveSync, like below:

```
[couchdb]
single_node=true

[chttpd]
require_valid_user = true

[chttpd_auth]
require_valid_user = true
authentication_redirect = /_utils/session.html

[httpd]
WWW-Authenticate = Basic realm="couchdb"
enable_cors = true

[cors]
origins = app://obsidian.md,capacitor://localhost,http://localhost
credentials = true
headers = accept, authorization, content-type, origin, referer
methods = GET, PUT, POST, HEAD, DELETE
max_age = 3600
```

Make `local.ini` and run with docker run like this, you can launch the CouchDB.
```
$ docker run --rm -it -e COUCHDB_USER=admin -e COUCHDB_PASSWORD=password -v .local.ini:/opt/couchdb/etc/local.ini -p 5984:5984 couchdb
```
Note: At this time, the file owner of local.ini became 5984:5984. It's the limitation docker image. please change the owner before editing local.ini again.

If you could confirm that Self-hosted LiveSync can sync with the server, launch docker image as background as you like.

example)
```
$ docker run -d --restart always -e COUCHDB_USER=admin -e COUCHDB_PASSWORD=password -v .local.ini:/opt/couchdb/etc/local.ini -p 5984:5984 couchdb
```

## Access from mobile device
If you want to access Self-hosted LiveSync from mobile devices, you need a valid SSL certificate.

### Testing from mobile
In the testing phase, [localhost.run](http://localhost.run/) or something like services is very useful.

example on using localhost.run)
```
$ ssh -R 80:localhost:5984 nokey@localhost.run
Warning: Permanently added the RSA host key for IP address '35.171.254.69' to the list of known hosts.

===============================================================================
Welcome to localhost.run!

Follow your favourite reverse tunnel at [https://twitter.com/localhost_run].

**You need a SSH key to access this service.**
If you get a permission denied follow Gitlab's most excellent howto:
https://docs.gitlab.com/ee/ssh/
*Only rsa and ed25519 keys are supported*

To set up and manage custom domains go to https://admin.localhost.run/

More details on custom domains (and how to enable subdomains of your custom
domain) at https://localhost.run/docs/custom-domains

To explore using localhost.run visit the documentation site:
https://localhost.run/docs/

===============================================================================


** your connection id is xxxxxxxxxxxxxxxxxxxxxxxxxxxx, please mention it if you send me a message about an issue. **

xxxxxxxx.localhost.run tunneled with tls termination, https://xxxxxxxx.localhost.run
Connection to localhost.run closed by remote host.
Connection to localhost.run closed.
```

https://xxxxxxxx.localhost.run is the temporary server address.

### Setting up your domain

Set the A record of your domain to point to your server, and host reverse proxy as you like.  
Note: Mounting CouchDB on the top directory is not recommended.  
Using Caddy is a handy way to serve the server with SSL automatically.

I have published [docker-compose.yml and ini files](https://github.com/vrtmrz/self-hosted-livesync-server) that launches Caddy and CouchDB at once. Please try it out.

And, be sure to check the server log and be careful of malicious access.