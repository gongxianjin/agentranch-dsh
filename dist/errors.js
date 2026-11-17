export class PluginConfigError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = 'PluginConfigError';
        this.code = code;
    }
}
export class PathPolicyError extends PluginConfigError {
    constructor(code, message) {
        super(code, message);
        this.name = 'PathPolicyError';
    }
}
