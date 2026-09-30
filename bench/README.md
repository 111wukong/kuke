# bench · 并发压测

零第三方依赖，只用 `node:http` 原生客户端。用来回答两个问题：

1. **这个服务在 300 并发下到底是什么表现？**
2. **某次改动到底有没有用？**（改前跑一次、改后跑一次，比 `results.jsonl`）

## 三种发压模型

| 模型 | 干什么 | 像什么 |
|---|---|---|
| `closed` | 固定 N 个并发，发完一个立刻发下一个（无思考时间） | 最坏情况 / 打一个接口的容量上限 |
| `session` | N 个虚拟用户跑完整学习动线，带随机思考时间 | 真实课堂节奏 |
| `login` | N 个并发同时登录 | 开学第一课 |

## 两种 IP 形态（这是关键）

| 形态 | 含义 |
|---|---|
| `--ip same` | 所有请求同一个 `X-Forwarded-For` —— **模拟学校机房 NAT 单出口** |
| `--ip diff` | 每个虚拟用户一个 IP —— 模拟人手一终端 |

> 这两种形态的结果差异极大，而且**机房形态才是真实场景**。
> 曾经的实测：同一份代码、同样 300 并发，`diff` 成功率 100%，`same` 成功率 5%。
> 差别全部来自限流维度。

注意 `same` 要生效，服务端必须开 `TRUST_PROXY`（否则 `X-Forwarded-For` 被忽略，
所有请求都落在 `127.0.0.1` 这一个桶里 —— 那也是一种"同 IP"，但分不清是配置还是拓扑）。

## 跑一轮

```bash
# 0. 起一个一次性库的服务（不要对着真实数据跑）
mkdir -p /tmp/kuke-bench
KUKE_DB=/tmp/kuke-bench/kuke.db PORT=5188 HOST=127.0.0.1 \
KUKE_EMAIL=teacher@bench.local KUKE_PASSWORD=Bench12345 \
node server/src/index.js

# 1. 造 300 个学生 + 给每人发一张会话（直接写库，绕过注册限流）
KUKE_DB=/tmp/kuke-bench/kuke.db node bench/make-users.mjs 300
KUKE_DB=/tmp/kuke-bench/kuke.db node bench/make-sessions.mjs

# 2. 压测
BENCH_PORT=5188 node bench/run.mjs session --c 300 --dur 60 --ip same
BENCH_PORT=5188 node bench/run.mjs login   --c 300 --ip same
BENCH_PORT=5188 node bench/bench-submit.mjs submit --c 300 --dur 20 --level L01
BENCH_PORT=5188 node bench/bench-submit.mjs mixed  --c 300 --dur 30
```

结果同时打印到终端，并追加到 `/tmp/kuke-bench/results.jsonl`（一行一个 JSON）。

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `BENCH_HOST` | `127.0.0.1` | 目标主机 |
| `BENCH_PORT` | `5180` | 目标端口 |
| `TOKENS_OUT` | `/tmp/kuke-bench/tokens.json` | 会话文件位置 |
| `RESULTS_OUT` | `/tmp/kuke-bench/results-submit.jsonl` | 判题压测结果落盘位置 |
| `KUKE_DB` | `/tmp/kuke-bench/kuke.db` | 造号脚本用的库 |

## 一个坑

服务端如果不设 `KUKE_RL_SCALE`，限流是**生产阈值**。
想测「架构本身能扛多少」（而不是「生产配置允许多少」），
用 `KUKE_RL_SCALE=1000` 起服务 —— 它把所有 `rl(max, window)` 的 max 放大 1000 倍。

两者的区别很重要：
- 不放大 → 测的是**配置**
- 放大   → 测的是**架构**

报告里两个数字都给了，并且标明是哪一个。
