# AI-Video-Material-Organizer

一个用于整理 AI 视频素材的视频管理工具。

当前版本：V0.3

## Features

- 扫描指定文件夹中的视频文件
- 提取视频基础信息
- 提取视频时长 metadata
- 提取视频分辨率
- 提取视频帧率 FPS
- 提取视频编码格式
- 生成 CSV 素材索引文件
- 实验性功能：根据一个参考视频画面查找本地相似镜头

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

## Experimental Semantic Search

`semantic_search.py` 会从 `materials.csv` 中的每个视频抽取 25%、50%、75%
三个代表画面，再用 OpenCLIP 比较画面特征，返回与参考视频画面最相似的镜头。

安装实验功能依赖：

```bash
pip install -r requirements-semantic-search.txt
```

第一次运行会下载 OpenCLIP 模型权重。

示例：

```powershell
python semantic_search.py `
  --materials-csv "C:\Videos\materials.csv" `
  --reference-filename "reference.mp4" `
  --output-dir "semantic_search_output"
```

程序会生成：

```text
semantic_search_output/
├── frames/
├── semantic_search_results.csv
└── semantic_search_preview.jpg
```

当前限制：

- 只检索 `materials.csv` 已记录的本地视频
- 当前是视觉相似度实验，不等同于精确人脸识别
- 每个视频目前固定抽取三个代表画面
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
- [ ] 智能素材搜索

智能素材搜索目前已完成本地视觉相似度实验验证，尚未作为正式版本功能完成。

---

## Version

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
