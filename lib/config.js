import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CONFIG_DIR = join(homedir(), '.rootr');
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');

const DEFAULT_BASE_URL = 'https://rootr.io/api/v1';

/**
 * Read the on-disk config file. Returns {} if it doesn't exist or is invalid.
 */
function readConfigFile() {
  if (!existsSync(CONFIG_PATH)) return {};
  try {
    const raw = readFileSync(CONFIG_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/**
 * Resolve effective configuration: env vars take priority over the config file.
 */
export function loadConfig() {
  const file = readConfigFile();

  const apiKey = process.env.ROOTR_API_KEY || file.apiKey || '';
  const workspace = process.env.ROOTR_WORKSPACE || file.workspace || '';
  const baseUrl = process.env.ROOTR_BASE_URL || file.baseUrl || DEFAULT_BASE_URL;

  return { apiKey, workspace, baseUrl };
}

/**
 * Persist config to ~/.rootr/config.json (chmod 600). Merges with existing file contents.
 */
export function saveConfig(partial) {
  const existing = readConfigFile();
  const next = { ...existing, ...partial };

  // Drop undefined values so we don't write "apiKey": undefined
  for (const key of Object.keys(next)) {
    if (next[key] === undefined) delete next[key];
  }

  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }

  writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2) + '\n', {
    mode: 0o600,
  });

  try {
    // Ensure permissions are correct even if the file already existed with looser perms.
    chmodSync(CONFIG_PATH, 0o600);
  } catch {
    // best effort; not fatal on platforms without chmod support
  }

  return next;
}

export function maskKey(key) {
  if (!key) return '(not set)';
  return key.slice(0, 12) + '...';
}

export { CONFIG_PATH, DEFAULT_BASE_URL };
