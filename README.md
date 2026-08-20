# AI-Video-Material-Organizer

一个用于整理 AI 视频素材的视频管理工具。

当前版本：V0.2

## Features

- 扫描指定文件夹中的视频文件
- 提取视频基础信息
- 提取视频时长 metadata
- 生成 CSV 素材索引文件

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
C:\Users\NI\Desktop\AI视频
```

程序会生成：

```text
materials.csv
```

---

## Project Roadmap

- [x] 视频扫描
- [x] CSV 索引生成
- [x] 视频时长提取
- [ ] 视频分辨率信息
- [ ] 视频缩略图生成
- [ ] AI 语义标签
- [ ] 智能素材搜索

---

## Version

### V0.2

- 增加视频 duration 信息提取
- 接入 MoviePy

### V0.1

- 完成基础视频扫描
- 完成 CSV 输出