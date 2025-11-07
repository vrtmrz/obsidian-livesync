---
title: "JWT Authentication on CouchDB"
livesync-version: 0.25.24
tags:
    - tips
    - CouchDB
    - JWT
authors:
    - vorotamoroz
---

# JWT Authentication on CouchDB

When using CouchDB as a backend for Self-hosted LiveSync, it is possible to enhance security by employing JWT (JSON Web Token) Authentication. In particular, using asymmetric keys (ES256 and ES512) provides greater security against token interception.

## Setting up JWT Authentication (Asymmetrical Key Example)

### 1. Generate a key pair

We can use `openssl` to generate an EC key pair as follows:

```bash
# Generate private key
# ES512 for secp521r1 curve, we can also use ES256 for prime256v1 curve
openssl ecparam -name secp521r1 -genkey -noout | openssl pkcs8 -topk8 -inform PEM -nocrypt -out private_key.pem
# openssl ecparam -name prime256v1 -genkey -noout | openssl pkcs8 -topk8 -inform PEM -nocrypt -out private_key.pem
# Generate public key in SPKI format
openssl ec -in private_key.pem -pubout -outform PEM -out public_key.pem
```

> [!TIP]
> A key generator will be provided again in a future version of the user interface.

### 2. Configure CouchDB to accept JWT tokens

The following configuration is required:

| Key                            | Value                                     | Note                                                                                                                                                                                                                  |
| ------------------------------ | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| chttpd/authentication_handlers | {chttpd_auth, jwt_authentication_handler} | In total, it may be `{chttpd_auth, jwt_authentication_handler}, {chttpd_auth, cookie_authentication_handler}, {chttpd_auth, default_authentication_handler}`, or something similar.                                   |
| jwt_auth/required_claims       | "exp"                                     |                                                                                                                                                                                                                       |
| jwt_keys/ec:your_key_id        | Your public key in PEM (SPKI) format      | Replace `your_key_id` with your actual key ID. You can decide as you like. Note that you can add multiple keys if needed. If you want to use HSxxx, you should set `jwt_keys/hmac:your_key_id` with your HMAC secret. |


Note: When configuring CouchDB via web interface (Fauxton), new-lines on the public key should be replaced with `\n` for header and footer lines (So wired, but true I have tested). as follows:
```
-----BEGIN PUBLIC KEY-----
\nMIGbMBAGByqGSM49AgEGBSuBBAAjA4GGAAQBq0irb/+K0Qzo7ayIHj0Xtthcntjz
r665J5UYdEQMiTtku5rnp95RuN97uA2pPOJOacMBAoiVUnZ1pqEBz9xH9yoAixji
Ju...........................................................gTt
/xtqrJRwrEy986oRZRQ=
\n-----END PUBLIC KEY-----
```

For detailed information, please refer to the [CouchDB JWT Authentication Documentation](https://docs.couchdb.org/en/stable/api/server/authn.html#jwt-authentication).

### 3. Configure Self-hosted LiveSync to use JWT Authentication

| Setting                 | Description                                                                                                                                           |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Use JWT Authentication  | Enable this option to use JWT Authentication.                                                                                                         |
| JWT Algorithm           | Select the JWT signing algorithm (e.g., ES256, ES512) that matches your key pair.                                                                     |
| JWT Key                 | Paste your private key in PEM (pkcs8) format.                                                                                                         |
| JWT Expiration Duration | Set the token expiration time in minutes. Locally cached tokens are also invalidated after this duration.                                             |
| JWT Key ID (kid)        | Enter the key ID that you used when configuring CouchDB, i.e., the one that replaced `your_key_id`.                                                   |
| JWT Subject (sub)       | Set your user ID; this overrides the original `Username` setting. If you have detected access with `Username`, you have failed to authorise with JWT. |

> [!IMPORTANT]
> Self-hosted LiveSync requests to CouchDB treat the user as `_admin`. If you want to restrict access, configure `jwt_auth/roles_claim_name` to a custom claim name. (Self-hosted LiveSync always sets `_couchdb.roles` with the value `["_admin"]`).

### 4. Test the configuration

Just try to `Test Settings and Continue` in the remote setup dialogue. If you have successfully authenticated, you are all set.

## Additional Notes

This feature is still experimental. Please ensure to test thoroughly in your environment before deploying to production.

However, we think that this is a great step towards enhancing security when using CouchDB with Self-hosted LiveSync. We shall enable this setting by default in future releases.

We would love to hear your feedback and any issues you encounter.
