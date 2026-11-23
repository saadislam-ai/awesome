/** Editing spec files from inside the app: checks, stamping, personal copies. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { SPEC_FILES, bundledSpecsDir, inspectSpecFile, loadSpecs, markVerified, readSpecFile, resetSpecFile, saveSpecFile } from '@borderless/core';
import { NodeHost } from '../src/nodeHost';

const host = new NodeHost();
const userDir = path.join(os.tmpdir(), `borderless-specs-${process.pid}`).replace(/\\/g, '/');
let bundled = '';

beforeAll(async () => {
  bundled = bundledSpecsDir((await host.paths()).resources);
});
afterAll(() => fs.rmSync(userDir, { recursive: true, force: true }));

describe('spec file editor', () => {
  it('every shipped spec file is valid, dated and names its sources', async () => {
    for (const { file } of SPEC_FILES) {
      const { text, origin } = await readSpecFile(host, bundled, userDir, file);
      const info = inspectSpecFile(file, text);
      expect(origin).toBe('bundled');
      expect(info.errors, file).toEqual([]);
      expect(info.verifiedOn, file).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(info.sources.length, file).toBeGreaterThan(0);
      for (const s of info.sources) expect(s.url, file).toMatch(/^https:\/\//);
    }
  });

  it('warns when a file was last checked more than six months ago', async () => {
    const { text } = await readSpecFile(host, bundled, userDir, 'kdp.json');
    const info = inspectSpecFile('kdp.json', text, new Date(2027, 6, 1));
    expect(info.stale).toBe(true);
    expect(info.monthsOld).toBeGreaterThanOrEqual(7);
    expect(inspectSpecFile('kdp.json', text, new Date(2027, 0, 15)).stale).toBe(false);
    // Stamping it with the day it was checked again clears the warning and changes nothing else.
    const stamped = markVerified('kdp.json', text, new Date(2027, 6, 1));
    expect(inspectSpecFile('kdp.json', stamped, new Date(2027, 6, 1))).toMatchObject({ stale: false, verifiedOn: '2027-07-01', valid: true });
    expect(stamped.replace('2027-07-01', 'X')).toBe(text.replace(/("lastVerified"\s*:\s*")[^"]*/, '$1X'));
    expect(markVerified('currencies.json', '{\n  "date": "2026-01-01"\n}', new Date(2027, 0, 9))).toBe('{\n  "date": "2027-01-09"\n}');
  });

  it('explains what is wrong with a broken file and refuses to save it', async () => {
    const { text } = await readSpecFile(host, bundled, userDir, 'kdp.json');
    expect(inspectSpecFile('kdp.json', text.slice(0, 200)).errors[0]).toMatch(/Not valid JSON/);
    const wrongType = text.replace(/"lastVerified"\s*:\s*"[^"]*"/, '"lastVerified": 5');
    expect(inspectSpecFile('kdp.json', wrongType).errors.join(' ')).toMatch(/lastVerified/);
    await expect(saveSpecFile(host, userDir, 'kdp.json', wrongType)).rejects.toThrow(/was not saved/);
    await expect(saveSpecFile(host, userDir, 'ingramspark.json', text)).rejects.toThrow(/"platform" must be "ingramspark"/);
    await expect(saveSpecFile(host, userDir, '../evil.json', text)).rejects.toThrow(/not a spec file/);
    expect(fs.existsSync(userDir)).toBe(false);
  });

  it('saves a personal copy that is used from then on, and goes back to the shipped file on request', async () => {
    const { text } = await readSpecFile(host, bundled, userDir, 'kdp.json');
    const edited = markVerified('kdp.json', text, new Date(2030, 0, 2));
    await saveSpecFile(host, userDir, 'kdp.json', edited);
    expect((await readSpecFile(host, bundled, userDir, 'kdp.json')).origin).toBe('user');
    let set = await loadSpecs(host, bundled, userDir);
    expect(set.origin['kdp.json']).toBe('user');
    expect(set.platforms.kdp?.lastVerified).toBe('2030-01-02');
    // The shipped file is untouched.
    expect(fs.readFileSync(`${bundled}/kdp.json`, 'utf8')).toBe(text);
    expect(await resetSpecFile(host, userDir, 'kdp.json')).toBe(true);
    expect(await resetSpecFile(host, userDir, 'kdp.json')).toBe(false);
    set = await loadSpecs(host, bundled, userDir);
    expect(set.origin['kdp.json']).toBe('bundled');
  });
});
