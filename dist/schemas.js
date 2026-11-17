export const timeoutParameter = { type: 'integer', description: 'Milliseconds, clamped to 100–120000.' };
export const configParameter = { type: 'string', required: true, description: 'Existing absolute config file inside a user-configured allowed root.' };
export const resultSchema = {
    type: 'object', additionalProperties: false,
    properties: {
        ok: { type: 'boolean', required: true },
        status: { type: 'string', enum: ['confirmation_required'] },
        command: { type: 'array', items: { type: 'string' }, required: true },
        exitCode: { oneOf: [{ type: 'integer' }, { type: 'null' }], required: true },
        signal: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
        timedOut: { type: 'boolean', required: true },
        durationMs: { type: 'integer', required: true },
        stdout: { type: 'string', required: true },
        stderr: { type: 'string', required: true },
        stdoutTruncated: { type: 'boolean', required: true },
        stderrTruncated: { type: 'boolean', required: true },
        json: { type: 'json', required: true },
        jsonParseError: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
        redacted: { type: 'boolean', required: true },
        redactionHits: { type: 'array', items: { type: 'string' }, required: true },
        diagnostics: { type: 'array', items: { type: 'string' }, required: true },
    },
};
