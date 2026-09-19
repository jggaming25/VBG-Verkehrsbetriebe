import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

function flagFile() {
  return path.join(config.dataDir, 'system.flag');
}

export function writeFlag(action) {
  try {
    fs.mkdirSync(config.dataDir, { recursive: true });
    fs.writeFileSync(flagFile(), action);
  } catch {
    /* ignore */
  }
}

export function readFlag() {
  try {
    return fs.readFileSync(flagFile(), 'utf8').trim().toLowerCase();
  } catch {
    return '';
  }
}

export function clearFlag() {
  try {
    fs.unlinkSync(flagFile());
  } catch {
    /* ignore */
  }
}

export function isStopped() {
  return readFlag() === 'stop';
}