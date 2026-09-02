# 进度追踪：OpenJOC-Browser Phase 0 WASM Stereo 实时播放证明

> 创建时间：2026-09-02 | 状态：报告已完成；等待 Chrome QA

## 目标
在 OpenJOC-Browser 中构建 Chromium Manifest V3 Phase 0 MVP：将本地 raw `.ec3` 输入交给现有 OpenJOC Rust 逻辑编译的 WASM，完成 Stereo 渲染，输出 48 kHz 双声道 Float32 PCM，并由 AudioWorklet 在 Chrome 和 Edge 中实时播放。

## 成功标准
- OpenJOC WASM 使用可复现命令成功构建并运行。
- 浏览器内 raw `.ec3` 通过 OpenJOC WASM 解码，不使用浏览器/操作系统原生 Dolby 解码。
- WASM 与 native OpenJOC Stereo 输出的采样率、声道数、帧数、时长、PCM 样本和诊断元数据一致；PCM 达到逐样本相同或记录有充分依据的等价。
- AudioWorklet 正常播放，启动预缓冲后持续无欠载；支持 Play、Pause、Resume、Stop/Reset、重开和 malformed input 诊断。
- Chrome 与 Edge 的扩展加载、WASM、Worker、AudioWorklet、fixture 解码和队列验证通过；内存有界。
- 不实现 Bilibili、Binaural、Custom SOFA、虚拟 9.1.6、Safari/Firefox；仅新增 Phase 1 Bilibili 架构说明。

## 已读文件
- `C:/Users/chyinan/.codex/attachments/f10a4fdb-a028-4284-94ca-d06a7ded7360/pasted-text.txt` — Phase 0 目标、约束、验收标准和停止条件。
- `C:/Users/chyinan/.agents/skills/focused-problem-solver/SKILL.md` — 本任务的四个检查点和进度维护规则。
- `D:/Programs/OpenJOC/Cargo.toml` — workspace 成员、版本 0.16.0、Rust 2024、MSRV 1.85。
- `D:/Programs/OpenJOC/README.md` — OpenJOC 定位、构建入口和 Rust API/集成边界。
- `D:/Programs/OpenJOC/crates/openjoc-api/Cargo.toml` — headless API 只依赖 OpenJOC 核心 crate，container 为 dev-dependency。
- `D:/Programs/OpenJOC/crates/openjoc-api/src/lib.rs` — `OpenJocSession`、有界 AU packet 输入、Stereo/2.0 配置、owned interleaved f32 输出、drain/reset 和结构化错误。
- `D:/Programs/OpenJOC/crates/openjoc-eac3/src/lib.rs` — E-AC-3 syncframe/AU 索引、分组、JOC carrier 提取/分类和边界常量。
- `D:/Programs/OpenJOC/crates/openjoc-eac3/src/access_unit.rs` — `JocAccessUnitPcmDecoder`、I0/dependent PCM assembly、TDAC 状态和可选阶段计时。
- `D:/Programs/OpenJOC/crates/openjoc-eac3/src/stereo_downmix.rs` — 现有 Auto/LoRo/LtRt Stereo downmix 矩阵。
- `D:/Programs/OpenJOC/crates/openjoc-joc/Cargo.toml` — JOC 核心依赖仅为 bitio、qmf、num-complex、serde。
- `D:/Programs/OpenJOC/crates/openjoc-joc/src/decoder.rs` — JOC payload 解码、ReconstructionBasis 和阶段计时。
- `D:/Programs/OpenJOC/crates/openjoc-joc/src/timeline.rs` — 固定 QMF 延迟的有界重建输出时间线。
- `D:/Programs/OpenJOC/crates/openjoc-render/src/lib.rs` — 独立 `StereoRenderer` 与 OpenJOC API 生产 Stereo 路径的区别。
- `D:/Programs/OpenJOC/crates/openjoc-container/src/lib.rs` — raw/CMAF reader，但包含 filesystem/process/thread，不作为 WASM 核心依赖。
- `D:/Programs/OpenJOC/crates/openjoc-scene/Cargo.toml` — scene/payload 依赖无 FFmpeg，但包含 JSON/layout 相关 API。
- `D:/Programs/OpenJOC/scripts/generate-player-fixtures.sh` — 项目自有 synthetic JOC fixture 生成流程。
- `D:/Programs/OpenJOC/docs/PUBLIC_SMOKE_FIXTURE.md` — 公共 fixture 的生成方式和 SHA-256 记录。
- `D:/Programs/OpenJOC/crates/openjoc-ffmpeg/src/lib.rs` — synthetic JOC fixture exporter 测试入口。
- `D:/Programs/OpenJOC-Browser/PROGRESS-openjoc-browser-phase0-wasm-stereo.md` — 本任务进度和当前约束。

## 当前进度
Phase 0 报告已完成；Edge human audible smoke 已由用户确认 PASS，Chrome machine/audio QA 仍 pending

## 下一步
保留当前两个 focused commits；Chrome 安装后再单独执行 Chrome QA，不自动开始 Bilibili Phase 1。

## 发现的关键信息
- `D:/Programs/OpenJOC` 存在其他任务的 `PROGRESS-*.md` 文件；本任务不读取或修改它们，除非审计发现与本任务直接相关。
- `D:/Programs/OpenJOC-Browser` 是本任务目标仓库；OpenJOC 核心仅允许最小 WASM 集成。
- `D:/Programs/OpenJOC-Browser` 已初始化 Git 仓库，Browser commit 为 `2d5ebb7`（后续报告更新另行提交）。
- OpenJOC `master` HEAD 为 `ad6556babf42566f1a09820b01dc333703c8b1da`，相对 `origin/master` ahead 1，工作树 clean。
- `openjoc-api::OpenJocSession::push_packet` 要求一个完整 JOC access unit；整段 `.ec3` 需要先用已有 syncframe/AU 规则切分。
- API 不重采样且不强制 48 kHz；Phase 0 必须固定并验证 48 kHz fixture。
- OpenJOC tracked fixtures 没有 `.ec3`/`.m4s`；项目提供按需生成的 synthetic `joc.ec3`，其公开记录哈希为 `54b48754b915cef97c13752de5eace4a219da6599cdfcf26f92b5b6fffc6e3e4`。
- `openjoc-capi` 依赖 `openjoc-ffmpeg`，后者含 C build script；WASM bridge 应依赖 `openjoc-api` 而非 C/FFmpeg 路径。
- `wasm32-unknown-unknown` 已安装并通过真实 target build/check。
- 用户确认 `HUMAN_EDGE_AUDIO = PASS`：真实 DEE E-AC-3 JOC `.ec3` 已从物理音频设备播放；Chrome 仍因未安装而 pending。
- 播放电平偏低归因于现有 calibrated/program Dialnorm 行为；Phase 0 不添加任意增益，Calibrated/Unity 选择后续处理。
