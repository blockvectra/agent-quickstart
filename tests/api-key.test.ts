import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {test, type TestContext} from "node:test";
import {readSavedApiKey, saveApiKey, parseCreatedApiKey} from "../src/api-key.js";

const ADDRESS = `0x${"a".repeat(40)}`;
const KEY = {api_key: "rgw_fixture_not_real", key_id: "k_fixture", wallet_address: ADDRESS};
function fixture(t: TestContext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quickstart-key-file-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  return {dir, file: path.join(dir, '.agent-key.json')};
}

test('saved credentials preserve bytes and accept the same address regardless of case', (t) => {
  const {file} = fixture(t);
  assert.equal(readSavedApiKey(file, ADDRESS), undefined);
  saveApiKey(file, KEY);
  const original = fs.readFileSync(file);
  assert.deepEqual(readSavedApiKey(file, ADDRESS.toUpperCase()), KEY);
  assert.throws(() => saveApiKey(file, {...KEY, api_key: 'different'}), /Cannot save/);
  assert.ok(fs.readFileSync(file).equals(original));
});

test('malformed, foreign-wallet and permissive files are preserved, not silently replaced', (t) => {
  const {file} = fixture(t);
  for (const value of ['{broken', 'null', '[]', '{}', JSON.stringify({...KEY, api_key: 'bad\r\nvalue'}),
    JSON.stringify({...KEY, wallet_address: `0x${"b".repeat(40)}`}), JSON.stringify({...KEY, key_id: '../bad'})]) {
    fs.writeFileSync(file, value, {mode: 0o600});
    assert.throws(() => readSavedApiKey(file, ADDRESS), error => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Invalid saved API key/);
      assert.ok(!error.message.includes(KEY.api_key));
      return true;
    });
    assert.equal(fs.readFileSync(file, 'utf8'), value);
  }
  if (process.platform !== 'win32') {
    fs.writeFileSync(file, JSON.stringify(KEY));fs.chmodSync(file, 0o644);
    assert.throws(() => readSavedApiKey(file, ADDRESS), /Invalid saved API key/);
    assert.equal(fs.statSync(file).mode & 0o777, 0o644);
  }
});

test('symlink and oversized credential paths are rejected without touching targets', (t) => {
  const {dir, file} = fixture(t);
  const target = path.join(dir, 'target');
  fs.writeFileSync(target, JSON.stringify(KEY), {mode: 0o600});
  fs.symlinkSync(target, file);
  assert.throws(() => readSavedApiKey(file, ADDRESS), /Invalid saved API key/);
  assert.throws(() => saveApiKey(file, KEY), /Cannot save/);
  assert.equal(fs.readFileSync(target, 'utf8'), JSON.stringify(KEY));
  fs.unlinkSync(file);fs.writeFileSync(file, ' '.repeat(16_385), {mode: 0o600});
  assert.throws(() => readSavedApiKey(file, ADDRESS), /Invalid saved API key/);
});

test('untrusted create responses fail locally without putting their contents in errors', () => {
  assert.deepEqual(parseCreatedApiKey({api_key: KEY.api_key, key: {key_id: KEY.key_id}}, ADDRESS), KEY);
  for (const value of [null, [], {}, {api_key: KEY.api_key, key: {key_id: '../secret'}},
    {api_key: 'bad\nheader', key: {key_id: KEY.key_id}}]) {
    assert.throws(() => parseCreatedApiKey(value, ADDRESS), {message: 'Invalid created API key response.'});
  }
});
