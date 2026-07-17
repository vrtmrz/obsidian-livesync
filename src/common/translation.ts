import { $msg } from "@vrtmrz/livesync-commonlib/compat/common/i18n";
import type { MessageTranslator } from "@vrtmrz/livesync-commonlib/context";

/** Supplies the LiveSync language catalogue through the Commonlib host boundary. */
export const translateLiveSyncMessage: MessageTranslator = (key, params) =>
    $msg(key as Parameters<typeof $msg>[0], params === undefined ? undefined : { ...params });
