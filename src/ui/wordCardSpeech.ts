/**
 * wordCardSpeech — 朗读 for word cards: the word itself and its example
 * sentences.
 *
 * Reuses the reader's ReadAloudController (Web Speech API — the host's
 * speechSynthesis, i.e. free offline system voices): a word card is just a
 * tiny segment list — one segment for the word, one segment per example
 * sentence for 连读例句. The controller owns playback; this module owns the
 * word-card specifics:
 *   - the word speaks in the language of its OWN script (its lookup's
 *     targetLang is the translation side, not the word),
 *   - example sentences are read in display order (per-sense first, then
 *     card-level), original text only — translations stay on the page,
 *   - toggle semantics for the two detail buttons: the running kind again =
 *     stop, the other kind = switch.
 *
 * Voice/rate reuse the reader's `readAloud.voice` / `readAloud.rate` prefs;
 * the controller falls back to any voice matching the word's language prefix
 * when the preferred name does not fit.
 *
 * @module ui/wordCardSpeech
 */

import { getPref } from "../utils/prefs";
import { safeDebug } from "../utils/logger";
import {
  ReadAloudController,
  type ReadAloudSegment,
} from "../core/readAloud/readAloudController";
import type { DictionaryCardContent } from "../core/translation/types";

// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers (exported for tests)
// ─────────────────────────────────────────────────────────────────────────────

export type SpeechKind = "word" | "examples";

/** CJK ideographs anywhere in the word → it reads with a Chinese voice. */
export function isChineseWord(word: string): boolean {
  return /[\u3400-\u9fff\uf900-\ufaff]/.test(word || "");
}

/**
 * BCP-47 language prefix for the word's OWN script (voice selection), by
 * Unicode block: kana → ja, hangul → ko, Han → zh, Cyrillic → ru, Greek → el,
 * Arabic → ar, Devanagari → hi, Thai → th, Hebrew → he. Latin script cannot
 * be attributed to one language from characters alone, so it falls back to
 * "en" — same for any unmatched script.
 */
export function speechLangFor(word: string): string {
  const w = word || "";
  const scripts: Array<[RegExp, string]> = [
    [/[\u3040-\u30ff]/, "ja"], // kana (checked before Han: kana + Han → ja)
    [/[\uac00-\ud7af\u1100-\u11ff]/, "ko"], // hangul
    [/[\u3400-\u9fff\uf900-\ufaff]/, "zh"], // Han ideographs
    [/[\u0400-\u04ff]/, "ru"], // Cyrillic
    [/[\u0370-\u03ff]/, "el"], // Greek
    [/[\u0600-\u06ff\u0750-\u077f]/, "ar"], // Arabic
    [/[\u0900-\u097f]/, "hi"], // Devanagari
    [/[\u0e00-\u0e7f]/, "th"], // Thai
    [/[\u0590-\u05ff]/, "he"], // Hebrew
  ];
  for (const [re, lang] of scripts) {
    if (re.test(w)) return lang;
  }
  return "en";
}

/**
 * Example sentences to read, in display order (per-sense examples first, then
 * card-level pairs), original text only. Empty when the card has none — the
 * caller hides the button.
 */
export function exampleSegments(content: DictionaryCardContent): string[] {
  const out: string[] = [];
  for (const sense of content?.senses ?? []) {
    const text = (sense?.example || "").replace(/\s+/g, " ").trim();
    if (text) out.push(text);
  }
  for (const pair of content?.examples ?? []) {
    const text = (pair?.text || "").replace(/\s+/g, " ").trim();
    if (text) out.push(text);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Speaker
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One speaker per word-cards tab. A fresh ReadAloudController per play (the
 * bilingual view's pattern) because the controller bakes voice/lang/rate in
 * at construction, and the next word may need a different language or the
 * prefs may have changed.
 */
export class WordCardSpeaker {
  private controller: ReadAloudController | null = null;
  private active: SpeechKind | null = null;

  constructor(
    /** The window whose speechSynthesis drives playback. */
    private getWin: () => any | null,
    /** Fired on every playback state change (button label updates). */
    private onChange: () => void,
  ) {}

  isSupported(): boolean {
    try {
      return !!this.getWin()?.speechSynthesis;
    } catch {
      return false;
    }
  }

  /** The kind currently playing, or null when idle. */
  playingKind(): SpeechKind | null {
    return this.active;
  }

  /** Read the word itself. The running kind again stops; never throws. */
  speakWord(word: string): void {
    const clean = (word || "").replace(/\s+/g, " ").trim();
    this.toggle("word", clean, clean ? [clean] : []);
  }

  /** Read the card's example sentences in display order. Never throws. */
  speakExamples(word: string, content: DictionaryCardContent): void {
    this.toggle("examples", word, exampleSegments(content));
  }

  /** Stop playback (second click or tab teardown). Never throws. */
  stop(): void {
    this.active = null;
    try {
      this.controller?.stop();
    } catch {
      /* the controller already logs its own speak/cancel failures */
    }
    this.controller = null;
    this.onChange();
  }

  /**
   * Shared toggle: an empty segment list is a no-op, the running kind stops,
   * anything else (re)starts.
   */
  private toggle(kind: SpeechKind, word: string, texts: string[]): void {
    try {
      if (texts.length === 0 || !this.isSupported()) return;
      if (this.active === kind && this.controller?.getState().playing) {
        this.stop();
        return;
      }
      // Active moves BEFORE the replaced controller stops: its onEnded fires
      // synchronously from stop() and must not clear the new kind (its guard
      // compares against its own captured kind).
      this.active = kind;
      this.controller?.stop();
      const voicePref = String(getPref("readAloud.voice") || "");
      this.controller = new ReadAloudController({
        getWin: this.getWin,
        rate: Number(getPref("readAloud.rate")) || 1,
        lang: speechLangFor(word),
        ...(voicePref ? { voiceName: voicePref } : {}),
        onState: () => this.onChange(),
        onEnded: () => {
          if (this.active === kind) this.active = null;
          this.onChange();
        },
      });
      this.controller.play(
        texts.map((text) => ({ text })) as ReadAloudSegment[],
      );
      this.onChange();
    } catch (e) {
      safeDebug("[文献译读] wordCardSpeech toggle failed: " + e);
      this.active = null;
      this.controller = null;
    }
  }
}
