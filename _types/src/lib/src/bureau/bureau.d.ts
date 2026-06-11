import { type SlipBoard } from "octagonal-wheels/bureau/SlipBoard";
declare global {
    interface Slips extends LSSlips {
        _dummy: undefined;
    }
}
export declare const globalSlipBoard: SlipBoard<Slips>;
