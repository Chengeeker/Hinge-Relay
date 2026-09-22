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

### 必需

1. 一个 Cloudflare 账号。
2. Cloudflare R2 可用的账号/套餐配置。
3. 一台安装了 Node.js LTS 的 Windows、macOS 或 Linux 电脑，用来部署 Worker。
4. 两台已经在 Hinge 中互相信任的设备：一台发送，一台接收。
5. 两台设备上都安装包含 Cloud Relay 功能的 Hinge 版本。

### 可选

- GitHub 账号：使用本文推荐的“Cloudflare 网页部署”时需要；如果只在本地用 Wrangler 部署，可以不使用 GitHub。
- Git：网页部署不要求你在电脑上安装 Git；只有你打算在本地开发或使用命令行部署时才需要。

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

网页部署依靠 Cloudflare Workers Builds 从 GitHub 读取源码。你不需要在电脑上执行 `npx`，但需要有一个自己的 GitHub 仓库：

1. 打开 [Hinge Relay GitHub 仓库](https://github.com/Chengeeker/Hinge-Relay)。
2. 点击 `Fork`，把项目复制到你自己的 GitHub 账号下。
3. 后面的操作都在你自己的 Fork 中进行，不要直接修改上游仓库。

你也可以把源码复制到自己的私有仓库，但必须保留项目根目录下的 `package.json`、`package-lock.json`、`src`、`wrangler.jsonc` 和 `tests`。

### 4.2 在 GitHub 网页修改 Worker 名称和 R2 名称

在你自己的 GitHub 仓库中打开 `wrangler.jsonc`，点击右上角铅笔图标进行编辑。只修改下面两个值：

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

填写规则：

- `name` 是 Worker 名称。Cloudflare 网页中显示的 Worker 名称必须和这里完全一致。
- `bucket_name` 是你接下来在 R2 中创建的 bucket 名称。
- `binding` 必须保持为 `BUCKET`，不能改成其他名字。
- bucket 名称只能使用小写字母、数字和短横线，不能以短横线开头或结尾。
- `DEFAULT_TTL_HOURS` 默认是 `168`，表示中转记录最多保留 7 天。

编辑完成后点击 `Commit changes`，提交到 `main` 分支。不要把 `RELAY_ADMIN_TOKEN`、Relay 密钥或其他真实凭据写进这个文件。

### 4.3 在 Cloudflare 网页创建私有 R2 bucket

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)。
2. 进入 `R2 Object Storage`。
3. 点击 `Create bucket`。
4. 填写的 bucket 名称必须和 GitHub 中 `wrangler.jsonc` 的 `bucket_name` 完全一致。
5. 选择存储位置和默认存储类别，然后创建。

创建后不要打开公开访问，也不要启用公开的 `r2.dev` 文件地址。Hinge Relay 只通过 Worker API 访问私有 R2。

### 4.4 通过 Cloudflare 网页导入 GitHub 仓库

1. 在 Cloudflare Dashboard 打开 `Workers & Pages`。
2. 点击 `Create application`。
3. 在 `Import a repository` 旁边点击 `Get started`。
4. 选择或授权你的 GitHub 账号。
5. 选择你自己的 Hinge Relay 仓库和 `main` 分支。
6. 配置项目时使用下面的值：

| Cloudflare 设置 | 应填写的内容 |
| --- | --- |
| Root directory | 留空，或填写 `/`；本项目就在仓库根目录 |
| Production branch | `main` |
| Build command | `npm run check`（可选，建议保留） |
| Deploy command | `npm run deploy` |
| Non-production branch deploy command | 不需要测试分支时保持默认或关闭 |

本项目已经包含 `wrangler.jsonc`，Cloudflare 会使用其中的 Worker 名称、R2 binding 和定时任务。`npm run deploy` 已经写在 `package.json` 中；如果界面没有要求你填写 Deploy command，也可以使用默认的 `npx wrangler deploy`。

