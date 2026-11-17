import type { InferValue } from '@deepseek-ai/dsh-tools';
export declare const timeoutParameter: {
    readonly type: "integer";
    readonly description: "Milliseconds, clamped to 100–120000.";
};
export declare const configParameter: {
    readonly type: "string";
    readonly required: true;
    readonly description: "Existing absolute config file inside a user-configured allowed root.";
};
export declare const resultSchema: {
    readonly type: "object";
    readonly additionalProperties: false;
    readonly properties: {
        readonly ok: {
            readonly type: "boolean";
            readonly required: true;
        };
        readonly status: {
            readonly type: "string";
            readonly enum: readonly ["confirmation_required"];
        };
        readonly command: {
            readonly type: "array";
            readonly items: {
                readonly type: "string";
            };
            readonly required: true;
        };
        readonly exitCode: {
            readonly oneOf: readonly [{
                readonly type: "integer";
            }, {
                readonly type: "null";
            }];
            readonly required: true;
        };
        readonly signal: {
            readonly oneOf: readonly [{
                readonly type: "string";
            }, {
                readonly type: "null";
            }];
            readonly required: true;
        };
        readonly timedOut: {
            readonly type: "boolean";
            readonly required: true;
        };
        readonly durationMs: {
            readonly type: "integer";
            readonly required: true;
        };
        readonly stdout: {
            readonly type: "string";
            readonly required: true;
        };
        readonly stderr: {
            readonly type: "string";
            readonly required: true;
        };
        readonly stdoutTruncated: {
            readonly type: "boolean";
            readonly required: true;
        };
        readonly stderrTruncated: {
            readonly type: "boolean";
            readonly required: true;
        };
        readonly json: {
            readonly type: "json";
            readonly required: true;
        };
        readonly jsonParseError: {
            readonly oneOf: readonly [{
                readonly type: "string";
            }, {
                readonly type: "null";
            }];
            readonly required: true;
        };
        readonly redacted: {
            readonly type: "boolean";
            readonly required: true;
        };
        readonly redactionHits: {
            readonly type: "array";
            readonly items: {
                readonly type: "string";
            };
            readonly required: true;
        };
        readonly diagnostics: {
            readonly type: "array";
            readonly items: {
                readonly type: "string";
            };
            readonly required: true;
        };
    };
};
export type SafeToolResult = InferValue<typeof resultSchema>;
