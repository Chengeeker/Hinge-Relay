# Hinge Relay

Hinge Relay 是 Hinge 的**自托管 Cloudflare 文件中转服务**，新版客户端还可以单独授权剪贴板中转。

它解决的问题很简单：两台已经互相信任的 Hinge 设备暂时不在同一个局域网时，发送设备先把文件加密后放进你自己的 Cloudflare R2，接收设备之后再取回、解密、校验并确认收件。

这不是 Hinge 官方云服务。你需要使用自己的 Cloudflare 账号部署 Worker 和 R2；Hinge 项目本身不会替你保存账号、文件或中转密钥。

本文先简要说明 Relay 的用途，再按网页步骤带你完成部署、设备注册和收发验证。

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
- 新版客户端在局域网不可用时可选中转加密纯文本剪贴板（需要两端额外开启独立开关）。

### 它不能做什么

- 不能替代 Hinge 的第一次设备配对。两台设备必须先在 Hinge 中互相发现并设为信任设备。
- 不能保证 Android 在被系统彻底杀死后立即下载。Android 必须重新运行 Hinge，或由系统允许的任务触发轮询。
- 不能让局域网传输变成公网实时传输。局域网仍然优先，Cloud Relay 只是离线/异步兜底。
- LAN 传输中断后不保证无缝续传到 Cloud Relay，也不支持远程取消已提交的传输。
- 不能自动替你创建 Cloudflare 账号、R2 bucket 或部署密钥。
- 不能绕过 Android 的后台剪贴板读取限制，也不能在 Hinge 被系统停止时主动唤醒它；云端剪贴板只会在接收端恢复运行并轮询时领取。
- 不能因为导入 GitHub 或压缩包就自动部署到每个人的 Cloudflare。每个用户都必须拥有自己的 Worker、R2 和密钥。

---

## 2. 项目目录说明

文中的“你的项目”指你自己 Fork 或复制到 GitHub 的仓库，不是维护者的本机目录。网页部署时直接在 GitHub 和 Cloudflare 页面操作，不需要在电脑上创建项目文件夹；Hinge Relay 也不需要放进 Hinge 主项目。

---

## 3. 你需要准备什么

1. 一个能使用 Workers 和 R2 的 Cloudflare 账号。
2. 一个 GitHub 账号，用来 Fork 项目并授权 Cloudflare 读取自己的仓库。
3. 两台已在 Hinge 中互相信任、且安装了 Cloud Relay 功能的设备。

以下流程全程使用网页，不需要在电脑上安装命令行工具。首次部署请只填写自己的 Worker 名称、R2 bucket 名称和 Secret，不要同时修改源码。

---

## 4. 第一次部署：网页操作

### 4.1 网页端部署前的准备

Cloudflare 会从你自己的 GitHub 仓库读取源码并自动构建 Worker。整个部署过程都在浏览器中完成；不需要在电脑上安装 Node.js、Git 或 Wrangler。

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

表格中的构建和部署值填写在 Cloudflare 网页表单中，由 Cloudflare 后台执行；你不需要在本机打开终端。如果页面已自动填入默认部署设置且不能编辑，保留默认值即可。

8. 仔细检查仓库、`main` 分支、Root directory 和 Worker 名称后，点击 `Save and Deploy`（或界面上的同义按钮）。这会开始第一次构建和部署。
9. 部署期间不要关闭或删除 Worker。打开 Worker 的 `Deployments` 页面/构建历史，可以看到正在进行的步骤；失败时点开失败的那次构建查看具体日志。
10. 成功后，在 Worker 的概览/设置页找到 `workers.dev` 域名。地址通常类似：

```text
https://hinge-relay-alice.你的子域.workers.dev
```

复制这个根地址，稍后配置 Hinge 时使用；不要在 Hinge 的 Worker 地址栏后面附加 `/v1`。首次部署成功只说明 Cloudflare 接受了构建和部署；下一步还要单独设置 Secret 并完成健康检查、设备注册。

连接完成后，你在 GitHub 网页向 `main` 提交更改会触发 Cloudflare 构建和部署。可在 Worker 的 `Deployments` 查看结果；找不到 GitHub 集成设置时，到 `Settings` → `Builds` 检查仓库连接和生产分支。

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

接下来按第 5 节分别注册 Windows 和 Android。设备注册会实际使用管理员 Secret，并写入 R2 的设备记录；两台设备注册成功后，再按第 6 节发送一个小文件，完成端到端验证。

### 4.8 出错时按现象检查