点击 `Save and Deploy`。Cloudflare 会安装项目依赖、执行构建并部署 Worker。成功后会显示一个类似下面的地址：

```text
https://你的-worker名称.你的子域.workers.dev
```

Cloudflare 官方说明：连接 GitHub 后，后续推送到选定分支会自动触发构建和部署；如果部署失败，先检查 Dashboard 中 Worker 名称是否与 `wrangler.jsonc` 的 `name` 完全一致。

### 4.5 在 Cloudflare 网页添加管理员 Token

这一步不要把 Token 写进 GitHub。进入刚创建的 Worker：

1. `Workers & Pages` → 选择你的 Worker。
2. 打开 `Settings`。
3. 找到 `Variables and Secrets`。
4. 点击 `Add`，类型选择 `Secret`。
5. 变量名填写：

```text
RELAY_ADMIN_TOKEN
```

6. 值填写一个密码管理器生成的随机高强度 Token，至少 32 字节。
7. 点击 `Deploy` 保存。

这个 Token 只用于第一次注册 Windows/Android 设备。不要把它误填到 Cloudflare Workers Builds 的 API Token、GitHub Secret 或 `wrangler.jsonc` 中；它们是不同用途的凭据。

### 4.6 检查网页部署是否成功

在浏览器打开：

```text
https://你的-worker地址/v1/health
```

如果返回包含 `service`、`relayVersion`、`apiVersion` 和 `configSchemaVersion` 的 JSON，说明 Worker、R2 binding 和路由已经能正常工作。然后再按照[配置两台 Hinge 设备](#5-配置两台-hinge-设备)操作。

### 4.7 如果网页部署提示缺少 BUCKET

优先回到 GitHub，确认 `wrangler.jsonc` 中同时存在：

```jsonc
"binding": "BUCKET",
"bucket_name": "你创建的bucket名称"
```

然后在 Cloudflare 的 `Settings` → `Builds` 中重新执行一次部署。只有在当前 Dashboard 明确要求手动添加 binding 时，才进入 `Settings` → `Bindings` → `Add` → `R2 bucket`，变量名填写 `BUCKET`，选择同一个 bucket 并重新部署。

后续仍应以 GitHub 中的 `wrangler.jsonc` 为准。不要一边在 Dashboard 手动改 binding，一边让 GitHub 构建使用另一份配置。

### 4.8 为什么不推荐直接把代码粘贴到 Cloudflare 编辑器

这个项目不是一个可以粘贴成单个 JavaScript 文件的小 Worker，它包含多个 TypeScript 文件、Hono 依赖、R2 配置、定时任务和测试。直接使用在线代码编辑器容易漏掉依赖或 binding。

因此对不熟悉命令行的用户，推荐使用：

```text
GitHub 网页仓库
    → Cloudflare Workers Builds
    → Cloudflare Dashboard 添加 R2 和 Secret
```

这条路径不需要本地安装 Node.js、Git、Wrangler，也不需要执行任何 `npx` 命令。Cloudflare Pages 的静态文件上传仍然不能代替 Worker API 部署。

### 4.9 命令行部署（备用方案）

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

终端会要求你输入一个秘密值。可以使用密码管理器生成一个随机的高强度 Token，至少 32 字节；不要使用 `123456`、Cloudflare 密码或 GitHub Token。

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
| Relay 加密密钥 | 让两台设备互相解密文件 | 相同 |
| 部署 Token | 首次把设备注册到 Worker | 输入同一个值，但不会长期保存 |
| Device Token | 某一台设备日常调用 API | 不同，由 Worker 生成 |

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

通常是管理员 Token 不一致。重新执行：

```powershell
npx wrangler secret put RELAY_ADMIN_TOKEN
```

然后把新值同时填入设备注册页面。注意不要把设备 Token 当成管理员 Token，也不要把 Relay 加密密钥当成管理员 Token。

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
health 正常但注册失败  → 管理员 Token 问题
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
