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
30 秒，读取缓存后的文字查询约 7 秒。实际速度会因硬件和素材数量而变化。

当前限制：

- 只检索 `materials.csv` 已记录的本地视频
- 当前是视觉相似度实验，不等同于精确人脸识别
- 每个视频目前固定抽取三个代表画面
- 当前 OpenCLIP 模型更适合英文查询，中文查询质量尚未系统验证
- 尚未连接 Pexels、Pixabay 等在线素材网站

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