| 现象 | 优先检查 |
| --- | --- |
| Cloudflare 找不到仓库 | 回到 GitHub 授权页，确认授权了你自己的 Fork；必要时在 Cloudflare GitHub 集成设置中更新仓库访问范围 |
| 构建在部署前失败 | 打开失败构建日志；检查 Root directory 是仓库根目录，且根目录包含 `package.json`、`package-lock.json`、`src`、`wrangler.jsonc` |
| 提示 Worker 名称不匹配 | 比较 Dashboard 中 Worker 名称与 Fork 的 `wrangler.jsonc` → `name`，修正后提交到 `main` 并重新部署 |
| Worker 页面有，但 `/v1/health` 是 404 | 检查是否复制了正确的 `workers.dev` 根地址，以及路径是否为 `/v1/health`；不要误用 Pages 静态站点地址 |

排错时先查看 Cloudflare Worker 的 `Deployments` 中最新一次构建详情和日志。注册和 R2 问题分别见第 7 节与第 4.9 节。

### 4.9 如果网页部署提示缺少 BUCKET

优先回到 GitHub，确认 `wrangler.jsonc` 中同时存在：

```jsonc
"binding": "BUCKET",
"bucket_name": "你创建的bucket名称"
```

先确认 bucket 已经在同一个 Cloudflare 账号中创建，再回到 Worker 的 `Settings` → `Builds` 重新部署（也可以在 `Deployments` 中选择重试失败的构建）。如果 Dashboard 明确提示运行时缺少 R2 binding，才通过 `Settings` → `Bindings` → `Add` → `R2 bucket` 手动检查或添加：变量名填写 `BUCKET`，选择同一个 bucket 并重新部署。

部署配置以你 Fork 中的 `wrangler.jsonc` 为准；避免在 GitHub 和 Dashboard 维护两份互相冲突的 bucket 绑定。

---

## 5. 配置两台 Hinge 设备

先确认两台设备已经在 Hinge 中互相信任。Cloud Relay 不负责首次配对。

请区分下面四项：

| 名称 | 用途 | 是否两台设备相同 |
| --- | --- | --- |
| Worker 地址 | 指向你的 Relay 服务；只填根地址，不带 `/v1/health` | 相同 |
| Relay 加密密钥 | 设备间共享的文件加密密钥；Windows 生成一次，再复制给 Android | 相同；不要手工输入或提交到 GitHub |
| 部署 Token | Cloudflare 的 `RELAY_ADMIN_TOKEN`，只用于设备注册；最少 8 字符，建议密码管理器生成 16+ 个随机字符 | 注册时相同；成功后不长期保存 |
| Device Token | Relay 为设备生成的日常 API 凭据 | 不同，由 Hinge 保存 |

### Windows

在 Hinge **设置 → Cloud Relay** 中填写 Worker 根地址，生成并复制加密密钥，粘贴部署 Token，然后保存并注册设备。注册成功后启用 Cloud Relay。

### Android

填写相同的 Worker 根地址和部署 Token，粘贴 Windows 生成的同一个加密密钥，注册并保存配置，然后启用 Cloud Relay。最后确认 Windows 端也已开启。

部署 Token 只用于注册，Relay 加密密钥用于加解密文件；二者不能互换。Android 注册页不会长期保存部署 Token。

---

## 6. 第一次完整测试

### 如果还想开启剪贴板中转

此功能需要新版 Hinge 客户端和已部署 `/v1/clipboard` API 的 Worker；先在 Cloudflare `Deployments` 确认最新部署成功。然后在两台设备上分别开启 Cloud Relay、剪贴板中转和原有的剪贴板自动同步。

测试时确保两台设备没有可用的 Hinge 局域网连接，在 Windows 复制一段普通文字，并让 Android 上的 Hinge 保持运行，等待最多约 30 秒轮询。剪贴板 Relay 只传加密纯文本（最多 16 KiB），最长保留 1 小时；它不会唤醒已被系统停止的 Hinge，Android 后台剪贴板读取也仍受系统限制。请勿用密码、验证码或密钥测试。

建议先传一个很小的测试文件，例如几百 KB 的文本文件。

### 测试前

- 两台设备已经在 Hinge 中互相信任。
- 两台设备都注册成功。
- 两台设备使用同一个 Worker 地址和 Relay 密钥。
- `/v1/health` 可以访问。
- R2 bucket 是私有的。

### 测试步骤

