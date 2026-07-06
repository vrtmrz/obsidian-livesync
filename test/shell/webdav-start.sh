#!/bin/bash
set -e

webdavUsername=${webdavUsername:-webdav}
webdavPassword=${webdavPassword:-webdav}
webdavPort=${webdavPort:-8088}

docker run -d \
  --name webdav-test \
  -p "$webdavPort:8080" \
  rclone/rclone serve webdav /data \
  --addr :8080 \
  --baseurl /dav \
  --user "$webdavUsername" \
  --pass "$webdavPassword"
