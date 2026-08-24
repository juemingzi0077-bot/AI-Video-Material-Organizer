from moviepy import VideoFileClip


def get_video_info(video_path):
    """
    Read video metadata.

    Returns:
        dict:
        duration
        width
        height
        fps
    """

    clip = VideoFileClip(str(video_path))

    video_info = {
        "duration": clip.duration,
        "width": clip.size[0],
        "height": clip.size[1],
        "fps": clip.fps,
    }

    clip.close()

    return video_info