# AI-Video-Material-Organizer

一个用于整理 AI 视频素材的视频管理工具。

当前版本：V0.4 Alpha

## Features

- 扫描指定文件夹中的视频文件
- 提取视频基础信息
- 提取视频时长 metadata
- 提取视频分辨率
- 提取视频帧率 FPS
- 提取视频编码格式
- 生成 CSV 素材索引文件
- 根据一个参考视频画面查找本地相似镜头
- 使用自然语言描述搜索本地视频镜头
- 缓存视频帧和 AI 图像特征，加速后续查询
- 生成搜索结果 CSV 和可视化预览图
- 通过 Pexels MCP 搜索在线视频元信息
- 按已选 Pexels 视频 ID 下载并截取单镜头（实验入口）

支持格式：

- mp4
- mov
- mkv
- avi
- webm

---

## Output

生成：

```
materials.csv
```

包含：

| 字段 | 说明 |
|---|---|
| filename | 文件名 |
| full_path | 完整路径 |
| modified_time | 修改时间 |
| file_size_bytes | 文件大小（bytes） |
| duration | 视频时长（seconds） |
| width | 视频宽度（pixels） |
| height | 视频高度（pixels） |
| fps | 视频帧率 |
| codec | 视频编码格式 |

---

## Installation

创建虚拟环境：

```bash
python -m venv .venv
```

安装依赖：

```bash
pip install moviepy
```

---

## Usage

运行：

```bash
python main.py
```

输入视频文件夹路径：

例如：

```text
C:\Videos
```

程序会生成：

```text
materials.csv
```

---

## Local Semantic Search (V0.4 Alpha)

`semantic_search.py` 会从 `materials.csv` 中的每个视频抽取 25%、50%、75%
三个代表画面，再用 OpenCLIP 建立本地语义索引。

当前支持两种搜索方式：

- 参考视频搜索：使用一个视频的代表画面查找相似镜头
- 文字搜索：使用自然语言描述查找匹配的本地镜头

安装实验功能依赖：

```bash
pip install -r requirements-semantic-search.txt
```

第一次运行会下载 OpenCLIP 模型权重。

### 文字搜索

推荐优先使用英文描述：

```powershell
python semantic_search.py `
  --materials-csv "C:\Videos\materials.csv" `
  --query "lonely man waiting at a bus stop at night" `
  --output-dir "semantic_search_output\text_query"
```

### 可选：过滤近黑帧（仅文字搜索）

`--skip-black-frames` 默认关闭，只有显式添加时才启用；不能与
`--reference-filename` 一起使用。

在项目目录中运行：

```powershell
.\.venv\Scripts\python.exe -B .\semantic_search.py --materials-csv "C:\Videos\materials.csv" --query "heavy rain falling at night, visible raindrops" --skip-black-frames --output-dir ".\semantic_search_output\black_filter_on"
```

过滤复用现有 FFmpeg 的 `blackframe`：像素亮度阈值设为 `8`，
报告的黑像素占比达到 `98%` 时，将该帧排除出本次查询候选。
帧记录和图像特征同步筛选，仅在内存中过滤；不修改原视频、不删除缓存帧，
也不将过滤后的索引写回磁盘。缓存失效时仍按原有规则重建完整索引。

2026-08-31 在 CPU、现有本地模型缓存及 `HF_HUB_OFFLINE=1` 条件下，
使用上述雨景查询对 15 个视频、45 帧进行开关对照：关闭时保留 45 帧；
开启时输出 `black_frames_skipped=4, retained=41`。两次均为 `index=loaded`。
`001_雨桥剑客_AI视频练习作品.mp4` 从第 3 名升至第 1 名，
相似度仍为 `0.216153`。这验证了当前样本中无效黑帧干扰的减少。

限制：这是当前数据、单条查询的验证，不保证识别所有黑底字幕，
也不保证不会误排有效暗画面；它不是雨景检测器，不能保证匹配完整场景条件。
开启后每次查询都需逐帧运行 FFmpeg，额外耗时尚未测量。
下文历史性能数据未启用此开关。

### 参考视频搜索

```powershell
python semantic_search.py `
  --materials-csv "C:\Videos\materials.csv" `
  --reference-filename "reference.mp4" `
  --output-dir "semantic_search_output"
```

程序会生成：

```text
semantic_search_output/
├── index/
│   ├── frames/
│   ├── frame_features.pt
│   └── frame_index.json
└── text_query/
    ├── semantic_search_results.csv
    └── semantic_search_preview.jpg
```

首次运行会建立视频帧和 AI 特征缓存。后续查询会复用缓存；当
`materials.csv` 或源视频发生变化时，缓存会自动失效并重建。

需要手动强制重建时，可增加：

```powershell
--rebuild-index
```

本项目曾使用 15 个视频、45 个代表帧进行 CPU 验证：首次完整查询约
30 秒。读取缓存后的文字查询不是固定耗时：历史测量包括约 7 秒、16 秒和
43 秒。2026-08-31 分阶段复测（每个新进程只执行一次查询）中，默认模式
3 次耗时为 26.96、6.38、5.96 秒；临时设置 `HF_HUB_OFFLINE=1`、使用现有
本地模型缓存的 3 次耗时为 4.85–4.99 秒。当天首测的依赖导入耗时 21.44 秒，
随后的默认模式重复降至 2.75–2.84 秒；缓存索引加载仅约 0.003–0.009 秒。
主要耗时来自 Python 依赖导入和每次进程的 OpenCLIP 模型加载。未清空系统
缓存，因此这些结果不构成严格冷启动基准或固定延迟承诺；历史 16 秒和
43 秒的具体原因仍未确定。

