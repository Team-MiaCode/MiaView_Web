// Correct media-clock drift through a small rate adjustment between seeks.
// Large discontinuities follow the chart clock through an explicit seek.
export function synchronizeVideoClock(video, second, rate, playing) {
  if (video.seeking || video.readyState < 2) return false;
  const target = Math.min(second, Number.isFinite(video.duration) ? video.duration : second);
  const error = target - video.currentTime;
  if (Math.abs(error) > .1) {
    video.currentTime = target;
    video.playbackRate = rate;
    return true;
  }
  const correction = playing && Math.abs(error) > .002 ? Math.max(-.1, Math.min(.1, error * 3)) : 0;
  video.playbackRate = rate + correction;
  return false;
}
