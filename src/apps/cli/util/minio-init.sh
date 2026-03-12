#!/bin/bash
set -e
cat >/tmp/mybucket-rw.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:GetBucketLocation","s3:ListBucket"],
      "Resource": ["arn:aws:s3:::$bucketName"]
    },
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject","s3:PutObject","s3:DeleteObject"],
      "Resource": ["arn:aws:s3:::$bucketName/*"]
    }
  ]
}
EOF
# echo "<CORSConfiguration>
#   <CORSRule>
#     <AllowedOrigin>http://localhost:63315</AllowedOrigin>
#     <AllowedOrigin>http://localhost:63316</AllowedOrigin>
#     <AllowedOrigin>http://localhost</AllowedOrigin>
#     <AllowedMethod>GET</AllowedMethod>
#     <AllowedMethod>PUT</AllowedMethod>
#     <AllowedMethod>POST</AllowedMethod>
#     <AllowedMethod>DELETE</AllowedMethod>
#     <AllowedMethod>HEAD</AllowedMethod>
#     <AllowedHeader>*</AllowedHeader>
#   </CORSRule>
# </CORSConfiguration>" > /tmp/cors.xml
# docker run --rm --network host -v /tmp/mybucket-rw.json:/tmp/mybucket-rw.json --entrypoint=/bin/sh minio/mc -c "
#   mc alias set myminio $minioEndpoint $username $password 
#   mc mb --ignore-existing myminio/$bucketName
#   mc admin policy create myminio my-custom-policy /tmp/mybucket-rw.json 
#   echo 'Creating service account for user $username with access key $accessKey'
#   mc admin user svcacct add --access-key '$accessKey' --secret-key '$secretKey' myminio '$username' 
#   mc admin policy attach myminio my-custom-policy --user '$accessKey'
#   echo 'Verifying policy and user creation:'
#   mc admin user svcacct info myminio '$accessKey'
# "

docker run --rm --network host -v /tmp/mybucket-rw.json:/tmp/mybucket-rw.json --entrypoint=/bin/sh minio/mc -c "
  mc alias set myminio $minioEndpoint $accessKey $secretKey 
  mc mb --ignore-existing myminio/$bucketName
"