当前限制：

- 只检索 `materials.csv` 已记录的本地视频
- 当前是视觉相似度实验，不等同于精确人脸识别
- 每个视频目前固定抽取三个代表画面
- 当前 OpenCLIP 模型更适合英文查询，中文查询质量尚未系统验证
- 本节本地搜索不检索线上素材；独立 Pexels 元信息搜索和单镜头入口见下节

---


## Pexels 在线搜索与指定素材剪辑（实验入口）

在线元信息搜索复用 `@hanoak/pexels-mcp-server` 1.0.2 和 MCP SDK 1.30.0。
现有 `integrations/pexels_mcp/search_videos.mjs` 仍只搜索，不下载：

```powershell
node .\integrations\pexels_mcp\search_videos.mjs --help
```

新的独立入口接收一个**已由使用者确认**的 Pexels 视频 ID，获取链接后用系统
curl 下载，再用项目已有 FFmpeg 截取。它不判断素材是否符合自然语言需求，
也不分析参考视频模板或拼接多个镜头。

### Windows 手动运行

在项目根目录运行。以下文件夹必须尚不存在；命令仅为示例，不会自动执行：

```powershell
& .\integrations\pexels_mcp\clip_video.ps1 -VideoId 7253197 -StartSeconds 2 -DurationSeconds 5 -OutputDir "C:\Users\NI\Downloads\Project001_single_clip_v01"
```

四项参数必填；帮助无需 Key、无需联网：

```powershell
& .\integrations\pexels_mcp\clip_video.ps1 -Help
```

依赖沿用现有 Node、MCP 安装、Windows curl.exe 和项目 `.venv` 中的
imageio-ffmpeg，缺失时停止，不自动安装。Key 只在本机提示处隐藏输入，
不作为命令参数、不保存到文件；正常或异常退出时清理本次设置的环境变量。
若启动时已有 `PEXELS_API_KEY` 环境变量，入口会拒绝接管，请勿打印或粘贴它。
清理环境变量不等于保证进程内存中的所有字符串都已擦除。

### 格式、输出和失败边界

- 只接受该 ID 返回的 HTTPS Pexels 视频链接；不接受任意 URL，不跟随重定向。
- 选择不低于 1080×1920、9:16 的最小 MP4 版本；没有合适版本即停止。
- 起点向下、时长向上对齐到 25 fps 整帧，调整量各小于一帧；对齐后的区间不得超过下载素材的实际时长。
- 固定输出：1080×1920、25 fps、H.264、yuv420p、无声。
- 每次只处理一条素材；下载上限 100 MiB，连接 15 秒、下载 180 秒；
  MCP 60 秒、元信息读取 30 秒、编码和完整解码各 180 秒超时。不自动重试。
- 输出目录须为绝对路径，父目录已存在且目录本身全新；失败返回非零状态，保留半成品，不覆盖或删除已有文件。
- 输出位于用户指定的仓库外目录，不改本地视频索引、缓存或原始素材。

成功后保存 `source.mp4`、`clip.mp4` 和 `source_metadata.json`。
来源记录包含视频 ID、作者/来源、获取时间、清晰度、请求及实际剪辑参数、
验收结果，不包含 Key。保留来源记录不代表已判断全部使用权利。

### 离线测试与验证状态

```powershell
node --test .\integrations\pexels_mcp\clip_video.test.mjs
```

离线测试默认把产物放系统临时目录，不需要真实 Key 或真实 API；覆盖参数、文件保护、
元信息/链接选择、失败路径、格式及凭证处理边界。

2026-09-03 的项目外原型已由使用者验证真实 MCP 获取链接、下载、
五秒截取与播放。这是原型的证据，**不能代替本入口的本机真实 API 验收**。
安装此入口后，仍需使用者运行一次并确认成片；离线测试通过也不证明
Pexels 服务实时可用、任意素材合适或完整自动剪辑已经实现。

---

## Project Roadmap

- [x] 视频扫描
- [x] CSV 索引生成
- [x] 视频时长提取
- [x] 视频分辨率信息
- [x] 视频帧率信息
- [x] 视频编码格式
- [ ] 视频缩略图生成
- [ ] AI 语义标签
- [x] 本地参考视频相似搜索（Alpha）
- [x] 本地文字语义搜索（Alpha）
- [x] 视频帧与 AI 特征缓存
- [ ] 图形化素材搜索界面

智能素材搜索目前已完成本地命令行 Alpha 验证，尚未作为正式产品功能完成。

---

## Version

### V0.4 Alpha

- 增加自然语言到本地视频镜头的语义搜索
- 保留参考视频画面的相似镜头搜索模式
- 增加视频帧与 OpenCLIP 图像特征缓存
- 素材索引或源视频变化时自动重建缓存
- 增加文字查询预览图和搜索结果 CSV
- 在 CPU 环境完成文字搜索与缓存性能验证

### V0.3

- 增加视频分辨率信息提取
- 增加视频帧率 FPS 提取
- 增加视频编码格式提取
- 将完整视频 metadata 写入 CSV
- 增加独立的本地相似镜头检索实验脚本

### V0.2

- 增加视频 duration 信息提取
- 接入 MoviePy

### V0.1

- 完成基础视频扫描
- 完成 CSV 输出
