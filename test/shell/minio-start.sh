#!/bin/bash
docker run -d --name minio-test \
  -p 9000:9000 -p 9001:9001 \
  -e "RUSTFS_ACCESS_KEY=$accessKey" \
  -e "RUSTFS_SECRET_KEY=$secretKey" \
  -e "RUSTFS_CONSOLE_ENABLE=true" \
  -e 'RUSTFS_CORS_ALLOWED_ORIGINS=*' \
  rustfs/rustfs:1.0.0-rc.6@sha256:97171b3d72cd47dc81000f92ea84de25608bfc35a94c965501afaeb5d99f6035 /data
