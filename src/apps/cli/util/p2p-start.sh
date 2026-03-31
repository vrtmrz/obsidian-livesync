#!/bin/bash
set -e

docker run -d --name relay-test -p 4000:7777 \
	--tmpfs /app/strfry-db:rw,size=256m \
	--entrypoint sh \
	ghcr.io/hoytech/strfry:latest \
	-lc 'cat > /tmp/strfry.conf <<"EOF"
db = "./strfry-db/"

relay {
	bind = "0.0.0.0"
	port = 7777
	nofiles = 100000

	info {
		name = "livesync test relay"
		description = "local relay for livesync p2p tests"
	}

	maxWebsocketPayloadSize = 131072
	autoPingSeconds = 55

	writePolicy {
		plugin = ""
	}
}
EOF
exec /app/strfry --config /tmp/strfry.conf relay'

