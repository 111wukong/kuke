# 库课 · 数据库课程学习平台

面向高校师生的数据库课程学习平台。**老师对学生有完全的管理权限。**

参考 [kaoyan-math-tutor](https://github.com/111wukong/kaoyan-math-tutor)
的架构与交互设计（知识树 / 有向依赖图 / 间隔重复 / 教师管理台 / 审计日志），
但换了学科之后做了一个关键改动：

> **数据库这门课的题，答案可以由数据库引擎自己算出来。**

所以本站的判题不靠模型、不靠人工，而是真跑：

| 题型 | 判题方式 |
|---|---|
| SQL 关卡 | 跑一遍参考答案、跑一遍学生的，**比对结果集**（不比对 SQL 文本） |
| 索引实验 | 对每个选项真的建索引、真的问优化器，**答案由 `EXPLAIN QUERY PLAN` 给出** |
| 事务实验 | 按冲突操作建**优先图**，检测有没有环 |
| 范式题 | 属性闭包 / 候选键 / 最小覆盖 / **chase 矩阵法**验无损 |
| 客观题 | 归一化后比对（认全角、认 `1/2` = `0.5`、认 `对/√/T`） |

完整的设计取舍见 **[docs/设计说明.md](docs/设计说明.md)**。

---

## 实拍截图

下面全部是**真机截图**，不是效果图 —— 由 `npm run shots` 起无头 Chrome、
登录、逐页拍摄生成（CI 上每次推送都会重新生成，见 Actions 的 artifacts）。

### 登录页

<img src="docs/screenshots/01-login.png" alt="登录页" width="100%">

### 仪表盘 —— 今天该做什么已经排好了

<img src="docs/screenshots/02-dashboard.png" alt="仪表盘" width="100%">

### 知识树 —— 43 个知识点，带 68 条依赖边

<img src="docs/screenshots/03-knowledge-tree.png" alt="知识树" width="100%">

### 知识点详情 —— Markdown 正文 + SQL 高亮 + 依赖关系

<img src="docs/screenshots/04-knowledge-detail.png" alt="知识点详情" width="100%">

### SQL 实训场 —— 左表结构 / 中编辑器 / 下结果

<img src="docs/screenshots/05-sql-lab.png" alt="SQL 实训场" width="100%">

### SQL 闯关 —— 45 道关卡，判题靠跑结果集

<img src="docs/screenshots/06-levels.png" alt="关卡列表" width="100%">

<img src="docs/screenshots/07-level-detail.png" alt="关卡做题" width="100%">

### 范式实验室 —— 闭包 / 候选键 / 范式判定 / 无损分解

<img src="docs/screenshots/08-normalize.png" alt="范式实验室" width="100%">

### 索引与事务实验台 —— 结论来自 EXPLAIN 和优先图

<img src="docs/screenshots/09-index-lab.png" alt="索引实验台" width="100%">

### 复习队列（FSRS 间隔重复）与错题本

<img src="docs/screenshots/10-review.png" alt="复习队列" width="49%">
<img src="docs/screenshots/11-mistakes.png" alt="错题本" width="49%">

### 学习统计 —— 分类雷达图 + 根因诊断 + 学习路径

<img src="docs/screenshots/12-stats.png" alt="学习统计" width="100%">

### 成就墙

<img src="docs/screenshots/13-achievements.png" alt="成就墙" width="100%">

### 班级与教师工作台

<img src="docs/screenshots/15-classes.png" alt="班级" width="49%">
<img src="docs/screenshots/17-admin.png" alt="教师工作台" width="49%">

### AI 课堂 —— 一个老师 + 三个学生，真的在教学库上跑 SQL

老师讲透 → 三个水平不同的学生讨论 → 停下来等你作答。
黑板上的三块 SQL 结果都是**真的在教学库上执行出来的**，不是编的。

![AI 课堂](docs/screenshots/20-ai-classroom.png)

### 亮色主题（宣纸）

同一份数据、同一个仪表盘，只换主题 —— 这是 `--color-veil` 令牌方向反转
是否生效的直观检验（亮色下卡片边界必须仍然可见）。

<img src="docs/screenshots/18-dashboard-light.png" alt="亮色主题 · 仪表盘" width="100%">

<img src="docs/screenshots/19-sql-lab-light.png" alt="亮色主题 · SQL 实训场" width="100%">

### 古风主题（砚秋 / 砚晨）

两套古风主题，仿「灯下读书」那张参考图的调性做的：
旧木家具的深褐 + 暖黄灯光 + 朱砂印章 —— 以及**楷体**。

古风不是换个色板就能出来的。深棕底 + 朱砂色 + 黑体字，
得到的只是「一个深棕色的普通界面」。所以这两套主题会把整站字体
换成自托管的**霞鹜文楷**，并把根字号抬 3.5%、行高放到 1.78 ——
楷体的笔画比黑体细、字面收，不做补偿会整体小一号。

字体是 97 个 `unicode-range` 切片，浏览器只下载页面上真正出现的
那几片（实测一个页面 6 片），不引任何 CDN。

<table>
<tr>
<td width="50%"><img src="docs/screenshots/23-dashboard-ink-autumn.png" alt="砚秋 · 夜读"><br><sub>砚秋 · 夜读（暗）</sub></td>
<td width="50%"><img src="docs/screenshots/25-dashboard-ink-dawn.png" alt="砚晨 · 晨窗"><br><sub>砚晨 · 晨窗（亮）</sub></td>
</tr>
</table>

<img src="docs/screenshots/24-settings-ink-autumn.png" alt="砚秋 · 设置页（主题选择器里名字用它自己的字体画）" width="100%">

---

## 快速开始

```bash
npm install
npm run check        # 类型检查 + 构建前端
npm test             # 十一组测试
npm start            # 打开 http://127.0.0.1:5180
```

macOS 上可以直接双击 **`启动.command`**（自动装依赖 → 构建 → 起服务 → 开浏览器）。

### 首个账号

第一次启动时如果没有教师账号，服务端会现场随机生成一个 16 位密码，
**只打印一次**：

```
════════════════════════════════════════════════════════════
  初始密码：k7Rq2mXvTn4BpWc9
  ↑ 只打印这一次。请立刻保存，并登录后改掉。
════════════════════════════════════════════════════════════
```

想自己指定：

```bash
KUKE_PASSWORD=你的密码 KUKE_EMAIL=你的邮箱 npm start
```

源码里**没有任何可用的默认凭据** —— 公开仓库里躺着能用的密码是不能接受的。

### 开发模式

前后端热更新（前端 5173、后端 5180，`/api` 自动代理）：

```bash
npm run dev
```

---

## 部署

要放到云服务器上供学生通过公网访问，完整步骤看 **[docs/部署到云服务器.md](docs/部署到云服务器.md)**。

仓库里已经准备好的东西：

| 文件 | 用途 |
|---|---|
| `Dockerfile` · `docker-compose.yml` | 容器化部署，含健康检查与日志轮转 |
| `deploy/nginx.conf` | 反代 + HTTPS + SSE 不缓冲 + gzip |
| `deploy/kuke.service` | systemd 单元，含沙箱加固 |
| `scripts/backup.mjs` | 数据库备份（`VACUUM INTO` + 完整性校验 + 轮转） |
| `bench/` | 300 并发压测工具，零依赖 |

```bash
# Docker
cp .env.example .env          # 填 KUKE_EMAIL / KUKE_PASSWORD
docker compose up -d --build
sudo cp deploy/nginx.conf /etc/nginx/conf.d/kuke.conf && sudo certbot --nginx -d 你的域名

# 或 systemd
sudo cp deploy/kuke.service /etc/systemd/system/kuke.service && sudo systemctl enable --now kuke
```

> ★ **不要把 5180 端口直接开到公网。**
> 应用自己是纯 HTTP —— 学生的密码和会话 cookie 会明文过网。
> 正确结构是 `浏览器 → HTTPS → Nginx → 应用(只监听回环)`。

---

## 内容规模

| | 数量 |
|---|---|
| 分类 / 章 / **知识点** | 7 / 29 / **43** |
| 知识依赖边 | **68** 条（53 硬前置 + 5 相关 + 10 易混淆） |
| 教学数据集 | **4** 套（学生选课 / 电商订单 / 图书借阅 / 员工部门） |
| SQL 关卡 | **45** 关 |
| 客观题 | **74** 道（单选 / 多选 / 判断 / 填空 / 简答） |
| 范式题 | **15** 道（闭包 / 候选键 / 范式判定 / 无损分解） |
| 实验台 | **9** 个（4 索引 + 5 事务） |

课程覆盖：基础理论 · SQL 语言 · 数据库设计 · 存储与索引 · 查询优化 ·
事务与并发 · 恢复与安全。

**所有关卡的参考答案都真跑过**（`npm run test:content`），
所有索引题的答案都和 `EXPLAIN` 的实际输出对过账 ——
题目不可能配错答案。

---

## 功能

### 学生端

- **仪表盘** —— 今天该做什么（复习队列 → 错题 → 新内容，按优先级排好）
- **知识树** —— 两种视图：按课程大纲 / 按「可学性」排序（前置都掌握了的排前面）
- **知识点详情** —— Markdown 正文、示例 SQL 一键送去实训场、前置 / 解锁 / 易混淆、笔记
- **SQL 实训场** —— 左表结构 / 中编辑器 / 下结果，多语句逐条给结果，运行历史
- **SQL 闯关** —— 45 关，不锁关（推荐顺序而非强制顺序），看答案需要先自己试一次
- **每日一练** —— 答完立刻出判定与解析，答错自动进错题本和复习队列
- **范式实验室** —— 四种问法，提交后能看**完整的算法推导过程**
- **索引与事务实验台** —— 索引题展示真实的执行计划
- **错题本** —— 按考点聚合，看出「卡在哪个概念上」而不是逐条消灭
- **复习队列** —— FSRS-6 间隔重复，四档自评
- **学习统计** —— 分类雷达图 + 根因诊断 + 拓扑排序过的学习路径
- **成就** —— 15 项，判定口径公开
- **作业 / 班级 / 设置**

### AI 课堂（多智能体）

一个老师 + 三个水平不同的学生，围绕一个考点把课上一遍。

| | |
|---|---|
| **核心场景** | 一对一讲透 / 多人课堂 / 研讨课；答疑重讲；练习与验证 |
| **角色差异化** | 靠**机制**不靠形容词：资料量递减（后进生只有一句摘要）、工具白名单隔离（学生没有写解答的工具）、错法来自题库真实干扰项 |
| **AI 的呈现** | 流式逐字、黑板动作族（SQL 结果表 / 曲线 / 步骤 / 公式）、教学动作标签、引导占比 |
| **库课独有的能力** | AI 能在教学库上**真的执行 SQL**，结果直接上黑板；能查你真实的错题和根因诊断 |
| **不让你当观众** | 每一轮结束都挂起等作答；等作答期间插话入口自动禁用并说明原因 |

阶段由**代码**持有而不是模型判断 —— 说「没听懂」就切到答疑重讲、
让其他学生安静、并且**不许出题**（模型要是出了，代码把它换成理解确认）。

### 教师端

- **教师工作台** —— 总览 / 学生管理 / 班级 / 作业 / 内容 / 审计日志
- **学生管理** —— 建号（单个 + 批量，批量可导出 CSV）、改资料、重置密码、
  强制下线、停用、删除、搜索排序
- **学生详情** —— ★ **他写的每一条 SQL** + 根因诊断 + 这个账号被做过的操作
- **班级管理** —— 建班、邀请码、成员列表、**班级共性薄弱点**、最近没来的学生
- **作业管理** —— 布置、看全班提交情况、逐份批改（含评分点对照）
- **审计日志** —— 所有管理操作，含改前改后的值

### 权限边界

```
教师能对自己名下的学生做任何事（建号/改资料/重置密码/停用/删除/看全部学情/布置批改作业）
教师不能：管理别的教师的学生 · 把自己提为管理员 · 管理教师或管理员账号
         · 看到学生的密码哈希（连脱敏形式都不给）
```

「自己名下」= 他创建的账号 ∪ 他名下班级的成员。
越权一律返回 **403**（不是 404 —— 那会变成存在性探测器）。

---

## 技术

| 层 | 选择 |
|---|---|
| 后端 | Fastify 5 + SQLite（better-sqlite3，自带全平台预编译） |
| 鉴权 | 服务端会话 + httpOnly cookie（不用 JWT —— 没法即时登出） |
| 口令 | scrypt（Node 内置） |
| SQL 沙箱 | worker_threads + 4 秒超时强杀 + 语句白名单 |
| 前端 | React 19 + Vite + TypeScript + Tailwind 4 + zustand |
| 依赖总数 | 后端 5 个，前端 8 个 |

**零依赖的部分**（都是自研）：
Markdown 渲染器 · SQL 语法高亮 · SQL 编辑器 · 粒子背景 · WebGL 网格 ·
浏览器测试客户端 · 全部测试框架。

### 几个值得说的技术点

**SQL 沙箱**。better-sqlite3 是同步 API，一条五表笛卡尔积会把整个
事件循环钉死几十秒 —— 期间所有学生的请求都不响应。所以用户的 SQL
跑在 worker 线程里，主线程 4 秒超时后 `terminate()` 强杀并换一个新 worker
（强杀过的 worker 状态不可信，复用可能读到上一题的残留表）。

**多主题**。Tailwind v4 的 `@theme` 把 token 编译成 CSS 变量，
所以换主题 = 在 `html[data-theme="x"]` 里重定义同一批变量。
关键陷阱是 `--color-veil` —— 全站「叠一层」的地方都走它，
而它**明暗主题取值方向相反**（暗色叠白、亮色叠黑）。
写死 `bg-white/5` 的话，亮色主题下卡片边界会**凭空消失**，
而页面依然「正常渲染」—— 元素在、颜色对、只是看不见。

**层级由结构表达，不由效果表达。** 面分两套：

```css
.panel   /* 实色面 + 1px 边框 —— 卡片、面板、区块，默认都用这个 */
.glass   /* 半透明 + 模糊 —— 只给弹窗、下拉、抽屉、sticky 顶栏 */
```

之前**所有**卡片都是玻璃拟态。单看一张好看，铺满一屏就是灾难：
每张卡都在"浮着"，于是没有一张是浮着的，层级反而消失。
浮起是稀缺资源，只给真正浮在内容之上的层。
同理：主按钮是实色不是渐变、发光只留给键盘焦点环、
装饰图标统一弱化成灰色、默认主题不挂动态背景
（想要炫技感可以选「赛博绿」）。
对标 Radix Colors 的 12 级色阶与 Semi Design 的「用 border 模拟扁平阴影」，
详细取舍见 `docs/设计说明.md`。

**古风主题连字体一起换**。砚秋 / 砚晨把 `--font-sans` 换成自托管的
霞鹜文楷（97 个 `unicode-range` 切片，浏览器只下需要的几片），
并抬 3.5% 根字号 + 放宽行高。字体栈里 webfont 后面**必须**跟系统楷体：
子集外的字会沿着栈往下走，直接落到 `serif` 的话 Linux 上会变成宋体 ——
同一个标题里一半楷体一半宋体。

**日期口径**。全站用服务器本地时区的 `YYYY-MM-DD`，不用
`toISOString().slice(0,10)`。后者是 UTC 日期，北京时间早上 7 点时
UTC 还是前一天，会把「今天做的题」记到昨天头上 ——
连续打卡断掉，而这个 bug 只在 00:00–08:00 出现。

---

## 测试

```bash
npm test              # 全部十一组
npm run test:content  # 内容自检
npm run test:unit     # 单元测试
npm run test:api      # 接口冒烟
npm run test:hardening # 加固回归
npm run test:contrast # 主题对比度（纯静态）
npm run test:fonts    # 古风字体（纯静态）
npm run test:browser  # 浏览器冒烟 + 截图（需要真实桌面环境）
```

| 组 | 数量 | 说明 |
|---|---|---|
| 内容自检 | 全部内容 | 每道题的参考答案真跑一遍、依赖图环检测、**判题必须可失败**、**内容里对引擎行为的断言与引擎对账**、**正文引用的数字与数据集对账** |
| 单元测试 | **179** 项 | 判题 / 范式算法 / FSRS / 图谱诊断 / **前端渲染器的 XSS 与标记漏屏** |
| 接口冒烟 | **194** 项 | 起真服务跑完整业务流程 + 权限边界 |
| 加固回归 | **34** 项 | 安全头 / 限流 / 沙箱逃逸 / SPA 回退 |
| 主题对比度 | **144** 项 | 10 套主题的四级文字色过 WCAG AA、强调色过 3:1、层级不塌 |
| 古风字体 | **20** 项 | 字体资产与 CSS 对齐、楷体栈有兜底、注册表与样式表一致 |
| 浏览器冒烟 | 23 项 + 23 页截图 | 逐页断言 + 交互断言 + 截图（含古风主题） |

全部零依赖：Node 内置能力 + Chrome CLI。

> ⚠️ **浏览器那组在本机沙箱里跑不起来**，脚本会明确跳过（不假装通过）。
> 原因：Chrome 的进程沙箱在这个环境里初始化失败，加 `--no-sandbox`
> 之后进程又会被外层杀掉；CDP 的页面级 WebSocket 通道也被阻断
> （浏览器级能连、命令有响应，页面级握手后立刻 1006）。
> 有桌面环境的机器上它会正常出图并断言。
> （`chrome-headless-shell` 这个二进制是能跑的，README 里的实拍图就是它出的。）

> ⚠️ **对比度 / 字体这两组一度没接进 CI** —— 它们写在 `tests/run-all.mjs` 里，
> 而 CI 是逐个列 `npm run test:xxx` 的，漏掉了。后果是古风主题「砚秋」
> 带着 1.50:1 的深底深字上线，CI 全绿。现在两个都在 `ci.yml` 里。

---

### AI 相关

| 套件 | 测什么 |
|---|---|
| `tests/ai-unit.mjs` | 表达式求值器（无 eval）、出题清洗的不变量、阶段状态机、工具白名单边界 |
| `tests/ai.mjs` | 端到端：SSE 事件流、工具回灌、角色资料量差异、出题入库、讲评降级（mock 上游） |
| `tests/browser-ai.mjs` | 真浏览器跑一节完整的课：开课 → 作答 → 答疑 → 收尾，断言黑板与门禁 |

AI 套件**不打真模型** —— 用 mock 的 OpenAI 兼容上游，确定且不烧钱。
最要紧的一条断言不是「接口返回 200」，而是 **mock 上游真的收到了 Authorization 头**。

```bash
npm run test:ai          # 两个 AI 套件
npm run test:browser:ai  # AI 课堂的浏览器冒烟
```

## 环境变量

见 [.env.example](.env.example)。最常用的几个：

| 变量 | 作用 |
|---|---|
| `KUKE_DB` | 数据库文件位置 |
| `PORT` / `HOST` | 监听端口与地址（`HOST` 默认 `127.0.0.1`，故意不暴露公网） |
| `NODE_ENV` | 设 `production` 时：cookie 加 `Secure`、自助注册默认关闭、日志默认降为 warn |
| `KUKE_EMAIL` / `KUKE_PASSWORD` | 首个教师账号（只在库为空时创建） |
| `KUKE_ALLOW_REGISTER` | 生产默认关闭；要开放注册设 `1` |
| `TRUST_PROXY` | 跑在反向代理后面时设成**代理的地址**（不要写 `true`） |
| `UV_THREADPOOL_SIZE` | 建议 `16`。scrypt 跑在线程池上，默认 4 个线程，300 并发登录会排队 |
| `LOG_LEVEL` | 生产别开 `info` —— 实测压测 20 秒产生 1GB 日志 |

> `.env` **会被自动读取**（实现在 `server/src/lib/env.js`）。
> 优先级：凭据类以 `.env` 为准，其余以环境变量为准。

---

### AI（可选）

不配也能跑，只是 `/classroom` 会提示「AI 功能未启用」。

| 变量 | 默认 | 说明 |
|---|---|---|
| `DEEPSEEK_API_KEY` | 空 | 在 `.env` 里填。**凭据类以 `.env` 为准**，见下 |
| `DEEPSEEK_BASE` | `https://api.deepseek.com` | 任何 OpenAI 兼容网关都行 |
| `DEEPSEEK_MODEL` | `deepseek-chat` | |
| `DEEPSEEK_TIMEOUT` | 60000 | 单次上游超时（毫秒） |

> **★ 为什么加了 `.env`（原本只读环境变量）**
>
> 真踩过：本机 `~/.zshrc` 里导出着一个旧 key，用户把新 key 写进 `.env`，
> 服务端却全程在用旧的 —— 健康检查报「已配置」，每条消息却 401，
> 而上游原话只有 `your api key: ****b605 is invalid`，看上去像 key 失效，
> 完全查不到「用错了哪一把」。
>
> 所以规则按「出错了会不会静默」分两类：
> - **凭据类**（`*_API_KEY` / `*_TOKEN` / `*_SECRET` / `*_PASSWORD`）→ **`.env` 为准**，被顶掉时启动日志会大声说
> - **其余**（`PORT` / `KUKE_DB` / …）→ 环境变量为准（保持原来的约定）
>
> 想临时换 key：`KUKE_ENV_WINS=1 node server/src/index.js`

## 目录

```
kuke/
├── server/      Fastify + SQLite（含全部课程内容在 src/data/）
├── web/         React + Vite + Tailwind
├── tests/       十一组零依赖测试
├── bench/       300 并发压测工具（零依赖，可复现报告里的数字）
├── deploy/      Nginx 反代配置 + systemd 单元
├── scripts/     备份 / 重置密码 / AI 联通检查
├── docs/        设计说明 + 部署文档
├── Dockerfile   生产镜像（多阶段构建）
└── 启动.command macOS 一键启动
```

---

## 已知限制

1. 浏览器测试需要真实桌面环境（见上）。
2. SQL 方言是 **SQLite** —— 教学语法它全有，但 `ALTER TABLE` 支持有限。
3. **Docker 配置没有在本机跑过**（这台机器没装 Docker）。文件是按官方文档写的，
   首次使用请留意 `docker compose up --build` 的构建日志。
4. **单进程 + 单 SQLite 连接**：所有 API 在主线程上同步执行 SQL，只用到一个 CPU 核。
   读路径实测能到 4700 req/s，当前规模够用；要留更多余量需要多进程（见部署文档第 9 节）。
5. 内容够一学期但不富余，扩充只需往 `server/src/data/` 加条目。
6. 教师端内容管理只做了题目的增删改，没有可视化编辑器。

---

## License

MIT
