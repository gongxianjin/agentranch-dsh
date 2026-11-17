export declare class PluginConfigError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
export declare class PathPolicyError extends PluginConfigError {
    constructor(code: string, message: string);
}
