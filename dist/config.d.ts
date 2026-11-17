export type PluginConfig = {
    awCliPath: string;
    allowedRoots: string[];
    defaultTimeoutMs: number;
    maxOutputBytes: number;
};
export declare function clampTimeout(requested: number | undefined, config: PluginConfig): number;
export declare function loadConfig(rawConfig?: unknown): PluginConfig;
