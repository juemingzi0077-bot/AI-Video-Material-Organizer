from moviepy import VideoFileClip


video_path = r"C:\Users\NI\Desktop\AI视频\005 最后一班车.mp4"

clip = VideoFileClip(video_path)

print("视频时长:", clip.duration)

clip.close()