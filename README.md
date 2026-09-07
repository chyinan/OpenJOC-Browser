# OpenJOC-Browser

[English](#openjoc-browser) · [简体中文](#中文说明)

[![CI](https://github.com/chyinan/OpenJOC-Browser/actions/workflows/ci.yml/badge.svg)](https://github.com/chyinan/OpenJOC-Browser/actions/workflows/ci.yml)
[![Release](https://github.com/chyinan/OpenJOC-Browser/actions/workflows/release.yml/badge.svg)](https://github.com/chyinan/OpenJOC-Browser/actions/workflows/release.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

OpenJOC-Browser brings OpenJOC E-AC-3 JOC decoding to Chromium-based web playback through WebAssembly and Web Audio.

The first public release targets Microsoft Edge and Google Chrome. The primary site integration is standard Bilibili VOD when the current account/session exposes an E-AC-3 JOC representation. A local extension player is also available for project-owned `.ec3` fixtures and development testing.

## Current capabilities

- OpenJOC WASM decoding of E-AC-3 JOC.
- Bilibili standard VOD detection and bounded CMAF range loading.
- Stereo (Speakers) output and Binaural (Headphones) output.
- Fixed Binaural virtual layout: 7.1.4.
- Built-in SADIE II D1 (KU100) HRTF for Binaural mode.
- The Bilibili `<video>` remains the video renderer and master clock.
- Play, pause, seek, buffering, refresh, and single-page media changes are generation-aware.
- Saved renderer, Dialnorm, always-enable, and custom output-gain preferences.
- Diagnostics for JOC profile, sync drift, buffers, underruns, decode timing, and WASM memory.

## How it works

```text
Bilibili page
  -> MAIN-world manifest/media bridge
  -> isolated content controller
  -> MV3 service worker
  -> offscreen AudioContext
  -> bounded CMAF fetch and browser transport parsing
  -> OpenJOC WASM decoder Worker
  -> timestamped AudioWorklet PCM
  -> Web Audio output
```

The browser code handles page integration, media URL policy, ISO-BMFF transport boundaries, lifecycle, and clock alignment. E-AC-3/JOC parsing and rendering remain in OpenJOC. See [the architecture guide](docs/architecture.md).

## Install from a GitHub release

When a GitHub release is available, download `OpenJOC-Browser-v0.1.0-chromium.zip` from its Assets and extract it. The extracted top-level directory is the loadable extension root.

For Microsoft Edge:

1. Open `edge://extensions`.
2. Enable Developer mode.
3. Choose **Load unpacked**.
4. Select the extracted `OpenJOC-Browser-v0.1.0/` directory—the directory containing `manifest.json`.

For Google Chrome, use the same steps at `chrome://extensions`.

The extension is not distributed through the Chrome Web Store or Microsoft Edge Add-ons in this release. To update it, remove or reload the old unpacked directory and load the newly extracted directory. To uninstall, use the browser extension page's **Remove** action.

See [installation](docs/installation.md) for permission details and limitations.

## Use it on Bilibili

1. Open a supported standard Bilibili VOD page.
2. Wait for the OpenJOC panel to report that a JOC stream is detected.
3. Choose **启用 OpenJOC**.
4. Select **Stereo (Speakers)** or **Binaural (Headphones)** under **输出方式**.
5. Select **Calibrated** or **Unity / 兼容模式** under **节目电平**.
6. If needed, open **高级** to inspect diagnostics or change **自定义增益**.

**Calibrated** follows the programme Dialnorm metadata according to OpenJOC semantics. **Unity / 兼容模式** disables Dialnorm attenuation; it is not a volume boost. The custom gain control is separate and ranges from −12 dB to +12 dB in 0.5 dB steps.

OpenJOC takes over only after a non-empty in-band JOC profile and usable PCM are confirmed. If it is disabled or fails, the original Bilibili audio is restored with the latest player mute and volume settings.

See [usage](docs/usage.md) and [diagnostics](docs/diagnostics.md).

## Scope and limitations

The v0.1.0 implementation targets:

- Microsoft Edge and Google Chrome on Chromium's extension platform.
- Standard Bilibili VOD pages.
- 48 kHz, two-channel output and 1.0x playback.
- Unencrypted, browser-fetchable E-AC-3 JOC CMAF representations.

Safari, Firefox, DRM/encrypted representations, other Bilibili player classes, non-1.0x playback, head tracking, custom SOFA selection, and virtual 9.1.6 are not part of this release. Bilibili availability can vary by account, region, content, and session entitlement. A page title or ordinary E-AC-3 label is not treated as proof of JOC; in-band OpenJOC confirmation is required.

This project does not claim parity with a platform Dolby renderer, identical native Dolby/Apple binaural behavior, lossless reproduction of an authored master, or certification/endorsement by Dolby Laboratories.

## Privacy and security

The extension reads the current Bilibili page's media identity, playback manifest candidates, video clock, and player mute/volume state only to operate the current session. It does not send audio, diagnostics, or browsing history to an OpenJOC service. It has no analytics, telemetry, account login, or credential collection. Only playback preferences are stored locally in extension storage.

Media requests go to Bilibili endpoints needed for the selected session. Signed query strings are not persisted in extension storage or included in diagnostics. The exact permissions and data flows are documented in [privacy](docs/privacy.md) and [security](SECURITY.md).

## Build from source

Prerequisites are Git, Node.js 24.15.0, npm, Rust 1.85 or newer, and the `wasm32-unknown-unknown` Rust target. The build resolves OpenJOC from its public repository at an exact commit; an existing sibling checkout is not required.

```powershell
npm ci
npm run check:version
npm run check:release-policy
npm run check:wasm
npm run check
npm test
npm run build
npm run package:release -- --version 0.1.0
npm run validate:release -- --version 0.1.0
```

The generated extension is written to `extension/`. The release ZIP is written to `release/`. See [development](docs/development.md) for the exact toolchain, parity gates, browser QA, and an explicit local-source override.

## Relationship to OpenJOC

This repository consumes the OpenJOC WASM bridge from the public OpenJOC Git repository at commit [`e123aa3a0e2878587c73130585a5606db4ff233f`](https://github.com/chyinan/OpenJOC/commit/e123aa3a0e2878587c73130585a5606db4ff233f). The Browser build checks that the resolved checkout is exactly that commit. OpenJOC remains a separate project and is licensed under Apache-2.0.

## Project documents

- [Installation](docs/installation.md)
- [Usage](docs/usage.md)
- [Architecture](docs/architecture.md)
- [Diagnostics](docs/diagnostics.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Privacy](docs/privacy.md)
- [Development](docs/development.md)
- [Release engineering](docs/release.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)

## License and trademarks

OpenJOC-Browser source is available under the [Apache License 2.0](LICENSE). OpenJOC-Browser is an independent open-source project. “Dolby”, “Dolby Atmos”, and related marks belong to Dolby Laboratories and are used here only to describe compatibility with media formats or workflows; this project is not affiliated with, endorsed by, certified by, or sponsored by Dolby Laboratories.

## 中文说明

OpenJOC-Browser 通过 WebAssembly 和 Web Audio，将 OpenJOC 的 E-AC-3 JOC 解码能力带到基于 Chromium 的网页播放中。

首个公开版本面向 Microsoft Edge 和 Google Chrome。主要的站点集成是标准 Bilibili 视频点播：当当前账号或会话提供 E-AC-3 JOC 表示时，扩展会尝试使用该表示。本地扩展播放器也可用于项目自有的 `.ec3` 固定测试文件和开发测试。

## 当前能力

- 使用 OpenJOC WASM 解码 E-AC-3 JOC；
- 检测标准 Bilibili 视频点播并进行有界 CMAF 范围加载；
- 支持 Stereo（扬声器）和 Binaural（耳机）输出；
- 双耳模式使用固定的 7.1.4 虚拟扬声器布局；
- 双耳模式内置 SADIE II D1（KU100）HRTF；
- Bilibili 的 `<video>` 元素继续负责视频渲染和主时钟；
- 播放、暂停、跳转、缓冲、刷新和单页媒体切换均按播放代际处理；
- 保存渲染器、Dialnorm、始终启用和自定义输出增益偏好；
- 提供 JOC 配置、同步漂移、缓冲区、欠载、解码耗时和 WASM 内存诊断信息。

## 工作原理

```text
Bilibili 页面
  -> MAIN world 清单/媒体桥接
  -> 隔离的 content controller
  -> MV3 service worker
  -> offscreen AudioContext
  -> 有界 CMAF 请求和浏览器传输解析
  -> OpenJOC WASM 解码器 Worker
  -> 带时间戳的 AudioWorklet PCM
  -> Web Audio 输出
```

浏览器代码负责页面集成、媒体 URL 策略、ISO-BMFF 传输边界、生命周期和时钟对齐。E-AC-3/JOC 的解析与渲染仍由 OpenJOC 负责。详见[架构指南](docs/architecture.md)。

## 从 GitHub release 安装

有可用的 GitHub release 时，请从其 Assets 下载 `OpenJOC-Browser-v0.1.0-chromium.zip` 并解压。解压后的顶层目录就是可加载的扩展根目录。

在 Microsoft Edge 中：

1. 打开 `edge://extensions`。
2. 开启“开发人员模式”。
3. 选择 **Load unpacked**。
4. 选择解压后的 `OpenJOC-Browser-v0.1.0/` 目录，也就是包含 `manifest.json` 的目录。

在 Google Chrome 中，在 `chrome://extensions` 执行相同步骤。

此版本不会通过 Chrome Web Store 或 Microsoft Edge Add-ons 分发。更新时，请移除或重新加载旧的未打包目录，再加载新解压的目录。卸载时，请在浏览器扩展页面使用 **Remove** 操作。

权限详情和限制请参阅[安装指南](docs/installation.md)。

## 在 Bilibili 上使用

1. 打开受支持的标准 Bilibili 视频点播页面。
2. 等待 OpenJOC 面板报告检测到 JOC 流。
3. 选择 **启用 OpenJOC**。
4. 在 **输出方式** 下选择 **Stereo (Speakers)** 或 **Binaural (Headphones)**。
5. 在 **节目电平** 下选择 **Calibrated** 或 **Unity / 兼容模式**。
6. 如有需要，打开 **高级** 查看诊断信息或修改 **自定义增益**。

**Calibrated** 按照 OpenJOC 的语义使用节目 Dialnorm 元数据。**Unity / 兼容模式** 会停用 Dialnorm 衰减，但不会提升音量。自定义增益控制独立生效，范围为 −12 dB 至 +12 dB，步进为 0.5 dB。

只有在确认存在非空的带内 JOC 配置并获得可用 PCM 后，OpenJOC 才会接管播放。如果扩展被停用或发生故障，原始 Bilibili 音频会恢复，并沿用播放器最新的静音和音量设置。

详见[使用说明](docs/usage.md)和[诊断指南](docs/diagnostics.md)。

## 范围与限制

v0.1.0 版本面向以下范围：

- Chromium 扩展平台上的 Microsoft Edge 和 Google Chrome；
- 标准 Bilibili 视频点播页面；
- 48 kHz、双声道输出和 1.0 倍速播放；
- 浏览器可以请求、且未加密的 E-AC-3 JOC CMAF 表示。

Safari、Firefox、DRM/加密表示、其他 Bilibili 播放器类型、非 1.0 倍速播放、头部跟踪、自定义 SOFA 选择以及虚拟 9.1.6 不属于此版本。Bilibili 的可用性可能因账号、地区、内容和会话权限而异。页面标题或普通 E-AC-3 标签不能证明存在 JOC，必须经过 OpenJOC 的带内确认。

本项目不声称与平台 Dolby 渲染器具有等价结果，不声称与原生 Dolby/Apple 双耳行为完全一致，不声称能够无损还原创作母版，也不代表 Dolby Laboratories 的认证或认可。

## 隐私与安全

扩展只读取当前 Bilibili 页面的媒体身份、播放清单候选、视频时钟以及播放器静音/音量状态，用于处理当前会话。它不会向 OpenJOC 服务发送音频、诊断信息或浏览历史，也没有分析、遥测、账号登录或凭据收集功能。只有播放偏好会存储在扩展本地存储中。

媒体请求只发送到当前会话所需的 Bilibili 端点。签名查询字符串不会持久化到扩展存储，也不会写入诊断信息。[隐私说明](docs/privacy.md)和[安全策略](SECURITY.md)记录了完整的权限和数据流。

## 从源代码构建

前置条件：Git、Node.js 24.15.0、npm、Rust 1.85 或更高版本，以及 `wasm32-unknown-unknown` Rust 目标。构建会从公开的 OpenJOC 仓库按精确提交解析依赖，不要求本地存在 OpenJOC 的相邻检出目录。

```powershell
npm ci
npm run check:version
npm run check:release-policy
npm run check:wasm
npm run check
npm test
npm run build
npm run package:release -- --version 0.1.0
npm run validate:release -- --version 0.1.0
```

生成的扩展写入 `extension/`，release ZIP 写入 `release/`。确切的工具链、平行性检查、浏览器 QA 和显式的本地源码覆盖方式，请参阅[开发指南](docs/development.md)。

## 与 OpenJOC 的关系

本仓库从公开的 OpenJOC Git 仓库使用提交 [`e123aa3a0e2878587c73130585a5606db4ff233f`](https://github.com/chyinan/OpenJOC/commit/e123aa3a0e2878587c73130585a5606db4ff233f) 中的 OpenJOC WASM bridge。Browser 构建会检查解析出的检出版本是否正好是该提交。OpenJOC 仍是独立项目，采用 Apache-2.0 许可证。

## 项目文档

- [安装指南](docs/installation.md)
- [使用说明](docs/usage.md)
- [架构指南](docs/architecture.md)
- [诊断指南](docs/diagnostics.md)
- [故障排查](docs/troubleshooting.md)
- [隐私说明](docs/privacy.md)
- [开发指南](docs/development.md)
- [发布工程](docs/release.md)
- [第三方声明](THIRD_PARTY_NOTICES.md)

## 许可证与商标

OpenJOC-Browser 源码采用 [Apache License 2.0](LICENSE) 许可证。OpenJOC-Browser 是一个独立的开源项目。“Dolby”“Dolby Atmos”及相关标志归 Dolby Laboratories 所有，本文仅用于描述与相关媒体格式或工作流的兼容性；本项目与 Dolby Laboratories 没有隶属、认可、认证或赞助关系。
