// The standalone Deno utilities deliberately remain pinned to one immutable
// Commonlib registry release. Static npm specifiers cannot interpolate this
// value, so livesync-commonlib-version.test.ts verifies the domain-specific
// facades against it.
export const LIVESYNC_COMMONLIB_VERSION = "0.1.32-next.0";
