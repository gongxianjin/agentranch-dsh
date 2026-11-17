export type RedactionResult = {
    text: string;
    redacted: boolean;
    hits: string[];
};
export declare function redactModelOutput(text: string): RedactionResult;
