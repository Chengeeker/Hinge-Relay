# Hinge Relay

Hinge Relay 是 Hinge 的**自托管 Cloudflare 文件中转服务**。

它解决的问题很简单：两台已经互相信任的 Hinge 设备暂时不在同一个局域网时，发送设备先把文件加密后放进你自己的 Cloudflare R2，接收设备之后再取回、解密、校验并确认收件。

这不是 Hinge 官方云服务。你需要使用自己的 Cloudflare 账号部署 Worker 和 R2；Hinge 项目本身不会替你保存账号、文件或中转密钥。

如果你现在只想知道“第一步做什么”，直接跳到[第一次部署：照着做即可](#第一次部署照着做即可)。如果你想先理解它在做什么，请从下面开始。

---

## 1. 先用一句话理解

Hinge 的文件发送顺序是：

```text
局域网能连上
    → 继续使用原来的局域网传输

局域网暂时连不上，并且两台设备都配置了 Cloud Relay
    → 发送端加密文件
    → 上传到你自己的 Worker + R2
    → 接收端稍后轮询
    → 下载、解密、校验 SHA-256
    → 校验通过后确认收件并清理云端文件
```

所以它更像一个“自己的云端信箱”，而不是实时聊天连接。

### 它能做什么

- 让已经在 Hinge 中互相信任的设备在没有局域网时异步传文件。
- 使用你自己的 Cloudflare Worker 和私有 R2，不需要 Hinge 账号，也不需要 Hinge 官方服务器。
- 在客户端上传前加密文件分块和文件元数据。
- 接收端校验解密结果、文件大小和明文 SHA-256，确认无误后才 ACK。
- 支持 Windows 和 Android 客户端。

### 它不能做什么

- 不能替代 Hinge 的第一次设备配对。两台设备必须先在 Hinge 中互相发现并设为信任设备。
- 不能保证 Android 在被系统彻底杀死后立即下载。Android 必须重新运行 Hinge，或由系统允许的任务触发轮询。
- 不能让局域网传输变成公网实时传输。局域网仍然优先，Cloud Relay 只是离线/异步兜底。
- 不能自动替你创建 Cloudflare 账号、R2 bucket 或部署密钥。
- 不能因为导入 GitHub 或压缩包就自动部署到每个人的 Cloudflare。每个用户都必须拥有自己的 Worker、R2 和密钥。

---

## 2. 项目目录说明

本 README 面向所有使用者，因此文中的“项目目录”不是一个固定的公共路径，而是指你自己克隆或解压 Hinge Relay 后的文件夹。

例如，你可以把项目放在：

```text
C:\Users\你的用户名\Documents\Hinge-Relay
```

也可以放在其他磁盘或其他文件夹。只要进入这个文件夹后能看到 `package.json`、`wrangler.jsonc`、`src` 和 `tests`，就是正确的项目目录。

后文用“你的项目目录”表示这个位置。维护者本机的开发路径只属于维护环境，不是其他用户必须照抄的路径；你不需要创建维护者使用的文件夹结构。

本项目可以独立发布到 GitHub；它不需要作为 Hinge 主仓库的子目录运行。修改、测试和提交时，始终在你自己保存的这份 Hinge Relay 目录中进行，不要同时维护两份副本。

---

## 3. 你需要准备什么

### 所有部署方式都需要

1. 一个 Cloudflare 账号。
2. 确认账号中可以使用 Cloudflare Workers 和 R2；具体配额、计费及可用功能以 Cloudflare 当前 Dashboard 和官方价格说明为准。
3. 两台已经在 Hinge 中互相信任的设备：一台发送，一台接收。
4. 两台设备上都安装包含 Cloud Relay 功能的 Hinge 版本。

### 选择网页部署时另外需要

- 一个 GitHub 账号，用于 Fork 项目并让 Cloudflare 连接你的仓库。
- 不需要在自己的电脑上安装 Node.js、Git 或 Wrangler；GitHub 和 Cloudflare 网页会完成仓库管理与部署。

### 选择命令行部署时另外需要

- 一台安装 Node.js LTS 的 Windows、macOS 或 Linux 电脑。
- Git 不是 Wrangler 部署的硬性要求；如果你打算克隆/更新代码，才需要安装 Git。
- Wrangler 会作为项目依赖安装，因此通常不必单独全局安装 Wrangler。

### 不建议一开始做的事情

第一次部署时不要同时修改 Worker 源码、Cloudflare 绑定和 Hinge 客户端代码。先按本文部署一个能访问 `/v1/health` 的 Relay，再注册两台设备，最后测试文件传输。这样出错时比较容易定位。

---

## 4. 第一次部署：推荐网页方案

你有两种部署方式：

| 方式 | 适合谁 | 是否需要在电脑安装 Node.js、Git、Wrangler |
| --- | --- | --- |
| Cloudflare 网页 + GitHub | 不熟悉命令行的普通用户，推荐 | 不需要 |
| Wrangler 命令行 | 开发者或需要本地调试的人 | 需要 |

下面先介绍完全使用网页的方式。后面的命令行部分只是备用方案。

### 4.1 网页端部署前的准备

网页部署是让 Cloudflare 从你的 GitHub 仓库读取源码并自动构建 Worker。整个过程都可以在浏览器里完成；不需要在电脑上安装 Node.js、Git 或 Wrangler，也不需要自己打开终端输入 `npx`。

开始前准备好：

1. 一个能登录的 [GitHub 账号](https://github.com/)；
2. 一个能使用 Workers 和 R2 的 [Cloudflare 账号](https://dash.cloudflare.com/)；
3. 一台可以同时打开 GitHub 和 Cloudflare Dashboard 的电脑；
4. 预留几分钟按顺序完成 Fork、R2 bucket、Worker 和 Secret 配置。

建议先在纸上或密码管理器里记下两个**非秘密的名称**，避免做到一半临时想名字：

| 名称 | 示例 | 用途 |
| --- | --- | --- |
| Worker 名称 | `hinge-relay-alice` | 你的 Relay 服务名称，也会用于 Worker 地址 |
| R2 bucket 名称 | `hinge-relay-alice-files` | 存放加密中转对象的私有 bucket |

示例名称仅供参考；实际名称需要在你的 Cloudflare 账号中可用。不要把管理员 Token 或 Relay 加密密钥当作名称填写。

### 4.2 把 Relay 仓库 Fork 到自己的 GitHub

1. 先登录 GitHub，再打开[上游 Hinge Relay 仓库](https://github.com/Chengeeker/Hinge-Relay)。
2. 点击页面右上方的 `Fork`。如果 GitHub 显示 Fork 设置页，`Owner` 选择你自己的账号，仓库名通常保持 `Hinge-Relay` 即可。
3. 点击 `Create fork`，等 GitHub 创建完成。页面地址应变成 `github.com/你的账号/Hinge-Relay`，而不是 `github.com/Chengeeker/Hinge-Relay`。
4. 后续只编辑自己账号下的这份仓库。上游仓库是项目发布者的源仓库，不要尝试在上游直接保存自己的 Worker 名称或凭据。

如果 `Fork` 按钮不可用，或者你希望仓库保持私有，也可以在 GitHub 上创建自己的仓库并复制完整项目源码。不要只上传 `src`：至少要保留根目录中的 `package.json`、`package-lock.json`、`wrangler.jsonc`、`tsconfig.json`、`src` 和 `tests`，Workers Builds 才能按项目预期安装依赖、检查并部署。

### 4.3 在 GitHub 网页填写自己的资源名称

现在要告诉项目：部署到 Cloudflare 时 Worker 叫什么、使用哪个 R2 bucket。打开你自己账号下的 `Hinge-Relay` 仓库：

1. 确认地址栏是 `github.com/你的账号/Hinge-Relay`。
2. 在文件列表中找到并打开根目录的 `wrangler.jsonc`。
3. 点击文件右上方铅笔形状的 `Edit` 按钮（如果 GitHub 显示 `Edit this file`，也是同一个操作）。
4. 找到下面两处，只替换引号里的示例值；`binding` 保持原样：

```jsonc
{
  "name": "hinge-relay-alice",
  "r2_buckets": [
    {
      "binding": "BUCKET",
      "bucket_name": "hinge-relay-alice-files"
    }
  ]
}
```

名称规则和对应关系：

- `name` 是 Worker 名称。之后 Cloudflare 创建的 Worker 名称必须与这里逐字一致；不要在 Dashboard 创建另一个不同名字的 Worker。
- `bucket_name` 是下一步要创建的 R2 bucket 名称，之后也必须逐字一致。
- `binding` 是源代码使用的绑定标识，必须保持大写 `BUCKET`，不能改名。
- bucket 名称使用小写英文字母、数字和短横线，长度为 3–63 个字符，不要以短横线开头或结尾；Cloudflare 还会检查名称是否已被占用。
- `DEFAULT_TTL_HOURS` 当前默认是 `168`，表示中转记录按最多 7 天的期限清理。初次部署先保留默认值。

5. 改完后往下滚动到 `Commit changes` 区域。提交说明可以写 `Set my Worker and R2 names`。
6. 选择直接提交到 `main`（默认选项），再点击绿色的 `Commit changes` 确认。
7. 返回仓库文件列表，重新打开 `wrangler.jsonc` 检查两个名称是否已经保存。

这里仅填写资源名称。**不要**在 `wrangler.jsonc`、GitHub 提交说明或 GitHub 文件中填写 `RELAY_ADMIN_TOKEN`、Relay 加密密钥、Cloudflare API Token 或其他真实凭据。改动提交到自己的 `main` 后，Cloudflare 才能读到这份配置。

### 4.4 在 Cloudflare 网页创建私有 R2 bucket

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)，确认页面左上角显示的是你准备使用的账号。
2. 从侧边栏打开 `R2 Object Storage`（部分界面可能先显示 `R2` 或 `Storage & databases`）。
3. 进入 bucket 列表/Overview，点击 `Create bucket`。
4. 在 Bucket name 输入框中，填写刚才写进 `wrangler.jsonc` 的完整 `bucket_name`，例如 `hinge-relay-alice-files`。注意不要多打空格，也不要带引号。
5. 如果页面提供位置或存储类别选项，首次部署可以使用 Cloudflare 推荐/默认选项；选择后点击创建按钮。
6. 回到 bucket 列表，确认新 bucket 出现在**当前这个 Cloudflare 账号**下，且名称拼写与 GitHub 文件一致。

创建后保持 bucket 私有。不要启用公开访问，也不要为这个 bucket 开启公开的 `r2.dev` 文件地址。Hinge Relay 通过 Worker 的 `BUCKET` 绑定访问对象，不要求把 bucket 变成公开文件站点。若 Cloudflare 页面要求选择地区，按账号页面能选到的选项操作即可；这个选择不改变 GitHub 中配置的 bucket 名称。

### 4.5 让 Cloudflare 网页连接你的 GitHub 仓库

这一步是在创建 Cloudflare Worker，并让它以后跟踪你 GitHub 仓库的 `main` 分支：

1. 在 Cloudflare Dashboard 打开 `Workers & Pages`。
2. 点击 `Create application`。如果出现多个选项，选择导入 GitHub 仓库/Workers Builds 的路径；不要选择只上传静态文件的 Pages 上传。
3. 在 `Import a repository` 一栏点击 `Get started`（Cloudflare 界面文字可能稍有变化）。
4. 如果 Cloudflare 请求连接 GitHub，点击授权并在 GitHub 页面确认。为了缩小权限范围，如果页面提供仓库选择，尽量只允许访问你的 Hinge-Relay Fork。
5. 返回 Cloudflare，选择 GitHub 账号/组织，再选择自己 Fork 的 `Hinge-Relay` 仓库。确认选中的不是 `Chengeeker/Hinge-Relay` 上游仓库。
6. 选择生产分支 `main`。如果页面要求先填写 Worker 名称，此名称必须与 `wrangler.jsonc` 的 `name` 完全一致。
7. 展开构建设置/Advanced settings（若界面有此项），按下表填写：

| Cloudflare 设置 | 应填写的内容 |
| --- | --- |
| Root directory | 留空，使用仓库根目录；若页面强制要求填写，则选择 `/` 或根目录 |
| Production branch | `main` |
| Build command | `npm run check`（可选，建议保留） |
| Deploy command | `npm run deploy` |
| Preview / 非生产分支部署 | 暂时不需要预览分支时保持关闭或默认值 |

本项目已经包含 `wrangler.jsonc`，其中定义 Worker 名称、R2 binding 和定时任务。`npm run check` 会检查 TypeScript；`npm run deploy` 会调用项目自带的 Wrangler 部署脚本。Cloudflare 在后台执行这些项目命令，你不需要在自己的电脑上执行 `npx`。若界面自动填入默认部署命令且不能编辑，保留 Cloudflare 为该项目提供的默认 Wrangler 部署命令即可。

8. 仔细检查仓库、`main` 分支、Root directory 和 Worker 名称后，点击 `Save and Deploy`（或界面上的同义按钮）。这会开始第一次构建和部署。
9. 部署期间不要关闭或删除 Worker。打开 Worker 的 `Deployments` 页面/构建历史，可以看到正在进行的步骤；失败时点开失败的那次构建查看具体日志。
10. 成功后，在 Worker 的概览/设置页找到 `workers.dev` 域名。地址通常类似：

```text
https://hinge-relay-alice.你的子域.workers.dev
```

复制这个根地址，稍后配置 Hinge 时使用；不要在 Hinge 的 Worker 地址栏后面附加 `/v1`。首次部署成功只说明 Cloudflare 接受了构建和部署；下一步还要单独设置 Secret 并完成健康检查、设备注册。

连接完成后，对自己 `main` 分支的后续代码提交会触发 Cloudflare 构建/部署。可以在 Worker 的 `Deployments` 查看每次结果。Cloudflare 的 Git 集成设置入口或按钮文字可能随 Dashboard 更新而变化；找不到时，可从该 Worker 的 `Settings` → `Builds` 检查 GitHub 连接、生产分支和部署命令。

### 4.6 在 Cloudflare 网页添加管理员 Token

管理员 Token 是首次把 Hinge 设备注册到 Relay 时用的凭据。请用密码管理器生成随机值（建议至少 16 个随机字符），并暂时安全保存。当前 Worker 接受的最低长度是 8 个字符；8 只是系统下限，不是建议强度。不要手工编一个常见短密码。

现在在 Cloudflare Dashboard 进入刚创建的 Worker：

1. `Workers & Pages` → 选择你的 Worker。
2. 打开 `Settings`。
3. 找到 `Variables and Secrets`（有些界面会先显示 `Variables`）。
4. 点击 `Add` / `Add variable`，类型或类别选择 `Secret`，不要选普通明文变量。
5. 名称填写下面这个值，大小写和下划线都要一致：

```text
RELAY_ADMIN_TOKEN
```

6. 将密码管理器生成的 Token 粘贴到值输入框。检查首尾没有意外空格，再点击保存/继续。
7. Cloudflare 通常会显示部署确认页或 `Deploy` 按钮；点击它，让新增的 Secret 应用到 Worker。
8. 回到 `Deployments` 等待这次部署显示成功，再进行设备注册。

这个 Token 只用于首次注册 Windows/Android 设备。不要把它误填到 Cloudflare Workers Builds 的 API Token、GitHub Secret 或 `wrangler.jsonc` 中；它们是不同用途的凭据。管理员 Token 不加密文件，Relay 加密密钥也不能代替管理员 Token。

Cloudflare 保存后不会再次显示 Secret 原值。注册 Hinge 设备时要粘贴完全相同的 Token。如果之后弄丢原值，不需要找回旧值：在同一位置设置新 Token 并再次部署，然后在注册设备时使用新 Token。

### 4.7 检查 Worker，再注册设备验证完整链路

先把 `你的 Worker 根地址` 替换为上一步复制的 `workers.dev` 地址，并在浏览器打开：

```text
https://hinge-relay-alice.你的子域.workers.dev/v1/health
```

正常时页面会显示一段 JSON，字段包括 `service`、`relayVersion`、`apiVersion` 和 `configSchemaVersion`。这一步证明浏览器能访问 Worker 健康检查路由，并能看到当前部署版本；**它不会验证管理员 Secret 是否正确，也不会实际读写 R2**。如果健康检查不通，先看下面的构建/域名排查，不要继续在 Hinge 里反复注册。

接下来按照[配置两台 Hinge 设备](#5-配置两台-hinge-设备)分别注册 Windows 和 Android。设备注册会实际使用管理员 Secret，并写入 R2 的设备记录；两台设备注册成功后，再按[第一次完整测试](#6-第一次完整测试)发一个小文件，这才是对 Worker、Secret、R2 binding 和 Hinge 配置的端到端检查。

### 4.8 出错时按现象检查

| 现象 | 优先检查 |
| --- | --- |
| Cloudflare 找不到仓库 | 回到 GitHub 授权页，确认授权了你自己的 Fork；必要时在 Cloudflare GitHub 集成设置中更新仓库访问范围 |
| 构建在部署前失败 | 打开失败构建日志；检查 Root directory 是仓库根目录，且根目录包含 `package.json`、`package-lock.json`、`src`、`wrangler.jsonc` |
| 提示 Worker 名称不匹配 | 比较 Dashboard 中 Worker 名称与 Fork 的 `wrangler.jsonc` → `name`，修正后提交到 `main` 并重新部署 |
| Worker 页面有，但 `/v1/health` 是 404 | 检查是否复制了正确的 `workers.dev` 根地址，以及路径是否为 `/v1/health`；不要误用 Pages 静态站点地址 |
| Hinge 注册返回 `503 admin_token_not_configured` | Secret 名必须精确为 `RELAY_ADMIN_TOKEN`、类型选 `Secret`、长度至少 8，并在添加后点击 `Deploy` 等待部署成功 |
| Hinge 注册返回 `401 admin_auth_failed` | 重新核对 Worker 地址和管理员 Token；Cloudflare 不会再显示已保存的值，可重设 Secret 并部署后重试 |
| 部署或注册时报 `BUCKET` / R2 错误 | 核对 GitHub `wrangler.jsonc` 的 `bucket_name` 与当前 Cloudflare 账号里的真实 bucket 名称完全一致，且 `binding` 仍为 `BUCKET` |

排错时先查看 Cloudflare Worker 的 `Deployments` 中最新一次构建详情和日志。README 第 10 节也整理了设备注册与传输阶段的常见问题。

### 4.9 如果网页部署提示缺少 BUCKET

优先回到 GitHub，确认 `wrangler.jsonc` 中同时存在：

```jsonc
"binding": "BUCKET",
"bucket_name": "你创建的bucket名称"
```

先确认 bucket 已经在同一个 Cloudflare 账号中创建，再回到 Worker 的 `Settings` → `Builds` 重新部署（也可以在 `Deployments` 中选择重试失败的构建）。如果 Dashboard 明确提示运行时缺少 R2 binding，才通过 `Settings` → `Bindings` → `Add` → `R2 bucket` 手动检查或添加：变量名填写 `BUCKET`，选择同一个 bucket 并重新部署。

本项目使用 GitHub + Wrangler 配置作为部署来源。后续仍应以自己仓库的 `wrangler.jsonc` 为准；不要长期在 Dashboard 和 GitHub 中维护两份不一致的 binding 配置。

### 4.10 为什么不推荐直接把代码粘贴到 Cloudflare 编辑器

这个项目不是一个可以粘贴成单个 JavaScript 文件的小 Worker，它包含多个 TypeScript 文件、Hono 依赖、R2 配置、定时任务和测试。直接使用在线代码编辑器容易漏掉依赖或 binding。

因此对不熟悉命令行的用户，推荐按本节完成下面这条网页流程：

```text
GitHub 网页仓库
    → Cloudflare Workers Builds
    → Cloudflare Dashboard 添加 R2 和 Secret
```

这条路径不需要本地安装 Node.js、Git、Wrangler，也不需要执行任何 `npx` 命令。Cloudflare Pages 的静态文件上传仍然不能代替 Worker API 部署。

### 4.11 命令行部署（备用方案）

下面命令以 Windows PowerShell 为例。请把示例中的路径替换成你自己保存 Hinge Relay 的位置。

#### 第 1 步：进入项目目录

```powershell
cd "C:\Users\你的用户名\Documents\Hinge-Relay"
```

确认当前位置确实是这个项目：

```powershell
Get-ChildItem
```

你应该能看到 `package.json`、`wrangler.jsonc`、`src`、`tests` 等文件。

#### 第 2 步：安装依赖

```powershell
npm ci
```

`npm ci` 会严格按照 `package-lock.json` 安装依赖。以后如果只是重新部署，通常不需要反复安装；只有换电脑、删除了 `node_modules` 或依赖发生变化时才需要执行。

检查依赖和 TypeScript：

```powershell
npm run check
npm test
```

两个命令都通过，才继续部署。当前项目也可以用下面命令预览部署内容，但它不会真的上线：

```powershell
npm run deploy:dry
```

#### 第 3 步：登录 Cloudflare

```powershell
npx wrangler login
```

浏览器会打开 Cloudflare 授权页面。登录完成后回到终端即可。

如果你不想使用网页登录，也可以使用 Cloudflare API Token，但 Token 权限必须足够小，并且不要写进 Git 或 README。第一次部署推荐使用 `wrangler login`。

#### 第 4 步：修改自己的 Worker 和 R2 名称

打开你自己项目目录中的：

```text
你的项目目录\wrangler.jsonc
```

至少修改这两个值：

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

注意：

- `name` 是 Worker 名称，建议使用只包含小写字母、数字和短横线的名称。
- `bucket_name` 是 R2 bucket 名称，建议使用只包含小写字母、数字和短横线的名称。
- `binding` 必须保持为 `BUCKET`。源代码就是通过这个名字访问 R2 的，改成其他名字会导致部署后运行失败。
- `wrangler.jsonc` 是你的个人部署配置，包含你自己的资源名称。上游同步时不要让它被自动覆盖。
- `DEFAULT_TTL_HOURS` 默认是 `168`，表示中转记录最多保留 7 天；可以按需要调整，但不建议设置成无限期。

#### 第 5 步：创建 R2 bucket

假设你在 `wrangler.jsonc` 中填的是 `my-hinge-relay-files`，执行：

```powershell
npx wrangler r2 bucket create my-hinge-relay-files
```

如果提示 bucket 已存在，通常说明它已经创建过；确认它属于你当前登录的 Cloudflare 账号即可。

然后检查 `wrangler.jsonc` 中的 `bucket_name` 是否和真实 bucket 名称完全一致。

R2 bucket 必须保持私有，不要把它公开成静态文件站点，也不要把文件直接放到公开的 `r2.dev` 地址上。客户端应该只通过 Worker API 访问。

#### 第 6 步：设置管理员注册 Token

Relay 的“管理员 Token”只用于把设备注册到你的 Worker。设备注册成功后，Hinge 日常传输使用的是每台设备独立的 device token，不再使用管理员 Token。

执行：

```powershell
npx wrangler secret put RELAY_ADMIN_TOKEN
```

终端会要求你输入一个秘密值。最少 8 个字符；建议密码管理器生成至少 16 个随机英数字符。不要使用 `123456`、自己常用的密码、Cloudflare 密码或 GitHub Token。

这个值只需要在下面注册 Windows 和 Android 设备时临时输入。不要把它写进：

- `wrangler.jsonc`
- `.dev.vars.example`
- GitHub 仓库
- 截图、Issue、聊天记录

以后如果怀疑 Token 泄露，可以再次执行同一条命令并设置新值，然后重新注册设备。

#### 第 7 步：部署 Worker

```powershell
npm run deploy
```

部署成功后，Wrangler 会显示一个 Worker 地址，通常类似：

```text
https://你的-worker名称.你的子域.workers.dev
```

复制这个地址。Hinge 设置中填写的是这个地址的根路径，不要手动追加 `/v1`：

```text
正确：https://hinge-relay-example.workers.dev
不建议：https://hinge-relay-example.workers.dev/v1
```

#### 第 8 步：检查健康状态

把下面的地址替换成你的 Worker 地址，在浏览器打开：

```text
https://你的-worker地址/v1/health
```

正常时会返回一段 JSON，其中包含 `service`、`relayVersion`、`apiVersion` 和 `configSchemaVersion`。如果这里打不开，先不要配置 Hinge，直接看[故障排查](#10-故障排查)。

也可以在 PowerShell 中检查：

```powershell
Invoke-RestMethod "https://你的-worker地址/v1/health"
```

到这里，Cloudflare 端就部署完成了。

---

## 5. 配置两台 Hinge 设备

这一部分最容易出错。请记住三个不同的东西：

| 名称 | 用途 | 是否两台设备相同 |
| --- | --- | --- |
| Worker 地址 | 找到你的 Relay 服务 | 相同 |
| Relay 加密密钥 | 两台设备共享的文件加密主密钥；当前生成 32 字节随机值（43 个 Base64URL 字符），只留在设备上 | 相同；点“生成密钥/复制密钥”后粘贴，不要手打 |
| 部署 Token | Worker 管理员凭据，只授权设备注册，不加密文件；至少 8 字符，建议用密码管理器生成 16+ 个随机字符 | 注册每台设备时使用同一个值，成功后不长期保存 |
| Device Token | Worker 返回给每台设备的日常 API 凭据 | 不同，由 Worker 生成并由 Hinge 保存 |

### 5.1 先确认 Hinge 设备信任关系

在配置 Cloud Relay 之前，先让两台设备通过 Hinge 原有方式完成发现、配对和信任。

Cloud Relay 不负责第一次配对。这样设计是为了避免任何拿到 Worker 地址的人都能随意把陌生设备加入你的文件中转网络。

### 5.2 在 Windows 上配置

1. 打开 Hinge 设置。
2. 找到 `Cloud Relay` 区域。
3. 填写 `Worker 地址`，例如 `https://hinge-relay-example.workers.dev`。
4. 点击 `生成密钥`。
5. 点击 `复制密钥`，暂时保存到密码管理器或安全的临时位置。
6. 填写 `部署 Token（仅注册时使用）`，内容就是第 6 步设置的 `RELAY_ADMIN_TOKEN`。
7. 点击 `保存配置`。
8. 点击 `注册此设备`。
9. 看到注册成功后，点击 `测试 Worker`。

然后打开 Android Hinge 的 Cloud Relay 设置：

1. 填写完全相同的 Worker 地址。
2. 粘贴 Windows 生成的同一个 Relay 加密密钥。
3. 填写同一个部署 Token。
4. 点击 `注册此设备`。
5. 注册成功后点击 `保存配置`，并打开 `启用 Cloud Relay`。

最后回到 Windows，也确认已经打开 `启用 Cloud Relay`。

Android 的注册页面不会长期保存部署 Token。Windows 端也应把它当作一次性注册凭据使用。两台设备真正长期使用的是各自的 device token。

简单记忆：部署 Token 是“允许这台设备加入 Relay”的登记凭据；Relay 加密密钥才是“让两台设备能解密文件”的共享秘密。不要把前者当成文件密钥，也不要把后者填到 Cloudflare 的 `RELAY_ADMIN_TOKEN`。

### 5.3 为什么必须使用同一个 Relay 密钥

Worker 和 R2 只保存加密后的内容。文件元数据和每个文件分块都是在发送端用 Relay 密钥派生的 AES-256-GCM 密钥加密的。

如果 Windows 和 Android 各自点击一次“生成密钥”，得到的是两个不同的密钥。这样即使上传和下载都成功，接收端也无法解密，最终校验会失败。

正确做法是：

```text
Windows 生成一次
    → 复制这一个密钥
    → Android 粘贴同一个密钥
```

Relay 密钥不会上传 Worker，也不要把它提交到 GitHub。

---

## 6. 第一次完整测试

建议先传一个很小的测试文件，例如几百 KB 的文本文件。

### 测试前

- 两台设备已经在 Hinge 中互相信任。
- 两台设备都注册成功。
- 两台设备使用同一个 Worker 地址和 Relay 密钥。
- `/v1/health` 可以访问。
- R2 bucket 是私有的。

### 测试步骤

1. 让两台设备都打开 Hinge。
2. 暂时断开它们之间的局域网连接，或者让发送端无法连接接收端的 LAN 地址。
3. 在发送端选择接收设备和测试文件。
4. 发送端应该显示类似：`已上传云中转 · 等待设备接收`。
5. 在接收端打开或恢复 Hinge，等待它轮询 Relay。
6. 接收端下载并解密文件。
7. Hinge 校验文件大小和 SHA-256 后，把文件保存到接收端。
8. 接收端发送 ACK，Worker 再清理对应的加密文件。

如果局域网仍然可用，Hinge 会优先使用局域网，你可能看不到 Cloud Relay 状态。这不是失败，而是设计如此。

### 文件到底经过了什么路径

```text
原始文件
  ↓ Hinge 客户端加密
加密元数据 + 加密分块
  ↓ HTTPS
你的 Cloudflare Worker
  ↓
你的私有 R2
  ↓ 接收设备轮询
Hinge 下载并解密
  ↓ SHA-256 校验
本地最终文件
  ↓ ACK
Worker 清理已确认的中转文件
```

Worker 需要知道路由和分块信息，但不会读取文件名、文件内容或明文 SHA-256。R2 的对象名也不是原始文件名。

---

## 7. 常见问题先看这里

### 浏览器打不开 `/v1/health`

先检查：

1. Worker 是否真的执行了 `npm run deploy`。
2. Hinge 设置里是否误填成了 `/v1` 结尾。
3. Worker 名称和域名是否复制完整。
4. Cloudflare 是否把 Worker 路由到了正确账号。
5. `wrangler.jsonc` 中是否保留了 `main: "src/index.ts"`。

### `/v1/health` 正常，但注册设备失败

请先看 Hinge 的完整报错以及 Worker 的 `/v1/health`：

- `503` / `admin_token_not_configured`：当前部署没有可用的 `RELAY_ADMIN_TOKEN`，或它少于 8 个字符。到 Cloudflare `Settings` → `Variables and Secrets` 检查它是 `Secret`，然后点击 `Deploy` 并等待部署成功。
- `401` / `admin_auth_failed`：Hinge 填入的 Token 与当前 Worker 不一致，或 Worker 地址指向了另一份部署。请从密码管理器重新复制原值；Cloudflare 不会在保存后再次显示 Secret。
- 如果仍只看到旧版的 `admin authentication failed`，先查看 Cloudflare `Deployments` 是否已经部署包含此诊断的最新版本；旧版 Worker 会把“Secret 未部署”和“值不匹配”都返回为同一个 401。

保存新的 Secret 后必须点击 `Deploy`，等新部署完成，再用这一个新值注册。网页方式在 Cloudflare Dashboard 修改；命令行方式可执行：

```powershell
npx wrangler secret put RELAY_ADMIN_TOKEN
```

然后把同一个新值粘贴到设备注册页面。不要把设备 Token 当成管理员 Token，也不要把 Relay 加密密钥当成管理员 Token。`/v1/health` 不会检查或公开管理员 Secret 是否正确，这是有意的安全边界。

### 注册提示 receiver 未注册

接收设备还没有在同一个 Worker 上注册。必须先分别在两台设备上完成注册，而且两台设备填写的 Worker 地址必须完全相同。

### 文件上传成功，但接收端无法解密

优先检查两台设备的 Relay 加密密钥是否逐字符一致。最常见的原因是两台设备分别点击了“生成密钥”，或者复制时漏掉了开头/结尾字符。

### 明明配置了 Cloud Relay，文件还是走局域网

这是正常的。路由顺序固定为：

```text
可用 LAN Session → LAN
没有 LAN Session + Cloud Relay 完整配置 → Cloud Relay
```

只有在局域网不可用时才会触发云中转。

### 文件上传了，但 Android 没有马上收到

Cloud Relay 是异步轮询，不是强制唤醒服务。Android Hinge 被系统完全停止时不会承诺立即下载；打开 Hinge、恢复应用，或等待系统允许的任务触发后再检查。

### 部署时报 R2 binding 错误

检查 `wrangler.jsonc`：

```jsonc
"r2_buckets": [
  {
    "binding": "BUCKET",
    "bucket_name": "实际创建的bucket名称"
  }
]
```

`binding` 必须是大写 `BUCKET`，并且 `bucket_name` 必须是你账号中真实存在的 bucket。

### ACK 失败后会不会重复下载

如果接收端已经保存文件，但 ACK 因网络问题没有到达，下一次轮询可能再次看到同一条记录。Hinge 会使用 transfer ID 和本地传输记录处理重复情况，但不要手动删除本地文件或 R2 对象来“修复”问题。先恢复网络，再让接收端重新运行。

### 我把代码导入 Cloudflare Pages，为什么 API 不能运行

仅仅上传静态文件到 Pages 不会自动执行这个 Worker。这个项目是 Worker API，不是静态网页。

可以使用：

- Wrangler 命令行部署；
- Cloudflare 的 Worker 项目/Git 集成，并配置 R2 binding 和 Secret；
- 导入源码后，在 Worker/Functions 运行环境中部署。

不能只使用“静态 Pages 上传”而不配置 Worker 运行环境。具体部署选项也可以看 [`docs/DEPLOY.md`](docs/DEPLOY.md)。

---

## 8. 安全规则

请把下面几条当成硬性规则：

1. R2 bucket 保持私有，Worker 是唯一访问入口。
2. 不要把 `RELAY_ADMIN_TOKEN` 写入源码、配置文件或 GitHub。
3. 不要把 Relay 加密密钥提交到 GitHub，也不要通过公开 Issue 发送。
4. 不要使用公开 `r2.dev` 地址承载文件。
5. 不要把 `.dev.vars`、`.env` 或本地凭据提交到仓库。
6. 管理员 Token 泄露后立即轮换，并重新注册设备。
7. Relay 密钥泄露后，生成新的密钥并在两台设备上同时替换；旧的中转记录可能无法用新密钥解密，应先让旧任务完成或清理后再切换。
8. 如果要把项目公开到 GitHub，先检查提交历史中是否曾经出现过 Token、密钥、Worker 私有配置或 `.dev.vars`。

当前版本的客户端配置会沿用 Hinge 现有的本地设置存储。它不是独立的 Hinge 账号系统，也不代表已经使用了 Windows DPAPI 或 Android Keystore。高安全场景下仍然要保护设备本身，并控制谁能访问本地 Hinge 配置。

更完整的安全边界见 [`SECURITY.md`](SECURITY.md)。

---

## 9. 如何更新 Relay 项目

### 网页部署后的自动更新

如果你使用了 Cloudflare Workers Builds：

1. 你把代码推送到自己仓库的 `main` 分支，或者在 GitHub 网页合并上游同步 Pull Request。
2. Cloudflare 会自动开始一次新的构建。
3. 构建成功后，Worker 会自动部署新版本。
4. 可以在 Cloudflare Worker 的 `Deployments` 页面查看构建日志和部署结果。

如果只是想修改部署配置或管理员 Token，不要把它们写进 GitHub。分别在 Cloudflare Dashboard 的 `Settings` → `Variables and Secrets` 或构建设置中修改。

如果暂时不想自动部署，可以在 Worker 的 `Settings` → `Builds` 中断开 GitHub 连接或关闭自动部署。Cloudflare 官方的 Git 集成说明见 [Workers Builds 文档](https://developers.cloudflare.com/workers/ci-cd/builds/)。

### 最简单的方式：手动更新

更新前先备份你自己的部署配置：

- `wrangler.jsonc`
- `.dev.vars`
- `.env*`
- Cloudflare Secrets
- 任何你自己添加的脚本或 Worker 路由

然后在你自己的项目目录运行：

```powershell
cd "C:\Users\你的用户名\Documents\Hinge-Relay"
npm ci
npm run check
npm test
npm run deploy:dry
npm run deploy
```

不要直接覆盖自己的 `wrangler.jsonc`。这个文件包含你的 Worker 名称、R2 bucket 绑定和个人部署设置。

### GitHub 上的上游同步

本项目包含：

```text
.github/workflows/upstream-sync.yml
```

它的作用是：在你自己的 GitHub 仓库中，定期检查上游 Hinge Relay 是否有新的源码、测试和文档，然后创建 Pull Request 供你审核。

它不会：

- 直接修改你的 Cloudflare Secret；
- 自动替换你的 R2 bucket；
- 绕过你的审核直接部署；
- 在上游改变部署配置时静默覆盖你的配置。

如果你的 GitHub 仓库不是 `Chengeeker/Hinge-Relay`，在仓库 Settings → Secrets and variables → Actions → Variables 中创建：

```text
HINGE_RELAY_UPSTREAM=你的上游仓库，例如 Chengeeker/Hinge-Relay
```

第一次建议不要马上启用自动同步。先手动完成一次部署，确认自己的 `wrangler.jsonc`、R2 binding 和 Secret 都理解清楚，再启用 Workflow。

### 版本升级前检查

如果下面任意文件发生变化，不要直接点合并：

- `wrangler.jsonc`
- `CONFIG_SCHEMA_VERSION`
- `API_VERSION`
- `src/types.ts`
- `protocol` 或 API 文档

这可能表示需要手动迁移，而不仅仅是更新几行源码。先看 Pull Request 说明和 [`docs/UPDATE.md`](docs/UPDATE.md)。

---

## 10. 给开发者的目录说明

如果你只是使用 Relay，通常只需要看本 README、`wrangler.jsonc` 和 Cloudflare 设置。下面是源码地图：

```text
你的项目目录
├─ src/
│  ├─ index.ts              Worker API 路由、认证、上传、下载、ACK、清理
│  ├─ types.ts              Worker 使用的数据结构
│  └─ lib/
│     ├─ auth.ts             管理员/设备 Token 校验
│     ├─ r2.ts               R2 对象读写和对象名
│     └─ validation.ts       请求参数和 manifest 校验
├─ tests/                    Worker 单元测试
├─ docs/
│  ├─ API.md                 API v1 端点说明
│  ├─ DEPLOY.md              精简部署说明
│  └─ UPDATE.md              上游更新和配置保护规则
├─ .github/workflows/
│  ├─ ci.yml                 类型检查和测试
│  └─ upstream-sync.yml      用户仓库的上游同步
├─ wrangler.jsonc            你的 Worker/R2 部署配置
├─ .dev.vars.example         本地开发变量示例，不是正式 Secret
├─ SECURITY.md               安全边界和风险说明
└─ package.json              npm 命令和依赖
```

### 本地开发

如果只是验证类型和测试：

```powershell
npm run check
npm test
```

如果需要启动 Wrangler 开发服务器：

```powershell
npm run dev
```

本地开发可能需要 `.dev.vars` 和本地 R2 模拟配置。不要把它复制成正式生产 Secret，也不要把真实管理员 Token 放进示例文件。

### 修改代码前的检查顺序

建议每次都按下面顺序：

1. 先看本 README 和相关的 `docs/` 文件。
2. 确认现有 API 或 Hinge 客户端是否已经支持你想做的功能。
3. 先写或更新测试，再修改 Worker 源码。
4. 运行 `npm run check` 和 `npm test`。
5. 运行 `npm run deploy:dry`，确认 R2 binding 没有丢失。
6. 最后再执行 `npm run deploy`。
7. 如果你是本项目维护者，把重要的行为变化同步记录到维护文档；普通使用者只需要保留自己的部署变更记录。

---

## 11. 当前实现的边界

这是第一版 Cloud Relay，下面这些能力目前没有承诺：

- LAN 传输中断后，不保证从同一个 transfer 无缝续传到 Cloud Relay。
- 不提供 Hinge 官方托管的统一账号或设备目录。
- 不保证 Android 在被系统强制停止时立即执行下载。
- 不提供远程管理后台；设备注册和文件处理通过 Hinge 客户端完成。
- 初版不提供“发送端远程取消已提交 manifest”的完整流程。

这不是部署错误，而是当前协议和客户端实现的边界。完整协议说明见主 Hinge 项目的 [`protocol/cloud-relay.md`](https://github.com/Chengeeker/Hinge/blob/main/protocol/cloud-relay.md)。

---

## 12. 你现在应该做什么

按照下面的最短路径操作：

```text
1. 确认两台设备已经在 Hinge 中互相信任
2. 进入你自己的 Hinge Relay 项目目录，执行 npm ci
3. 修改 wrangler.jsonc 的 Worker 名称和 R2 bucket 名称
4. 执行 npx wrangler login
5. 创建 R2 bucket
6. 设置 RELAY_ADMIN_TOKEN
7. 执行 npm run check、npm test、npm run deploy
8. 打开 /v1/health 确认 Worker 正常
9. Windows 生成 Relay 密钥并注册
10. Android 粘贴同一个 Relay 密钥并注册
11. 两台设备打开“启用 Cloud Relay”
12. 断开局域网，发送一个小文件测试
```

遇到问题时，不要先重复部署很多次。先判断问题位于哪一层：

```text
/v1/health 打不开       → Cloudflare Worker/域名/部署问题
health 正常但注册失败  → 根据 503/401 检查 Secret 是否已部署、值是否匹配
注册成功但无法解密     → 两台设备 Relay 密钥不一致
文件不自动出现         → Android 轮询或系统后台限制
一直走 LAN              → LAN 优先，是预期行为
```

---

## 13. 相关文档

- [`docs/API.md`](docs/API.md)：Worker API v1 的端点和认证方式。
- [`docs/DEPLOY.md`](docs/DEPLOY.md)：部署配置的精简参考。
- [`docs/UPDATE.md`](docs/UPDATE.md)：上游同步、配置保护和升级边界。
- [`SECURITY.md`](SECURITY.md)：安全边界、密钥和 R2 访问规则。
- [Hinge 主项目](https://github.com/Chengeeker/Hinge)：Windows/Android 客户端。
- [Hinge Cloud Relay 协议](https://github.com/Chengeeker/Hinge/blob/main/protocol/cloud-relay.md)：客户端和 Worker 之间的数据格式。
- [Cloudflare Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/)：GitHub 网页集成和自动部署。
- [Cloudflare R2 创建 bucket](https://developers.cloudflare.com/r2/buckets/create-buckets/)：网页创建私有 R2 bucket。
- [Cloudflare Worker Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)：网页添加 `RELAY_ADMIN_TOKEN`。

本项目是用户自托管软件。部署后的 Cloudflare 费用、配额、域名和账号权限由部署者自己承担和管理，请以 Cloudflare 当前官方文档和控制台显示为准。
