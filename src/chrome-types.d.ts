declare const chrome: {
  readonly action: {
    readonly onClicked: {
      addListener(listener: () => void): void;
    };
  };
  readonly runtime: {
    getURL(path: string): string;
  };
  readonly tabs: {
    create(options: Readonly<{url: string}>): void;
  };
};
