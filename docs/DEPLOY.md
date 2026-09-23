# Hinge Relay 部署指南

本项目有两种部署方式。普通用户推荐使用 Cloudflare Dashboard 的 GitHub 集成，全程不需要在电脑上安装 Node.js、Git 或 Wrangler；命令行方式保留给开发者本地调试和高级部署。

## 一、网页端部署（推荐）

### 1. 准备自己的 GitHub 仓库

打开 [Hinge Relay GitHub 仓库](https://github.com/Chengeeker/Hinge-Relay)，点击 `Fork`，在自己的仓库中操作。

不要把自己的 Cloudflare Worker 名称、R2 bucket 名称、管理员 Token 或 Relay 密钥写入上游仓库。

### 2. 在 GitHub 网页编辑部署配置

在自己的仓库中打开根目录的 `wrangler.jsonc`，点击铅笔图标编辑：

```jsonc
{
  "name": "你自己的-worker名称",
  "r2_buckets": [
    {
      "binding": "BUCKET",
      "bucket_name": "你自己的-r2-bucket名称"
    }
  ]
}
```

只需要替换 `name` 和 `bucket_name`：

- `name` 必须与 Cloudflare Dashboard 创建/导入时显示的 Worker 名称一致。
- `bucket_name` 必须与稍后创建的 R2 bucket 完全一致。
- `binding` 必须保持为 `BUCKET`。
- 不要在此文件写入 `RELAY_ADMIN_TOKEN`、设备 Token 或 Relay 密钥。

点击 `Commit changes`，提交到 `main`。

### 3. 在 R2 网页创建私有 bucket

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)。
2. 打开 `R2 Object Storage`。
3. 点击 `Create bucket`。
4. 填写和 `wrangler.jsonc` 中完全相同的 `bucket_name`。
5. 选择位置和默认存储类别后创建。

不要把 bucket 设置为公开，也不要使用公开的 `r2.dev` 地址。Hinge Relay 只通过 Worker 访问 R2。

### 4. 在 Workers & Pages 导入 GitHub

1. 打开 `Workers & Pages`。
2. 点击 `Create application`。
3. 在 `Import a repository` 旁边点击 `Get started`。
4. 授权你的 GitHub 账号。
5. 选择自己的 Hinge Relay 仓库和 `main` 分支。
6. 填写构建设置：

| 设置 | 推荐值 |
| --- | --- |
| Root directory | 留空或 `/` |
| Production branch | `main` |
| Build command | `npm run check`，也可以留空 |
| Deploy command | `npm run deploy` |
| Non-production branch deploy command | 不需要预览分支时保持默认或关闭 |

本项目的 `package.json` 已经包含 `npm run deploy`，而 `wrangler.jsonc` 已经声明 Worker 名称、R2 binding 和 Cron。点击 `Save and Deploy` 后，Cloudflare Workers Builds 会安装依赖并执行部署。

如果 Cloudflare 使用默认的 `npx wrangler deploy`，也可以正常工作；这里的 `npx` 是 Cloudflare 构建环境执行的，不需要你在本地执行。

如果出现 Worker 名称不一致错误，请检查 Dashboard 中的 Worker 名称和 `wrangler.jsonc` 的 `name` 是否完全相同。Cloudflare 官方要求这两个名称匹配。

### 5. 在网页中添加管理员 Secret

进入刚创建的 Worker：

`Workers & Pages` → 你的 Worker → `Settings` → `Variables and Secrets` → `Add`

填写：

| 字段 | 内容 |
| --- | --- |
| Type | `Secret` |
| Variable name | `RELAY_ADMIN_TOKEN` |
| Value | 至少 8 个字符；建议密码管理器生成至少 16 个随机英数字符，再复制粘贴 |

然后点击 `Deploy` 并等待新部署完成。Cloudflare 保存后不会再次显示 Secret 原值；请保留生成时的值，以便粘贴到 Hinge 注册页面。

这个 Secret 只用于 Hinge 设备首次注册。不要把它填到 GitHub 文件、`wrangler.jsonc`、普通 Variables 或 Cloudflare Workers Builds API Token 中。

注册 API 的认证错误有两种：`503 admin_token_not_configured` 表示当前 Worker 未配置至少 8 字符的 `RELAY_ADMIN_TOKEN`；`401 admin_auth_failed` 表示 Hinge 提交的值缺失或不匹配。检查 Worker 地址是否指向正确的部署、Secret 是否为 Cloudflare Secret 类型，并确认修改后已点击 `Deploy` 且部署成功。旧版 Worker 会把两种情况都返回为普通 `401 admin authentication failed`；先在 `Deployments` 确认最新代码已生效。`/v1/health` 不会暴露管理员 Secret 的配置状态。

### 6. 检查 Worker

浏览器访问：

```text
https://你的-worker地址/v1/health
```

看到包含 `service`、`relayVersion`、`apiVersion` 和 `configSchemaVersion` 的 JSON 后，再去 Hinge 的两台设备中填写 Worker 地址并注册设备。更新到本次版本后，`relayVersion` 应为 `1.0.1`。

### 7. 如果缺少 R2 binding

由于本项目以 `wrangler.jsonc` 为部署配置来源，正常情况下不需要在 Dashboard 重复添加 R2 binding。

如果当前 Dashboard 明确提示缺少绑定，可以进入：

`Settings` → `Bindings` → `Add` → `R2 bucket`

变量名必须填写 `BUCKET`，然后选择刚才创建的 bucket 并重新部署。随后仍应把同样的 bucket 名称保留在 `wrangler.jsonc` 中，避免下次 GitHub 自动部署时配置不一致。

## 二、网页部署后的自动更新

Cloudflare Worker 连接 GitHub 后，推送到选定的 `main` 分支会触发新的构建和部署。

你可以：

- 在 GitHub 网页编辑源码并提交；
- 合并上游同步 Pull Request；
- 在 Cloudflare Worker 的 `Deployments` 页面查看构建记录和日志。

如果只修改 Secret 或构建配置，应在 Cloudflare Dashboard 修改，不要把 Secret 写进 GitHub。

## 三、命令行部署（备用）

```powershell
npm ci
npx wrangler login
npx wrangler r2 bucket create 你的bucket名称
npx wrangler secret put RELAY_ADMIN_TOKEN
npm run check
npm test
npm run deploy
```

命令行部署时仍需保证：

- `wrangler.jsonc` 的 `binding` 是 `BUCKET`；
- `bucket_name` 对应一个私有 R2 bucket；
- `RELAY_ADMIN_TOKEN` 是 Worker Secret，不是普通明文变量；
- 管理员 Token 最少 8 个字符；安全上建议密码管理器生成至少 16 个随机英数字符并复制粘贴，不要使用自选短密码；
- 部署完成后可以访问 `/v1/health`。

## 四、Pages 的限制

把源码作为静态文件上传到 Cloudflare Pages，不能自动运行这个 Worker API。只有配置为 Pages Functions/Worker 运行环境并正确绑定 R2 时才可能工作；本项目默认目标是 Cloudflare Workers + R2，因此请优先使用 Workers & Pages 的 GitHub 导入方式。

## 官方参考

- [Workers Builds / GitHub 集成](https://developers.cloudflare.com/workers/ci-cd/builds/)
- [Workers Builds 配置](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)
- [R2 创建 bucket](https://developers.cloudflare.com/r2/buckets/create-buckets/)
- [Worker Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
- [R2 Worker binding](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)
