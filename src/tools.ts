import { basename } from 'node:path';
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools';
import type { ApprovalRequest, ApprovalOutcome } from '@deepseek-ai/dsh-user-approval';
import type { PluginConfig } from './config.js';
import { validateInvocationPath } from './paths.js';
import { runAwCli } from './process-runner.js';
import { configParameter, resultSchema, timeoutParameter, type SafeToolResult } from './schemas.js';

export type ToolServices = {
  run?: typeof runAwCli;
  requestApproval?: (request: ApprovalRequest) => Promise<ApprovalOutcome>;
};

function render(result: SafeToolResult, boundary = '') {
  const status = result.status ?? (result.ok ? 'process exited successfully' : 'process failed or did not execute');
  return [{ type: 'text' as const, text: `${status}${boundary ? ` — ${boundary}` : ''}\n${JSON.stringify(result, null, 2)}` }];
}

function confirmationRequired(reason: string): SafeToolResult {
  return {
    ok: false, status: 'confirmation_required', command: [], exitCode: null, signal: null,
    timedOut: false, durationMs: 0, stdout: '', stderr: '', stdoutTruncated: false,
    stderrTruncated: false, json: null, jsonParseError: null, redacted: false,
    redactionHits: [], diagnostics: [reason],
  };
}

/** Dependencies are host-owned; none can be supplied in a tool's model arguments. */
export function createTools(config: PluginConfig, services: ToolServices = {}): ToolDefinition[] {
  const run = services.run ?? runAwCli;
  const invoke = async (...args: Parameters<typeof runAwCli>): Promise<SafeToolResult> => {
    const result = await run(...args);
    // Runner JSON is parsed from bounded, redacted stdout and is lossless JSON.
    return { ...result, json: JSON.parse(JSON.stringify(result.json)) };
  };
  const tools = [
    defineTool({
      name: 'agentranch_identity', description: 'Read the identity of the user-configured AgentRanch binary. No executable override.',
      parameters: {}, output: { schema: resultSchema, render: (_args, value) => render(value) },
      async execute(_args, exec) {
        exec.signal.throwIfAborted();
        return invoke({ purpose: 'identity', args: ['--identity'] }, config, undefined, exec.signal);
      },
    }),
    defineTool({
      name: 'agentranch_check', description: 'Validate AgentRanch configuration locally. Does not actively probe external readiness.',
      parameters: { configPath: configParameter, timeoutMs: timeoutParameter },
      output: { schema: resultSchema, render: (_args, value) => render(value, 'local configuration only; not external readiness verification') },
      async execute(args, exec) {
        exec.signal.throwIfAborted();
        const path = await validateInvocationPath(args.configPath, config.allowedRoots, 'config');
        exec.signal.throwIfAborted();
        return invoke({ purpose: 'check', args: ['check', '--config', path] }, config, args.timeoutMs, exec.signal);
      },
    }),
    defineTool({
      name: 'agentranch_local_check', description: 'Run the local simulated fixture in an allowed state directory (writes local diagnostic state). Not real remote execution. Expect exit 2 "uncertain task remains in ledger": completion requires Linux-only owner evidence and stays honestly unknown on Windows.',      parameters: { stateDir: { type: 'string', required: true, description: 'Existing absolute state directory within an allowed root.' }, timeoutMs: timeoutParameter },
      output: { schema: resultSchema, render: (_args, value) => render(value, 'local simulated fixture; not real remote execution') },
      async execute(args, exec) {
        exec.signal.throwIfAborted();
        const path = await validateInvocationPath(args.stateDir, config.allowedRoots, 'state');
        exec.signal.throwIfAborted();
        return invoke({ purpose: 'local-check', args: ['local-check', '--state-dir', path] }, config, args.timeoutMs, exec.signal);
      },
    }),
    defineTool({
      name: 'agentranch_run_once', description: 'Run runner or controller --once. May cause AgentRanch side effects; requires a fresh human approval for every invocation.',
      parameters: { mode: { type: 'string', enum: ['runner', 'controller'], required: true }, configPath: configParameter, timeoutMs: timeoutParameter },
      output: { schema: resultSchema, render: (_args, value) => render(value) },
      async execute(args, exec) {
        exec.signal.throwIfAborted();
        const path = await validateInvocationPath(args.configPath, config.allowedRoots, 'config');
        const requestApproval = services.requestApproval;
        if (!requestApproval || !exec.agent) return confirmationRequired('approval_unavailable');
        const reason = `Run AgentRanch ${args.mode} --once using ${basename(path)}? AgentRanch may perform side effects (副作用).`;
        const outcome = await requestApproval({ agent: exec.agent, toolName: 'agentranch_run_once', callId: exec.callId, reason, signal: exec.signal });
        exec.signal.throwIfAborted();
        if (outcome !== 'allowed-once') return confirmationRequired(`approval_${outcome}`);
        // Revalidate after the human wait; no model-supplied confirmation flag or cached grants.
        const currentPath = await validateInvocationPath(path, config.allowedRoots, 'config');
        exec.signal.throwIfAborted();
        return invoke({ purpose: args.mode, args: [args.mode, '--config', currentPath, '--once'] }, config, args.timeoutMs, exec.signal);
      },
    }),
  ];
  // DSH 0.2.2-rc.1 intentionally compiles an open implicit root. The returned
  // schema is also captured by defineTool's validator; close it before registration.
  for (const tool of tools) tool.parameters.additionalProperties = false;
  return tools;
}
