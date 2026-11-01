import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { accountConfigs, execute, safeMessage } from './heybox_daily.mjs';

const config = id => ({
  session: { heybox_id: id, pkey: 'SECRET-PKEY-123456', device_id: 'device-1234', x_xhh_tokenid: 'SECRET-TOKEN-123456' },
  device: { model: 'phone', osVersion: '14' },
  app: { version: '1.3.398', build: '1142', shaderVersion: '14' },
});

function core(overrides = {}) {
  return {
    validateConfig: value => { if (!value?.session?.heybox_id) throw new Error('配置缺少账号'); return value; },
    HeyboxClient: class { constructor(value) { this.config = value; } },
    inspect: async () => ({ signed: true, tasks: [
      { id: '1', state: 'finish' }, { id: '19', state: 'finish' }, { id: '31', state: 'waiting' },
    ], exp: 10, coin: 20 }),
    runDaily: async (_, __, { log }) => { log('签到完成'); return { completed: true, expDelta: 20, coinDelta: 2 }; },
    ...overrides,
  };
}

test('inline configuration accepts one or multiple accounts', () => {
  assert.deepEqual(accountConfigs({ HEYBOX_QL_ACCOUNTS: JSON.stringify(config('123')) }), [config('123')]);
  assert.equal(accountConfigs({ HEYBOX_QL_ACCOUNTS: JSON.stringify([config('123'), config('456')]) }).length, 2);
  assert.throws(() => accountConfigs({ HEYBOX_QL_ACCOUNTS: 'not json' }), /JSON/);
  assert.throws(() => accountConfigs({ HEYBOX_QL_ACCOUNTS: '[]' }), /为空/);
  assert.throws(() => accountConfigs({ HEYBOX_QL_ACCOUNTS: '{}', HEYBOX_CONFIG: '/tmp/a' }), /其中一种/);
});

test('directory accounts load in order and symlink entries are ignored', () => {
  const dir = mkdtempSync(join(tmpdir(), 'heybox-ql-'));
  try {
    writeFileSync(join(dir, 'b.json'), JSON.stringify(config('456')));
    writeFileSync(join(dir, 'a.json'), JSON.stringify(config('123')));
    writeFileSync(join(dir, 'README.txt'), 'ignored');
    symlinkSync(join(dir, 'a.json'), join(dir, 'symlink.json'));
    assert.deepEqual(accountConfigs({ HEYBOX_QL_CONFIG_DIR: dir }).map(c => c.session.heybox_id), ['123', '456']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('check mode produces safe aggregate output', async () => {
  const logs = [];
  const result = await execute([config('123')], core(), 'check', text => logs.push(text));
  assert.deepEqual(result, { succeeded: 1, failed: 0 });
  assert.match(logs.join('\n'), /分享任务：2\/3/);
  assert.doesNotMatch(logs.join('\n'), /SECRET|123/);
});

test('one account failing does not interrupt later accounts', async () => {
  const logs = [];
  const result = await execute([config('123'), config('456')], core({
    runDaily: async client => {
      if (client.config.session.heybox_id === '123') throw new Error(`key=${client.config.session.pkey}`);
      return { completed: true, expDelta: 3, coinDelta: 0 };
    },
  }), 'run', message => logs.push(message));
  assert.deepEqual(result, { succeeded: 1, failed: 1 });
  assert.match(logs.join('\n'), /账号 2.*完成/);
  assert.doesNotMatch(logs.join('\n'), /SECRET/);
});

test('duplicate account is rejected before second execution', async () => {
  let calls = 0;
  const result = await execute([config('123'), config('123')], core({
    runDaily: async () => { calls++; return { completed: true, expDelta: 0, coinDelta: 0 }; },
  }), 'run', () => {});
  assert.deepEqual(result, { succeeded: 1, failed: 1 });
  assert.equal(calls, 1);
});

test('unsupported mode is rejected and errors are sanitized', async () => {
  await assert.rejects(() => execute([config('123')], core(), 'login', () => {}), /只能是/);
  const message = safeMessage(new Error('pkey=SECRET-PKEY-123456 https://example.com/?token=abcdef mobile=13800138000'), config('123'));
  assert.doesNotMatch(message, /SECRET|abcdef|13800138000/);
});
