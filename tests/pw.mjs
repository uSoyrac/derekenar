// Playwright'ı bulur: önce tests/node_modules, yoksa bu geliştirme ortamındaki ortak kurulum.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require('/opt/node-tools/node_modules/playwright'); }
export const chromium = pw.chromium;