1. 让两台设备都打开 Hinge，并暂时断开局域网连接或确保 LAN Session 不可用。
2. 在发送端选择接收设备和一个小文件；应看到“已上传云中转 · 等待设备接收”之类的状态。
3. 在接收端打开或恢复 Hinge，等待轮询、下载和解密。
4. Hinge 校验文件大小与 SHA-256 后保存文件，并向 Worker 确认收件。

如果局域网仍然可用，Hinge 会优先使用局域网，你可能看不到 Cloud Relay 状态。这不是失败，而是设计如此。

文件由 Hinge 加密后经 HTTPS 存入私有 R2；接收端轮询下载、解密并校验 SHA-256 后确认收件。Worker 不会读取文件名、文件内容或明文 SHA-256。

---

## 7. 常见问题先看这里

### 手机测试 Worker 超时，或提示“返回非成功状态”

这两种现象要分开判断：

- **连接超时**：手机没有在超时时间内收到 HTTP 响应，优先检查手机当前网络到 Worker 域名的 DNS、VPN/代理、Private DNS 和路由。电脑与手机即使连接同一个 Wi-Fi，也可能走不同的公网出口；例如电脑启用了 VPN/TUN，而手机没有时，电脑能打开并不能证明手机也能访问。可在手机浏览器直接打开 `https://你的-worker域名/v1/health`，并比较手机 VPN 开/关时的结果。
- **返回 HTTP 非成功状态**：说明请求已经到达某个 HTTP 服务，但状态码不是 2xx。Hinge 的“Worker 地址”只填写根地址，例如 `https://hinge-relay-example.workers.dev`；不要附加 `/v1` 或 `/v1/health`。点击“测试 Worker”时，客户端会自动请求 `/v1/health`。如果地址栏已经带 `/v1/health`，客户端会重复拼接成 `/v1/health/v1/health`，通常会得到 404。

如果手机浏览器访问 `/v1/health` 也超时，先排查手机到 Worker 的网络路径；如果浏览器能看到健康检查 JSON、但 Hinge 测试失败，检查 Hinge 中保存的 Worker 地址是否只有根地址。健康检查不使用部署 Token 或 Relay 加密密钥，也不验证管理员 Secret 和 R2 读写；健康检查通过后，注册失败仍需按下面的注册错误说明单独排查。

### Worker 部署后 `/v1/health` 返回 404

确认浏览器使用的是 Worker 的 `workers.dev` 根域名，而不是 Pages 静态站点地址；再到 Cloudflare `Deployments` 检查最新部署是否成功。Hinge 设置的 Worker 地址同样只填根域名，不要附加 `/v1/health`。

### `/v1/health` 正常，但注册设备失败

请先看 Hinge 的完整报错以及 Worker 的 `/v1/health`：

- `503` / `admin_token_not_configured`：当前部署没有可用的 `RELAY_ADMIN_TOKEN`，或它少于 8 个字符。到 Cloudflare `Settings` → `Variables and Secrets` 检查它是 `Secret`，然后点击 `Deploy` 并等待部署成功。
- `401` / `admin_auth_failed`：Hinge 填入的 Token 与当前 Worker 不一致，或 Worker 地址指向了另一份部署。请从密码管理器重新复制原值；Cloudflare 不会在保存后再次显示 Secret。
- 如果仍只看到旧版的 `admin authentication failed`，先查看 Cloudflare `Deployments` 是否已经部署包含此诊断的最新版本；旧版 Worker 会把“Secret 未部署”和“值不匹配”都返回为同一个 401。

在 Cloudflare Dashboard 保存新的 Secret 后，点击 `Deploy` 并等待部署成功，再用新值注册。不要把设备 Token、部署 Token 和 Relay 加密密钥混为一谈；`/v1/health` 不会检查管理员 Secret 或 R2，这是有意的安全边界。

### 注册提示 receiver 未注册

接收设备还没有在同一个 Worker 上注册。必须先分别在两台设备上完成注册，而且两台设备填写的 Worker 地址必须完全相同。

### 文件上传成功，但接收端无法解密

优先检查两台设备的 Relay 加密密钥是否逐字符一致。最常见的原因是两台设备分别点击了“生成密钥”，或者复制时漏掉了开头/结尾字符。

### 明明配置了 Cloud Relay，文件还是走局域网

这是预期行为：Hinge 优先走可用的 LAN Session，只有局域网不可用且 Cloud Relay 配置完整时才会使用中转。

### 文件上传了，但 Android 没有马上收到

Cloud Relay 是异步轮询，不是强制唤醒服务。Android Hinge 被系统完全停止时不会承诺立即下载；打开 Hinge、恢复应用，或等待系统允许的任务触发后再检查。

