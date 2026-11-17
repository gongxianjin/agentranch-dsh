import { PluginConfigError } from './errors.js';
import { validateAllowedRoot, validateConfiguredAwCli } from './paths.js';

export type PluginConfig = {
  awCliPath: string;
  allowedRoots: string[];
  defaultTimeoutMs: number;
  maxOutputBytes: number;
};

const MIN_TIMEOUT_MS = 100;
const MAX_TIMEOUT_MS = 120000;
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_OUTPUT_BYTES = 65536;
const MAX_OUTPUT_BYTES = 1048576;

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PluginConfigError('configuration_required', 'plugin configuration with awCliPath is required');
  }
  return value as Record<string, unknown>;
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function clampTimeout(requested: number | undefined, config: PluginConfig): number {
  const value = finiteNumber(requested, config.defaultTimeoutMs);
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.trunc(value)));
}

export function loadConfig(rawConfig?: unknown): PluginConfig {
  const raw = asRecord(rawConfig);
  if (typeof raw.awCliPath !== 'string') {
    throw new PluginConfigError('aw_cli_required', 'awCliPath must be explicitly configured');
  }
  if (!Array.isArray(raw.allowedRoots) || raw.allowedRoots.length === 0 ||
      !raw.allowedRoots.every(value => typeof value === 'string')) {
    throw new PluginConfigError('roots_required', 'at least one allowed root must be explicitly configured');
  }
  const awCliPath = validateConfiguredAwCli(raw.awCliPath);
  const allowedRoots = raw.allowedRoots.map(value => validateAllowedRoot(value as string));
  const config: PluginConfig = {
    awCliPath,
    allowedRoots: [...new Set(allowedRoots)],
    defaultTimeoutMs: DEFAULT_TIMEOUT_MS,
    maxOutputBytes: Math.min(MAX_OUTPUT_BYTES, Math.max(1024, Math.trunc(finiteNumber(raw.maxOutputBytes, DEFAULT_MAX_OUTPUT_BYTES)))),
  };
  config.defaultTimeoutMs = clampTimeout(finiteNumber(raw.defaultTimeoutMs, DEFAULT_TIMEOUT_MS), config);
  return Object.freeze(config);
}
