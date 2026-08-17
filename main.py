from pathlib import Path
import csv
from datetime import datetime


VIDEO_EXTENSIONS = {".mp4", ".mov", ".mkv", ".avi", ".webm"}


def scan_videos(folder_path):
    """Scan one folder and return video information from oldest to newest."""
    records = []

    for file_path in folder_path.iterdir():
        if file_path.is_file() and file_path.suffix.lower() in VIDEO_EXTENSIONS:
            modified_time = datetime.fromtimestamp(file_path.stat().st_mtime)

            records.append(
                {
                    "filename": file_path.name,
                    "full_path": str(file_path.resolve()),
                    "modified_time": modified_time,
                    "file_size_bytes": file_path.stat().st_size,
                }
            )

    records.sort(key=lambda record: record["modified_time"])
    return records


def write_csv(records, output_path):
    """Write video records to a CSV file."""
    fieldnames = [
        "filename",
        "full_path",
        "modified_time",
        "file_size_bytes",
    ]

    with output_path.open("w", newline="", encoding="utf-8-sig") as csv_file:
        writer = csv.DictWriter(csv_file, fieldnames=fieldnames)
        writer.writeheader()

        for record in records:
            writer.writerow(
                {
                    "filename": record["filename"],
                    "full_path": record["full_path"],
                    "modified_time": record["modified_time"].strftime(
                        "%Y-%m-%d %H:%M:%S"
                    ),
                    "file_size_bytes": record["file_size_bytes"],
                }
            )


def main():
    folder_input = input("请输入游戏录像文件夹路径：").strip()
    folder_path = Path(folder_input)

    if not folder_path.exists():
        print("路径不存在，请检查后重新运行程序。")
        return

    if not folder_path.is_dir():
        print("输入的路径不是文件夹，请检查后重新运行程序。")
        return

    records = scan_videos(folder_path)
    output_path = folder_path / "materials.csv"
    write_csv(records, output_path)

    if not records:
        print("没有找到支持的视频文件，已生成只有表头的 materials.csv。")
        print(f"CSV 文件位置：{output_path.resolve()}")
        return

    print(f"整理完成：发现 {len(records)} 个视频。")
    print(f"CSV 文件已生成：{output_path.resolve()}")


if __name__ == "__main__":
    main()
