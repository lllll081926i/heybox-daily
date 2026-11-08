# 青龙纯脚本运行

本目录为 QingLong/青龙提供 **纯脚本定时任务**，不需要启动前端、WebUI、Cloudflare Worker、Runner、数据库或 Docker。调用本项目既有 TypeScript 核心执行签到和三项分享任务，不另写签名算法。原项目的网页与 Docker 功能保持不变，但青龙运行**不会使用**它们。

## 运行环境

- Node.js **24+**，npm 或 pnpm 12.15.0；首次编译要有 npm 网络，运行时无需浏览器、Java 或 Android 设备。
- 青龙新版默认镜像有 Node.js 24；旧镜像请先检查 `node -v`。
- 需要克隆**完整仓库**（包含 `src/`、`package.json`、`pnpm-workspace.yaml`、`pnpm-lock.yaml`）。青龙普通“订阅”可能仅拷贝过滤后的脚本，不一定保留 TypeScript 源码，推荐在**青龙容器终端**执行：

```sh
mkdir -p /ql/data/scripts
cd /ql/data/scripts
git clone https://github.com/lllll081926i/heybox-daily.git
```

若要在 PR 合并前验证功能，请切换到 PR 对应的 `feat/qinglong-script-only` 分支。

在“定时任务”中新增：

```text
名称：小黑盒签到与每日任务
命令：sh /ql/data/scripts/heybox-daily/qinglong/heybox_daily.sh run
Cron：15 9 * * *
```

`run` 执行签到、分享帖子、分享游戏、分享游戏评价（已经完成的任务会跳过）；`check` 只读签到和分享任务状态。Cron 采用**青龙的任务时区**，核心签到日期使用北京时间，建议设置 `TZ=Asia/Shanghai`。

入口脚本会在首次运行或 `src/` 更新后安装仓库锁定依赖并编译（不会构建前端）；`flock` 可用时会对**构建和任务执行**一起加锁，防止重复运行。请避免同时开启旧 Docker 定时任务。

## 账号登录与配置

推荐使用独立私密文件目录，避免把 APP 凭证放进 Git 仓库或打印到青龙日志。

```sh
mkdir -p /ql/data/config/heybox-daily
chmod 700 /ql/data/config/heybox-daily

# 首次运行任务自动完成依赖安装/编译；没有账号会在编译后提示。
sh /ql/data/scripts/heybox-daily/qinglong/heybox_daily.sh check

# 登录必须在支持交互输入的青龙容器终端进行，而不是非交互定时日志。
cd /ql/data/scripts/heybox-daily
HEYBOX_CONFIG=/ql/data/config/heybox-daily/account-1.json node dist/cli.js login
# 多账号可以重复登录，换用 account-2.json 等不同路径
chmod 600 /ql/data/config/heybox-daily/*.json
```

在青龙环境变量中设置：

```text
HEYBOX_QL_CONFIG_DIR=/ql/data/config/heybox-daily
```

登录使用本项目的 APP 短信验证码流程，自动生成包含 `heybox_id`、`pkey`、`device_id`、`x_xhh_tokenid` 的完整配置；**普通网页 Cookie 不够**。重新登录可能导致手机 APP 退出登录。

也支持以下凭证来源，**三者只能选一种**：

| 青龙环境变量 | 用法 |
| --- | --- |
| `HEYBOX_QL_CONFIG_DIR` | **推荐**，绝对路径目录，加载其中所有普通 `.json` 账号文件（不读取软链接） |
| `HEYBOX_QL_ACCOUNTS` | 完整账号 `config.json` 对象或对象数组的 JSON 字符串 |
| `HEYBOX_CONFIG` | 单账号配置文件的路径 |

均未设置时默认读取仓库 `private/config.json`。不同配置如出现相同盒友 ID，后续账号会被拒绝执行并记录失败。环境变量 JSON **不是加密存储**，请保护青龙后台。

## 检查与日志

```sh
# 查看签到和分享状态，不修改任何任务
sh /ql/data/scripts/heybox-daily/qinglong/heybox_daily.sh check

# 完成当日未完成的签到和三项分享任务
sh /ql/data/scripts/heybox-daily/qinglong/heybox_daily.sh run
```

默认按照账号顺序执行；某账号失败不影响其他账号。日志按 `账号 1`、`账号 2` 分组，不输出盒友 ID、Token、Cookie 或完整接口响应。结束打印成功/失败总数；只要有失败，进程返回非零退出码，青龙会记录失败。程序只重试原核心定义的有限状态确认，不无限重试未结算任务。

如需自定义锁目录，设置 `HEYBOX_QL_LOCK_DIR`（必须是可写路径）。无 `flock` 时需由青龙避免重复任务。

**常见问题：**

- 报 Node.js 版本不够：升级至 Node 24+。
- 初次安装或编译失败：核对 npm 网络、仓库目录写权限、磁盘空间。
- 登录过期：在青龙容器终端重新执行 `HEYBOX_CONFIG=... node dist/cli.js login`。
- 提示找不到账号：检查配置文件路径、权限和 `HEYBOX_QL_CONFIG_DIR`。
- 无法确认签到奖励：离线测试不代表真实 APP 账号已通过验证，以小黑盒内的任务和余额为准。

## 开发测试

```sh
node --check qinglong/heybox_daily.mjs
sh -n qinglong/heybox_daily.sh
node --test qinglong/*.test.mjs
```

以上为**无凭证离线测试**。项目已有的 `pnpm test` / CI 负责核心回归测试；实际短信登录、上游 API 与奖励到账需要真实账号进行验收。
