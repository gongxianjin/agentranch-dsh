import type { Context } from '@deepseek-ai/cordis';
import type { ApprovalService } from '@deepseek-ai/dsh-user-approval';
import { loadConfig } from './config.js';
import { createTools } from './tools.js';

export const name = 'agentranch-dsh';
export const pluginName = name;
export const inject = ['tools'];

const instances = new WeakSet<Context>();

export function apply(ctx: Context, rawConfig?: unknown): void {
  // Synchronous by contract: the DSH host loader does not await an async
  // apply, so an async rejection would be silently dropped (probed
  // 2026-11-17 against dsh 0.2.2-rc.1). Validation and registration must
  // both complete synchronously for the host's startup audit to surface
  // configuration errors and for tools to exist before the first step.
  if (instances.has(ctx)) return;
  const config = loadConfig(rawConfig);
  const tools = createTools(config, {
    requestApproval(request) {
      const approval = ctx.get('approval') as ApprovalService | undefined;
      return approval ? approval.request(request) : Promise.resolve('unavailable' as const);
    },
  });
  const disposers: Array<() => void> = [];
  try {
    for (const tool of tools) disposers.push(ctx.tools.register(tool));
  } catch (error) {
    for (const dispose of disposers.reverse()) dispose();
    throw error;
  }
  instances.add(ctx);
}
