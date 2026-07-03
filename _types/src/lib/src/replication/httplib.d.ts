// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { CouchDBCredentials, JWTCredentials, JWTHeader, JWTParams, JWTPayload, PreparedJWT, RemoteDBSettings } from "@lib/common/types";
import { Computed } from "octagonal-wheels/dataobject/Computed";
/**
 * Generates a credential object based on the provided settings.
 * @param settings - RemoteDBSettings
 * @returns {CouchDBCredentials} credentials object
 */
export declare function generateCredentialObject(settings: RemoteDBSettings): {
    jwtAlgorithm: import("../common/models/auth.type").JWTAlgorithm;
    jwtKey: string;
    jwtKid: string;
    jwtSub: string;
    jwtExpDuration: number;
    type: "jwt";
    username?: undefined;
    password?: undefined;
} | {
    username: string;
    password: string;
    type: "basic";
    jwtAlgorithm?: undefined;
    jwtKey?: undefined;
    jwtKid?: undefined;
    jwtSub?: undefined;
    jwtExpDuration?: undefined;
};
/**
 * Generates a basic authentication header for CouchDB credentials using the provided username and password.
 * And it caches the result for performance if the credentials are not changed.
 */
export declare class BasicHeaderGenerator {
    _header: Computed<[source: CouchDBCredentials], string>;
    /**
     * Generates a basic authentication header for CouchDB credentials using the provided username and password.
     * @param auth - CouchDBCredentials
     * @returns {Promise<string>} The basic authentication header (without "Basic" prefix).
     */
    getBasicHeader(auth: CouchDBCredentials): Promise<string>;
}
/**
 * Generates a JWT token based on the provided credentials and parameters.
 * And it caches the result for performance if the credentials are not changed.
 */
export declare class JWTTokenGenerator {
    _importKey(auth: JWTCredentials): Promise<CryptoKey>;
    _currentCryptoKey: Computed<[auth: JWTCredentials], CryptoKey>;
    _jwt: Computed<[params: JWTParams], {
        token: string;
        header: JWTHeader;
        payload: JWTPayload;
        credentials: JWTCredentials;
    }>;
    _jwtParams: Computed<[source: JWTCredentials], {
        header: JWTHeader;
        payload: {
            exp: number;
            iat: number;
            sub: string;
            "_couchdb.roles": string[];
        };
        credentials: JWTCredentials;
    }>;
    getJWT(auth: JWTCredentials): Promise<PreparedJWT>;
    /**
     * Generates a JWT token based on the provided credentials and parameters.
     * @param auth - JWTCredentials
     * @returns {Promise<string>} The JWT token (with "Bearer" prefix).
     */
    getBearerToken(auth: JWTCredentials): Promise<string>;
}
export declare class AuthorizationHeaderGenerator {
    _basicHeader: BasicHeaderGenerator;
    _jwtHeader: JWTTokenGenerator;
    getAuthorizationHeader(auth: CouchDBCredentials): Promise<string>;
}
