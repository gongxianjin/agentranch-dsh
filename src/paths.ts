import { lstatSync, realpathSync } from 'node:fs';
import { isAbsolute, normalize, parse, relative, resolve, sep } from 'node:path';
import { PathPolicyError } from './errors.js';

function validatePathText(value: string): void {
  if (typeof value !== 'string' || value.length === 0) {
    throw new PathPolicyError('empty_path', 'path must not be empty');
  }
  if (/[\u0000-\u001f\u007f]/u.test(value)) {
    throw new PathPolicyError('control_character', 'path contains NUL or control characters');
  }
  if (!isAbsolute(value)) {
    throw new PathPolicyError('relative_path', 'path must be absolute');
  }
  if (value.length > 32767) {
    throw new PathPolicyError('path_too_long', 'path exceeds the supported platform limit');
  }
}

function normalizedCase(value: string): string {
  const result = normalize(value);
  return process.platform === 'win32' ? result.toLowerCase() : result;
}

function isWithin(root: string, target: string): boolean {
  const rel = relative(normalizedCase(root), normalizedCase(target));
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

function rejectLinksInPath(value: string): void {
  const absolute = resolve(value);
  const parsed = parse(absolute);
  const parts = absolute.slice(parsed.root.length).split(/[\\/]/u).filter(Boolean);
  let current = parsed.root;
  for (const part of parts) {
    current = resolve(current, part);
    const info = lstatSync(current);
    if (info.isSymbolicLink()) {
      throw new PathPolicyError('link_rejected', 'symlink, junction, or reparse-point path is not allowed');
    }
  }
}

function canonicalUnlinkedPath(value: string): string {
  validatePathText(value);
  rejectLinksInPath(value);
  const canonical = realpathSync(value);
  if (normalizedCase(canonical) !== normalizedCase(resolve(value))) {
    throw new PathPolicyError('reparse_rejected', 'reparse-point or canonical path rewrite is not allowed');
  }
  return canonical;
}

export function validateConfiguredAwCli(value: string): string {
  const canonical = canonicalUnlinkedPath(value);
  const info = lstatSync(canonical);
  if (!info.isFile()) {
    throw new PathPolicyError('not_regular_file', 'awCliPath must be a regular file, not a directory');
  }
  return canonical;
}

export function validateAllowedRoot(value: string): string {
  const canonical = canonicalUnlinkedPath(value);
  const info = lstatSync(canonical);
  if (!info.isDirectory()) {
    throw new PathPolicyError('not_directory', 'allowed root must be a directory');
  }
  return canonical;
}

export function validateInvocationPath(
  value: string,
  roots: string[],
  kind: 'config' | 'state',
): string {
  const canonical = canonicalUnlinkedPath(value);
  const allowed = roots.map(validateAllowedRoot);
  if (!allowed.some(root => isWithin(root, canonical))) {
    throw new PathPolicyError('outside_root', 'path is outside the configured allowed roots');
  }
  const info = lstatSync(canonical);
  if (kind === 'config' && !info.isFile()) {
    throw new PathPolicyError('not_regular_file', 'config path must be a regular file');
  }
  if (kind === 'state' && !info.isDirectory()) {
    throw new PathPolicyError('not_directory', 'state path must be a directory');
  }
  return canonical;
}
