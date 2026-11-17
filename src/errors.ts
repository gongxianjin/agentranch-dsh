export class PluginConfigError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'PluginConfigError';
    this.code = code;
  }
}

export class PathPolicyError extends PluginConfigError {
  constructor(code: string, message: string) {
    super(code, message);
    this.name = 'PathPolicyError';
  }
}
