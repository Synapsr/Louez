import { getStorageRelativePath } from "./image";

export const MAX_HERO_VIDEO_SIZE = 30 * 1024 * 1024;

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
  "www.youtu.be",
]);

const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

export const getYouTubeVideoId = (value: string): string | null => {
  try {
    const url = new URL(value.trim());
    if (
      !["http:", "https:"].includes(url.protocol) ||
      !YOUTUBE_HOSTS.has(url.hostname.toLowerCase()) ||
      url.username ||
      url.password ||
      url.port
    ) {
      return null;
    }

    const path = url.pathname.split("/").filter(Boolean);
    let videoId: string | null = null;

    if (url.hostname === "youtu.be" || url.hostname === "www.youtu.be") {
      videoId = path[0] ?? null;
    } else if (path[0] === "watch") {
      videoId = url.searchParams.get("v");
    } else if (["embed", "shorts", "live"].includes(path[0] ?? "")) {
      videoId = path[1] ?? null;
    }

    return videoId && YOUTUBE_VIDEO_ID_PATTERN.test(videoId) ? videoId : null;
  } catch {
    return null;
  }
};

export const isValidYouTubeVideoUrl = (value: string): boolean => getYouTubeVideoId(value) !== null;

/** Hero videos must be uploaded MP4 assets in our configured public storage. */
export const isValidHeroVideoUrl = (value: string): boolean => {
  const path = getStorageRelativePath(value);
  return path !== null && /^[a-zA-Z0-9/_-]+\.mp4$/i.test(path);
};

export const isOwnedHeroVideoUrl = (value: string, ownerPrefix: string): boolean => {
  const path = getStorageRelativePath(value);
  if (path === null) return false;
  const prefix = ownerPrefix.replace(/^\/+|\/+$/g, "");
  return path.startsWith(`${prefix}/`) && isValidHeroVideoUrl(value);
};

export const getYouTubeEmbedUrl = (value: string, autoplay: boolean): string | null => {
  const videoId = getYouTubeVideoId(value);
  if (!videoId) return null;

  const embedUrl = new URL(`https://www.youtube-nocookie.com/embed/${videoId}`);
  embedUrl.searchParams.set("autoplay", autoplay ? "1" : "0");
  embedUrl.searchParams.set("cc_load_policy", "0");
  embedUrl.searchParams.set("controls", "0");
  embedUrl.searchParams.set("disablekb", "1");
  embedUrl.searchParams.set("enablejsapi", "1");
  embedUrl.searchParams.set("fs", "0");
  embedUrl.searchParams.set("iv_load_policy", "3");
  embedUrl.searchParams.set("loop", "1");
  embedUrl.searchParams.set("mute", "1");
  embedUrl.searchParams.set("playsinline", "1");
  embedUrl.searchParams.set("playlist", videoId);
  embedUrl.searchParams.set("rel", "0");

  return embedUrl.toString();
};
