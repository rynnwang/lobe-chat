// import env
import { Crypto } from '@peculiar/webcrypto';
import * as dotenv from 'dotenv';

dotenv.config();

// Bun (used to run this suite in CI) and newer Node versions already define a
// read-only global `crypto`, so only polyfill it where it's actually missing.
if (!globalThis.crypto) {
  global.crypto = new Crypto();
}
