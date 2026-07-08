// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
export type CouchDBCredentials = BasicCredentials | JWTCredentials;
export type JWTAlgorithm = "HS256" | "HS512" | "ES256" | "ES512" | "";
export type Credential = {
    username: string;
    password: string;
};
export type BasicCredentials = {
    username: string;
    password: string;
    type: "basic";
};
export type JWTCredentials = {
    jwtAlgorithm: JWTAlgorithm;
    jwtKey: string;
    jwtKid: string;
    jwtSub: string;
    jwtExpDuration: number;
    type: "jwt";
};
export interface JWTHeader {
    alg: string;
    typ: string;
    kid?: string;
}
export interface JWTPayload {
    sub: string;
    exp: number;
    iss?: string;
    iat: number;
    [key: string]: unknown;
}
export interface JWTParams {
    header: JWTHeader;
    payload: JWTPayload;
    credentials: JWTCredentials;
}
export interface PreparedJWT {
    header: JWTHeader;
    payload: JWTPayload;
    token: string;
}
