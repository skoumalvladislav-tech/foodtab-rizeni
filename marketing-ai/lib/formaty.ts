/**
 * Výstupní formáty — rozměry, délky, limity a bezpečné zóny NA JEDNOM MÍSTĚ.
 *
 * Hodnoty vycházejí z dlouhodobě platných specifikací Instagramu
 * a Facebooku (poměr 4:5 / 1:1 pro feed, 9:16 pro Story a Reels,
 * 90 s pro Reels přes API). Před ostrým nasazením se ověřují proti
 * aktuální oficiální dokumentaci Meta — z vývojového prostředí to
 * nešlo (síť developers.facebook.com blokuje), viz docs/META_SETUP.md,
 * oddíl „Co ověřit ručně“. Změna se dělá tady, ne v šablonách.
 */
export type FormatKey =
  | "instagram_feed"
  | "instagram_carousel"
  | "instagram_story"
  | "instagram_reel"
  | "facebook_post"
  | "facebook_reel"
  | "video_cover"
  | "thumbnail"
  | "pdf_a4"
  | "pdf_a5";

export type Channel = "instagram" | "facebook" | "print" | "internal";

export interface FormatSpec {
  key: FormatKey;
  channel: Channel;
  /** Formát v databázi (content_variants.format) */
  format: string;
  label: string;
  width: number;
  height: number;
  aspect: string;
  kind: "image" | "video" | "pdf";
  /** Sekundy; jen video */
  maxSeconds?: number;
  minSeconds?: number;
  /** Bezpečná zóna v procentech od okraje, kde nesmí být text */
  safeZone: { top: number; bottom: number; left: number; right: number };
  /** Maximální velikost souboru v MB (orientační) */
  maxFileMb: number;
  captionMaxChars: number;
  hashtagsMax: number;
  /** Která capability publisheru je potřeba */
  publishCapability?: string;
}

export const FORMATY: Record<FormatKey, FormatSpec> = {
  instagram_feed: {
    key: "instagram_feed", channel: "instagram", format: "feed", label: "Instagram příspěvek",
    width: 1080, height: 1350, aspect: "4:5", kind: "image",
    safeZone: { top: 4, bottom: 4, left: 4, right: 4 }, maxFileMb: 8, captionMaxChars: 2200, hashtagsMax: 30,
    publishCapability: "publish.instagram.feed",
  },
  instagram_carousel: {
    key: "instagram_carousel", channel: "instagram", format: "carousel", label: "Instagram carousel",
    width: 1080, height: 1350, aspect: "4:5", kind: "image",
    safeZone: { top: 4, bottom: 4, left: 4, right: 4 }, maxFileMb: 8, captionMaxChars: 2200, hashtagsMax: 30,
    publishCapability: "publish.instagram.carousel",
  },
  instagram_story: {
    key: "instagram_story", channel: "instagram", format: "story", label: "Instagram Story",
    width: 1080, height: 1920, aspect: "9:16", kind: "image",
    // Nahoře profil a nástroje, dole odpověď — text tam Instagram překryje.
    safeZone: { top: 14, bottom: 20, left: 6, right: 6 }, maxFileMb: 8, captionMaxChars: 0, hashtagsMax: 0,
    publishCapability: "publish.instagram.story",
  },
  instagram_reel: {
    key: "instagram_reel", channel: "instagram", format: "reel", label: "Instagram Reel",
    width: 1080, height: 1920, aspect: "9:16", kind: "video", minSeconds: 3, maxSeconds: 90,
    safeZone: { top: 14, bottom: 22, left: 6, right: 12 }, maxFileMb: 250, captionMaxChars: 2200, hashtagsMax: 30,
    publishCapability: "publish.instagram.reel",
  },
  facebook_post: {
    key: "facebook_post", channel: "facebook", format: "page_post", label: "Facebook příspěvek",
    width: 1080, height: 1350, aspect: "4:5", kind: "image",
    safeZone: { top: 4, bottom: 4, left: 4, right: 4 }, maxFileMb: 8, captionMaxChars: 5000, hashtagsMax: 10,
    publishCapability: "publish.facebook.post",
  },
  facebook_reel: {
    key: "facebook_reel", channel: "facebook", format: "reel", label: "Facebook Reel",
    width: 1080, height: 1920, aspect: "9:16", kind: "video", minSeconds: 3, maxSeconds: 90,
    safeZone: { top: 14, bottom: 22, left: 6, right: 12 }, maxFileMb: 250, captionMaxChars: 5000, hashtagsMax: 10,
    publishCapability: "publish.facebook.reel",
  },
  video_cover: {
    key: "video_cover", channel: "internal", format: "cover", label: "Titulní snímek videa",
    width: 1080, height: 1920, aspect: "9:16", kind: "image",
    safeZone: { top: 10, bottom: 10, left: 6, right: 6 }, maxFileMb: 8, captionMaxChars: 0, hashtagsMax: 0,
  },
  thumbnail: {
    key: "thumbnail", channel: "internal", format: "thumbnail", label: "Náhledový obrázek",
    width: 1080, height: 1080, aspect: "1:1", kind: "image",
    safeZone: { top: 4, bottom: 4, left: 4, right: 4 }, maxFileMb: 8, captionMaxChars: 0, hashtagsMax: 0,
  },
  pdf_a4: {
    key: "pdf_a4", channel: "print", format: "pdf_a4", label: "Tisk A4",
    width: 2480, height: 3508, aspect: "A4", kind: "pdf",
    safeZone: { top: 5, bottom: 5, left: 5, right: 5 }, maxFileMb: 20, captionMaxChars: 0, hashtagsMax: 0,
  },
  pdf_a5: {
    key: "pdf_a5", channel: "print", format: "pdf_a5", label: "Tisk A5",
    width: 1748, height: 2480, aspect: "A5", kind: "pdf",
    safeZone: { top: 5, bottom: 5, left: 5, right: 5 }, maxFileMb: 20, captionMaxChars: 0, hashtagsMax: 0,
  },
};

export const VSECHNY_FORMATY = Object.values(FORMATY);

export function formatSpec(key: string): FormatSpec | undefined {
  return (FORMATY as Record<string, FormatSpec>)[key];
}

/** Limity nahrávaných souborů — kontrola v prohlížeči i na serveru. */
export const UPLOAD_LIMITY = {
  imageMaxMb: 25,
  videoMaxMb: 500,
  audioMaxMb: 50,
  documentMaxMb: 30,
  videoMaxSeconds: 600,
  minImageWidth: 720,
  allowedMime: {
    image: ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "image/svg+xml"],
    video: ["video/mp4", "video/quicktime", "video/webm"],
    audio: ["audio/mpeg", "audio/mp4", "audio/wav", "audio/x-wav"],
    document: ["application/pdf"],
  },
} as const;