### 部署时报 R2 binding 错误

在你自己的 GitHub 仓库打开 `wrangler.jsonc`，确认 `binding` 仍为大写 `BUCKET`，`bucket_name` 与当前 Cloudflare 账号中创建的私有 bucket 名称完全一致，然后重新部署。

### ACK 失败后会不会重复下载

如果接收端已经保存文件，但 ACK 因网络问题没有到达，下一次轮询可能再次看到同一条记录。Hinge 会使用 transfer ID 和本地传输记录处理重复情况，但不要手动删除本地文件或 R2 对象来“修复”问题。先恢复网络，再让接收端重新运行。

---

## 8. 安全规则

请遵守以下安全规则：

- R2 bucket 保持私有；不要用公开 `r2.dev` 地址存放文件。
- 不要把管理员 Token、设备 Token、Relay 密钥或本地 `.env` 凭据提交到 GitHub、Issue 或截图中。
- 管理员 Token 泄露后立即在 Cloudflare 轮换并重新注册设备；Relay 密钥泄露后，在两台 Hinge 设备同时更换，旧任务可能无法解密。
- 公开仓库前检查完整 Git 历史，确认从未提交过凭据或个人部署配置。

Relay 不建立 Hinge 云账号；客户端密钥仍由 Hinge 本地设置保存。请保护设备本身并控制本机账户访问。

更完整的安全边界见 [`SECURITY.md`](SECURITY.md)。

---

## 9. 如何更新 Relay 项目

### 网页部署后的自动更新

如果你使用了 Cloudflare Workers Builds：

1. 你在 GitHub 网页向 `main` 提交更改，或者合并上游同步 Pull Request。
2. Cloudflare 会自动开始一次新的构建。
3. 构建成功后，Worker 会自动部署新版本。
4. 可以在 Cloudflare Worker 的 `Deployments` 页面查看构建日志和部署结果。

如果只是想修改部署配置或管理员 Token，不要把它们写进 GitHub。分别在 Cloudflare Dashboard 的 `Settings` → `Variables and Secrets` 或构建设置中修改。

如果暂时不想自动部署，可以在 Worker 的 `Settings` → `Builds` 中断开 GitHub 连接或关闭自动部署。Cloudflare 官方的 Git 集成说明见 [Workers Builds 文档](https://developers.cloudflare.com/workers/ci-cd/builds/)。

### GitHub 上的上游同步

自动同步会在你的 GitHub 仓库中检查上游更新并创建 Pull Request，**不会自动合并或直接部署**，也不会改动 Cloudflare Secret 或替换你的 R2 bucket。先检查变更再决定是否合并。

如果 Fork 仓库的上游不是默认的 `Chengeeker/Hinge-Relay`，在 GitHub 仓库 `Settings` → `Secrets and variables` → `Actions` → `Variables` 中设置：

```text
HINGE_RELAY_UPSTREAM=你的上游仓库，例如 Chengeeker/Hinge-Relay
```

自己的 Worker 名称和 R2 bucket 配置保存在 Fork 的 `wrangler.jsonc` 中。合并更新前，重点检查这个文件、`API_VERSION`、`CONFIG_SCHEMA_VERSION` 和 API 文档是否变化；迁移细节见 [`docs/UPDATE.md`](docs/UPDATE.md)。

---

## 10. 相关文档

- [`docs/API.md`](docs/API.md)：Worker API v1 的端点和认证方式。
- [`docs/UPDATE.md`](docs/UPDATE.md)：上游同步、配置保护和升级边界。
- [`SECURITY.md`](SECURITY.md)：安全边界、密钥和 R2 访问规则。
- [Hinge 主项目](https://github.com/Chengeeker/Hinge)：Windows/Android 客户端。
- [Hinge Cloud Relay 协议](https://github.com/Chengeeker/Hinge/blob/main/protocol/cloud-relay.md)：客户端和 Worker 之间的数据格式。
- [Cloudflare Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/)：GitHub 网页集成和自动部署。
- [Cloudflare R2 创建 bucket](https://developers.cloudflare.com/r2/buckets/create-buckets/)：网页创建私有 R2 bucket。
- [Cloudflare Worker Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)：网页添加 `RELAY_ADMIN_TOKEN`。

本项目是用户自托管软件。部署后的 Cloudflare 费用、配额、域名和账号权限由部署者自己承担和管理，请以 Cloudflare 当前官方文档和控制台显示为准。
