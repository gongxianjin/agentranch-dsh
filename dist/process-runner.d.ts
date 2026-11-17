import { type PluginConfig } from './config.js';
export type CommandSpec = {
    args: string[];
    purpose: 'identity' | 'check' | 'local-check' | 'runner' | 'controller';
};
export type CommandResult = {
    ok: boolean;
    command: string[];
    exitCode: number | null;
    signal: string | null;
    timedOut: boolean;
    durationMs: number;
    stdout: string;
    stderr: string;
    stdoutTruncated: boolean;
    stderrTruncated: boolean;
    json: unknown | null;
    jsonParseError: string | null;
    redacted: boolean;
    redactionHits: string[];
    diagnostics: string[];
};
/** Test hook for the termination-diagnostics contract; not part of the tool surface. */
export declare function terminateTreeForTest(pid: number): Promise<string[]>;
export declare function runAwCli(spec: CommandSpec, config: PluginConfig, timeoutMs?: number, signal?: AbortSignal): Promise<CommandResult>;
/** Test fixture runner; not exported through the DSH package entry or registered as a tool. */
export declare function runProcessForTest(executable: string, args: string[], config: PluginConfig, timeoutMs?: number, signal?: AbortSignal): Promise<CommandResult>;
