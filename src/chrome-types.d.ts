// pattern: Imperative Shell

type ChromeTab = Readonly<{
  readonly id?: number;
  readonly url?: string;
}>;

type ChromeMessageSender = Readonly<{
  readonly tab?: ChromeTab;
  readonly id?: string;
  readonly documentId?: string;
}>;

type ChromeOffscreenContextQuery = Readonly<{
  readonly contextTypes: ReadonlyArray<'OFFSCREEN_DOCUMENT'>;
  readonly documentUrls: ReadonlyArray<string>;
}>;

declare const chrome: {
  readonly action: {
    readonly onClicked: {
      addListener(listener: (tab: ChromeTab) => void): void;
    };
  };
  readonly runtime: {
    readonly id: string;
    getURL(path: string): string;
    sendMessage(message: unknown): Promise<unknown>;
    readonly onMessage: {
      addListener(listener: (message: unknown, sender: ChromeMessageSender, sendResponse: (response: unknown) => void) => boolean | void): void;
    };
    readonly getContexts?: (options: ChromeOffscreenContextQuery) => Promise<ReadonlyArray<unknown>>;
  };
  readonly storage: {
    readonly local: {
      get(keys?: string | ReadonlyArray<string> | null): Promise<Readonly<Record<string, unknown>>>;
      set(items: Readonly<Record<string, unknown>>): Promise<void>;
    };
  };
  readonly tabs: {
    create(options: Readonly<{url: string}>): void;
    query(options: Readonly<{active: boolean; lastFocusedWindow: boolean}>): Promise<ReadonlyArray<ChromeTab>>;
    sendMessage(tabId: number, message: unknown): Promise<unknown>;
  };
  readonly offscreen: {
    createDocument(options: Readonly<{url: string; reasons: ReadonlyArray<'AUDIO_PLAYBACK'>; justification: string}>): Promise<void>;
    closeDocument(): Promise<void>;
  };
};
