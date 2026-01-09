# Using Docker to run your Live Sync Server

This repository uses GitHub Actions to build and publish Docker images
to GitHub's Container Registry for the Live Sync Server.

You can use the created image, or you can use the same files to build and run
the Docker image yourself.

> [!IMPORTANT]
> You may only use alphanumeric characters, hyphens, and underscores in the
> username you choose for CouchDB.

## Use the Container Registry Image

You can use the included [`docker-compose.yml`](./docker-compose.yml) file or
a simple `docker run` command.

### Docker Compose with Container Registry Image

The [`docker-compose.yml`](./docker-compose.yml) file uses variables,
which can be set in a `.env` file in the same directory.

There is an [`example.env`](./example.env) file you can copy to create your
own `.env` file.
At the least, you really really should change the values in quotes in the
following lines in your `.env` file:

```env
COUCHDB_USER="CHANGE_TO_USERNAME"
COUCHDB_PASSWORD="CHANGE_TO_PASSWORD"
```

_Note:
The other values are commented out (i.e. have a `#` at the start of the line)
because they have default values in the `docker-compose.yml` file and so you
do not need to set them unless you want to change them from their defaults.
(The default values in the `docker-compose.yml` file are the same as those in
the commented-out lines in the [`example.env`](./example.env) file)_

Copy the [`docker-compose.yml`](./docker-compose.yml) file into the same
directory as your edited `.env` file and run:

```bash
docker-compose up -d
```

The benefit of this method is that the username and password you pick for
CouchDB will not be visible in your shell history.
They will be visible in your shell history if you use the `docker run`
method below.

### Using the `docker run` Command with the Container Registry Image

You will need to set the username and password for the new docker container.
You can do this by setting environment variables in your shell or by changing
the values directly in the `docker run` command.

To set the environment variables in your shell:

```bash
# Adding environment variables.
export USERNAME="CHANGE_TO_USERNAME"   #Please change this value.
export PASSWORD="CHANGE_TO_PASSWORD"   #Please change this value.
```

Then run the below `docker run` command:

!! TODO: Replace my GitHub username with original repo !!

```bash
docker run --name couchdb-for-ols \
-d \
--restart unless-stopped \
-e COUCHDB_USER="${USERNAME}" \
-e COUCHDB_PASSWORD="${PASSWORD}" \
-v couchdb-for-ols-data:/opt/couchdb/data \
-v couchdb-for-ols-etc:/opt/couchdb/etc \
-p 5984:5984 \
ghcr.io/julowe/obsidian-livesync:latest
```

## Build and Run the Docker Image Yourself

TODO: expand on this section

Clone this repo and in the `docker` directory run:

```bash
docker build -t obsidian-livesync .
```

Then use either the `docker-compose.yml` file or a `docker run` command.
