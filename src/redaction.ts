export type RedactionResult = {
  text: string;
  redacted: boolean;
  hits: string[];
};

const patterns: Array<[string, RegExp, string]> = [
  ['private_key', /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/gi, '[REDACTED_PRIVATE_KEY]'],
  ['authorization', /(Authorization["']?\s*:\s*["']?Bearer\s+)[^\s\r\n"']+/gi, '$1[REDACTED]'],
  ['token', /((?:token|access_token|refresh_token)["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'[^']*'|[^\s\r\n,;]+)/gi, '$1"[REDACTED]"'],
  ['password', /((?:password|passwd|secret)["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'[^']*'|[^\s\r\n,;]+)/gi, '$1"[REDACTED]"'],
  ['api_key', /((?:api[_-]?key|apikey)["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'[^']*'|[^\s\r\n,;]+)/gi, '$1"[REDACTED]"'],
];

export function redactModelOutput(text: string): RedactionResult {
  const hits = new Set<string>();
  const redactText = (value: string) => {
    let result = value;
    for (const [name, pattern, replacement] of patterns) {
      pattern.lastIndex = 0;
      if (pattern.test(result)) {
        hits.add(name);
        pattern.lastIndex = 0;
        result = result.replace(pattern, replacement);
      }
    }
    return result;
  };
  let result: string;
  try {
    const value: unknown = JSON.parse(text);
    const holder: Record<string, unknown> = { value };
    const stack = [holder];
    while (stack.length) {
      const object = stack.pop()!;
      for (const [key, entry] of Object.entries(object)) {
        const category = /^(?:token|access_token|refresh_token)$/i.test(key) ? 'token'
          : /^(?:password|passwd|secret)$/i.test(key) ? 'password'
          : /^(?:api[_-]?key|apikey)$/i.test(key) ? 'api_key'
          : /^authorization$/i.test(key) ? 'authorization' : undefined;
        if (category) { object[key] = '[REDACTED]'; hits.add(category); }
        else if (typeof entry === 'string') object[key] = redactText(entry);
        else if (entry && typeof entry === 'object') stack.push(entry as Record<string, unknown>);
      }
    }
    result = hits.size ? JSON.stringify(holder.value) : text;
  } catch { result = redactText(text); }
  return { text: result, redacted: hits.size > 0, hits: [...hits] };
}
