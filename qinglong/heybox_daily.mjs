// QingLong-only entrypoint: reuse the existing TypeScript core; no web service.
// cron: 15 9 * * * (Asia/Shanghai); start with qinglong/heybox_daily.sh.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_CONFIG = join(root, 'private', 'config.json');

function readJson(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')); }
  catch { throw new Error(`无法读取或解析配置文件：${file}`); }
}

/** Exactly one credential source; do not accidentally run the same account twice. */
export function accountConfigs(env = process.env) {
  const inline = env.HEYBOX_QL_ACCOUNTS?.trim();
  const directory = env.HEYBOX_QL_CONFIG_DIR?.trim();
  const single = env.HEYBOX_CONFIG?.trim();
  if ([inline, directory, single].filter(Boolean).length > 1) {
    throw new Error('请只配置 HEYBOX_QL_ACCOUNTS、HEYBOX_QL_CONFIG_DIR 或 HEYBOX_CONFIG 其中一种账号来源');
  }
  if (inline) {
    let value;
    try { value = JSON.parse(inline); }
    catch { throw new Error('HEYBOX_QL_ACCOUNTS 必须是 JSON 对象或 JSON 数组'); }
    const configs = Array.isArray(value) ? value : [value];
    if (!configs.length) throw new Error('HEYBOX_QL_ACCOUNTS 为空');
    return configs;
  }
  if (directory) {
    const path = resolve(directory);
    let filenames;
    try {
      filenames = readdirSync(path, { withFileTypes: true })
        .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
        .map(entry => entry.name).sort();
    } catch { throw new Error('无法访问 HEYBOX_QL_CONFIG_DIR 配置目录'); }
    if (!filenames.length) throw new Error('配置目录中没有 JSON 账号文件');
    return filenames.map(name => readJson(join(path, name)));
  }
  return [readJson(single ? (isAbsolute(single) ? single : resolve(single)) : DEFAULT_CONFIG)];
}

/** Only return short redacted errors; never print tokens, cookies or raw responses. */
export function safeMessage(error, config) {
  let message = error instanceof Error ? error.message : '未知错误';
  for (const secret of [config?.session?.pkey, config?.session?.x_xhh_tokenid, config?.session?.device_id]
    .filter(value => typeof value === 'string' && value.length >= 4)) {
    message = message.replaceAll(secret, '[redacted]');
    try { message = message.replaceAll(encodeURIComponent(secret), '[redacted]'); } catch { /* malformed unicode */ }
  }
  return message
    .replace(/https?:\/\/[^\s]+/gi, '[url]')
    .replace(/\b(?:authorization|cookie|set-cookie)\s*[:=][^\r\n]*/gi, '[credentials redacted]')
    .replace(/\b(?:pkey|x_pkey|x_xhh_tokenid|token|imei|device_id|password|secret)\s*[:=]\s*[^\s,;}]+/gi, '[redacted]')
    .replace(/(?<!\d)\+?\d{8,15}(?!\d)/g, '[redacted]')
    .replace(/[A-Za-z0-9+/_=-]{32,}/g, '[redacted]')
    .slice(0, 240);
}

export async function execute(configs, core, mode = 'run', log = console.log) {
  if (!['run', 'check'].includes(mode)) throw new Error('运行模式只能是 run 或 check');
  if (!Array.isArray(configs) || !configs.length) throw new Error('未配置账号');
  let succeeded = 0, failed = 0;
  const accounts = new Set();
  for (const [index, raw] of configs.entries()) {
    const label = `账号 ${index + 1}`;
    try {
      const config = core.validateConfig(raw);
      const id = config.session.heybox_id;
      if (accounts.has(id)) throw new Error('盒友 ID 重复，请删除重复账号');
      accounts.add(id);
      const client = new core.HeyboxClient(config);
      log(`[${label}] ${mode === 'check' ? '检查' : '执行'}开始`);
      if (mode === 'check') {
        const status = await core.inspect(client, id);
        const tasks = status.tasks.filter(task => ['1', '19', '31'].includes(task.id));
        log(`[${label}] 签到：${status.signed ? '已完成' : '未完成'}；分享任务：${tasks.filter(task => task.state === 'finish').length}/3；经验 ${status.exp}；H 币 ${status.coin}`);
      } else {
        const result = await core.runDaily(client, id, { log: text => log(`[${label}] ${text}`) });
        if (!result.completed) throw new Error('每日任务未全部完成');
        log(`[${label}] 完成；经验 ${result.expDelta == null ? '未知' : `+${result.expDelta}`}；H 币 ${result.coinDelta >= 0 ? '+' : ''}${result.coinDelta}`);
      }
      succeeded++;
    } catch (error) {
      failed++;
      log(`[${label}] 失败：${safeMessage(error, raw)}`);
    }
  }
  log(`小黑盒 ${mode} 结束：成功 ${succeeded}，失败 ${failed}`);
  return { succeeded, failed };
}

export async function main(args = process.argv.slice(2), env = process.env, log = console.log) {
  const mode = args[0] || 'run';
  if (args.length > 1 || !['run', 'check'].includes(mode)) throw new Error('用法：node qinglong/heybox_daily.mjs [run|check]');
  const configs = accountConfigs(env);
  try { readFileSync(join(root, 'dist', 'cli.js')); }
  catch { throw new Error('缺少已编译的核心程序，请使用 sh qinglong/heybox_daily.sh 自动构建'); }
  const [config, client, tasks] = await Promise.all([
    import(pathToFileURL(join(root, 'dist', 'config.js')).href),
    import(pathToFileURL(join(root, 'dist', 'client.js')).href),
    import(pathToFileURL(join(root, 'dist', 'tasks.js')).href),
  ]);
  const result = await execute(configs, { ...config, ...client, ...tasks }, mode, log);
  if (result.failed) process.exitCode = 1;
  return result;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => { console.error(safeMessage(error)); process.exitCode = 1; });
}
