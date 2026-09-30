# ══════════════════════════════════════════════════════════════
# 库课 · 生产镜像
#
# 多阶段构建：builder 里装依赖、编译原生模块、构建前端；
# runtime 只带生产依赖和构建产物。
#
# 为什么用 bookworm-slim 而不是 alpine：
#   better-sqlite3 是原生模块。alpine 用 musl libc，
#   预编译二进制用不了，每次都要现场编译 —— 慢，而且
#   编译产物与 glibc 环境的兼容性是个长期坑。
#   slim 版比 full 版小 700MB 左右，够用。
# ══════════════════════════════════════════════════════════════
FROM node:22-bookworm-slim AS builder
WORKDIR /app

# 原生模块的编译工具链。只在 builder 里装，不进最终镜像。
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# 先只拷 manifest —— 依赖没变时这一层能命中缓存，
# 改业务代码不用重装依赖。
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY web/package.json ./web/
RUN npm ci

COPY . .
RUN npm run build

# 只留生产依赖，把 vite/typescript 这些开发依赖剔掉
RUN npm prune --omit=dev

# ══════════════════════════════════════════════════════════════
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=5180 \
    KUKE_DB=/data/kuke.db

# 数据库目录。★ 挂成卷 —— 放在 /app 下面的话，
# 重建容器时数据会跟着镜像一起没了。
RUN mkdir -p /data && chown -R node:node /data

COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/package.json ./package.json
COPY --from=builder --chown=node:node /app/server ./server
COPY --from=builder --chown=node:node /app/web/dist ./web/dist
COPY --from=builder --chown=node:node /app/scripts ./scripts
COPY --from=builder --chown=node:node /app/docs ./docs

# 不用 root 跑。容器逃逸的成本高得多。
USER node

EXPOSE 5180
VOLUME ["/data"]

# 健康检查打 /api/health —— 它同时验证「进程活着」和「数据库能读」，
# 比只探端口有意义（端口开着但库坏了是最难查的状态）。
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5180)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/src/index.js"]
