# 仓库内容与公开交付

判断一个文件是否公开，要看别人能否用它安装、构建或核验应用。`.gitignore` 用来落实这些选择，不代表被忽略的文件没有价值。

`.gitattributes` 为公开证据固定 LF 换行，让清单中的文件校验值在 Windows 检出后仍保持一致。

## 给使用者

- [安装指南](../README.md)介绍版本选择、安装、升级和日常使用。
- 安装包和免安装 EXE 放到 [GitHub Releases](https://github.com/n1ght-ow/model-observatory/releases) 的附件区，不放进源码目录。
- [发行校验值](evidence/SHA256SUMS-0.3.0.txt)对应 2026-10-29 本地构建的两个 EXE。发布时应上传与校验值完全一致的文件；同版本号重新构建后，不能沿用旧校验值。

## 给开发者

源码、`package.json`、`package-lock.json`、构建配置、`scripts/`、`tests/`、`public/`、`desktop/artwork/` 和技术文档应一起提交。`preview/` 保留经过检查、适合公开的展示图。

在 Windows x64 上准备 Node.js 24 和随附的 npm，在仓库根目录执行：

```powershell
npm ci
npm run desktop:prepare
npm run desktop:dev
```

本机已有构建记录使用 Node.js 24；本次资料整理未另做全新机器构建验收。安装开发依赖及首次获取 Electron 运行时需要网络。`desktop:prepare` 生成静态界面和本机服务，`desktop:dev` 在 Electron 中预览。

生成可分发文件并验收：

```powershell
npm test
npm run lint
npm run desktop:build
npm run test:desktop
npm run test:ui
```

产物位于 `dist/desktop/`。`npm ci` 安装依赖到 `node_modules/`；后续构建生成 `.next/`、`out/`、`dist/`、`next-env.d.ts` 和 `desktop/icon.ico`，图标源文件为已提交的 `public/app.ico`。这些本机副本不需要跟随源码上传。已安装应用自带运行组件，普通用户不需要 Node.js 或这些目录。

## 给核验者

[公开证据索引](evidence/README.md)提供有日期的桌面验收、界面验收和性能对照。公开副本移除本机绝对路径等信息，保留指标、错误、产物哈希及失败边界；清单记录原始文件和公开文件各自的 SHA-256。

`logs/` 保留本地完整运行输出，不直接整目录公开。它包含历史测试副本、截图、调试结果和可能带有本机元数据的文件。需要新增证据时，选择具体文件，检查内容，制作公开副本，更新索引与清单，再提交 `docs/evidence/`。公开报告不等于公开原始历史、会话数据库或全部采样。

## 忽略规则的边界

- 排除可重建的依赖、构建产物、测试输出、性能剖析文件和系统杂项。
- 排除真实 `.env`、私钥及仓库根目录下的个人历史、事件和认证文件；允许提交不含真实凭据的 `.env.example` / `.env.sample` / `.env.template`。
- 保留公开文档、素材、脚本和经过检查的证据。不要通过强制添加绕过规则来上传整份本机运行目录。
- `.gitignore` 不会移除已经被 Git 跟踪的文件，也不能替代提交前的内容检查。
