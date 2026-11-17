import { type ToolDefinition } from '@deepseek-ai/dsh-tools';
import type { ApprovalRequest, ApprovalOutcome } from '@deepseek-ai/dsh-user-approval';
import type { PluginConfig } from './config.js';
import { runAwCli } from './process-runner.js';
export type ToolServices = {
    run?: typeof runAwCli;
    requestApproval?: (request: ApprovalRequest) => Promise<ApprovalOutcome>;
};
/** Dependencies are host-owned; none can be supplied in a tool's model arguments. */
export declare function createTools(config: PluginConfig, services?: ToolServices): ToolDefinition[];
