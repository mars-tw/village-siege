import { GAMEPLAY_FILM_CLIPS, resolveGameplayFilmClip } from "./gameplayFilmGalleryMetadata";
import "./gameplayFilmGallery.css";

export interface GameplayFilmGalleryControl {
  open(): void;
  close(): void;
  destroy(): void;
  readonly isOpen: boolean;
}

export interface GameplayFilmGalleryHooks {
  opened?(): void;
  closed?(): void;
}

export function createGameplayFilmGallery(host: HTMLElement, hooks: GameplayFilmGalleryHooks = {}): GameplayFilmGalleryControl {
  const dialog = document.createElement("dialog");
  dialog.className = "gameplay-film-gallery";
  dialog.setAttribute("aria-label", "實玩影片");

  const header = document.createElement("header");
  const headingGroup = document.createElement("div");
  const eyebrow = document.createElement("span");
  eyebrow.className = "gameplay-film-gallery__eyebrow";
  eyebrow.textContent = "戰地紀錄";
  const heading = document.createElement("h2");
  heading.textContent = "實玩影片";
  headingGroup.append(eyebrow, heading);
  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "gameplay-film-gallery__close";
  closeButton.textContent = "關閉";
  closeButton.setAttribute("aria-label", "關閉實玩影片");
  header.append(headingGroup, closeButton);

  const chapters = document.createElement("nav");
  chapters.setAttribute("aria-label", "實玩影片章節");
  const chapterButtons = GAMEPLAY_FILM_CLIPS.map((clip, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = clip.title;
    button.addEventListener("click", () => selectClip(index));
    chapters.append(button);
    return button;
  });

  const stage = document.createElement("div");
  stage.className = "gameplay-film-gallery__stage";
  const frame = document.createElement("div");
  frame.className = "gameplay-film-gallery__frame";
  const video = document.createElement("video");
  video.controls = true;
  video.playsInline = true;
  video.preload = "none";
  video.autoplay = false;
  video.loop = false;
  const playButton = document.createElement("button");
  playButton.type = "button";
  playButton.className = "gameplay-film-gallery__play";
  playButton.textContent = "播放影片";
  const message = document.createElement("div");
  message.className = "gameplay-film-gallery__message";
  message.hidden = true;
  const messageText = document.createElement("p");
  const retryButton = document.createElement("button");
  retryButton.type = "button";
  retryButton.textContent = "重試";
  const errorCloseButton = document.createElement("button");
  errorCloseButton.type = "button";
  errorCloseButton.textContent = "關閉";
  message.append(messageText, retryButton, errorCloseButton);
  frame.append(video, playButton, message);

  const details = document.createElement("section");
  details.className = "gameplay-film-gallery__details";
  const clipTitle = document.createElement("h3");
  const clipDescription = document.createElement("p");
  const sourceNote = document.createElement("p");
  sourceNote.className = "gameplay-film-gallery__source";
  sourceNote.textContent = "原始實玩錄影 · 正常進度／讀檔接續";
  const audioLabel = document.createElement("p");
  audioLabel.className = "gameplay-film-gallery__audio";
  details.append(clipTitle, clipDescription, sourceNote, audioLabel);
  stage.append(frame, details);
  dialog.append(header, chapters, stage);
  host.append(dialog);

  let selectedIndex = 0;
  let sourceAttached = false;
  let playGeneration = 0;
  let returnFocus: HTMLElement | null = null;

  function releaseVideo(): void {
    playGeneration++;
    video.pause();
    video.removeAttribute("src");
    sourceAttached = false;
    video.load();
  }

  function renderClip(): void {
    const clip = GAMEPLAY_FILM_CLIPS[selectedIndex]!;
    const urls = resolveGameplayFilmClip(clip);
    video.poster = urls.posterUrl;
    video.setAttribute("aria-label", `${clip.title}實玩錄影`);
    clipTitle.textContent = clip.title;
    clipDescription.textContent = clip.description;
    audioLabel.textContent = clip.audioLabel;
    chapterButtons.forEach((button, index) => button.setAttribute("aria-pressed", String(index === selectedIndex)));
    message.hidden = true;
    playButton.hidden = false;
  }

  function selectClip(index: number): void {
    if (index === selectedIndex && !sourceAttached) return;
    releaseVideo();
    selectedIndex = index;
    renderClip();
  }

  async function playSelected(): Promise<void> {
    const generation = ++playGeneration;
    const clipIndex = selectedIndex;
    message.hidden = true;
    if (!sourceAttached) {
      video.src = resolveGameplayFilmClip(GAMEPLAY_FILM_CLIPS[clipIndex]!).videoUrl;
      sourceAttached = true;
      video.load();
    }
    try {
      await video.play();
      if (generation === playGeneration && dialog.open && clipIndex === selectedIndex) playButton.hidden = true;
    } catch {
      if (generation === playGeneration && dialog.open && sourceAttached && clipIndex === selectedIndex) showError();
    }
  }

  function showError(): void {
    if (!dialog.open || !sourceAttached) return;
    playButton.hidden = true;
    messageText.textContent = navigator.onLine
      ? "影片無法載入。你可以重試或關閉播放器。"
      : "影片需要連線觀看；離線單人戰役仍可遊玩。";
    message.hidden = false;
    retryButton.focus();
  }

  function close(): void {
    if (!dialog.open) return;
    releaseVideo();
    video.removeAttribute("poster");
    dialog.close();
    hooks.closed?.();
    returnFocus?.focus();
    returnFocus = null;
  }

  function open(): void {
    if (dialog.open) return;
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
    renderClip();
    hooks.opened?.();
    closeButton.focus();
  }

  playButton.addEventListener("click", () => void playSelected());
  retryButton.addEventListener("click", () => {
    releaseVideo();
    void playSelected();
  });
  closeButton.addEventListener("click", close);
  errorCloseButton.addEventListener("click", close);
  video.addEventListener("error", () => {
    if (dialog.open && sourceAttached) showError();
  });
  video.addEventListener("play", () => {
    if (!sourceAttached) {
      video.pause();
      void playSelected();
    }
  });
  dialog.addEventListener("cancel", event => {
    event.preventDefault();
    close();
  });
  dialog.addEventListener("keydown", event => event.stopPropagation());
  for (const type of ["pointerdown", "pointerup", "wheel"]) dialog.addEventListener(type, event => event.stopPropagation());

  return {
    open,
    close,
    destroy: () => {
      close();
      releaseVideo();
      dialog.remove();
    },
    get isOpen() { return dialog.open; },
  };
}
