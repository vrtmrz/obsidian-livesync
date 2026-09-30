#!/bin/bash
set -e

docker run --rm --network host --entrypoint=/bin/sh \
  rustfs/rc:v0.1.35@sha256:adb45b56539006120f1d790bcc17ee5f9b4d93c1d7e71ed0a24f10267f9d6914 \
  -c 'set -e
rc alias set myminio "$1" "$2" "$3"
rc mb --ignore-existing "myminio/$4"
rc cors set "myminio/$4" - <<CORS
<CORSConfiguration>
  <CORSRule>
    <AllowedOrigin>*</AllowedOrigin>
    <AllowedMethod>GET</AllowedMethod>
    <AllowedMethod>PUT</AllowedMethod>
    <AllowedMethod>POST</AllowedMethod>
    <AllowedMethod>DELETE</AllowedMethod>
    <AllowedMethod>HEAD</AllowedMethod>
    <AllowedHeader>*</AllowedHeader>
    <AllowedHeader>authorization</AllowedHeader>
    <ExposeHeader>ETag</ExposeHeader>
  </CORSRule>
</CORSConfiguration>
CORS
' sh "$minioEndpoint" "$accessKey" "$secretKey" "$bucketName"
