// Drive the native picker API through Playwright's file-input transport.
// Purpose IDs and selected File objects still pass through BrowserFiles.
export async function observeFilePicker(page) {
  await page.addInitScript(() => {
    window.filePickerOptions = [];
    window.showOpenFilePicker = options => {
      window.filePickerOptions.push(options);
      const input = document.createElement("input"); input.type = "file"; input.multiple = options.multiple;
      input.accept = (options.types || []).flatMap(type => Object.values(type.accept).flat()).join(",");
      return new Promise((resolve, reject) => {
        input.addEventListener("change", () => resolve([...input.files].map(file => ({ getFile: async () => file }))), { once: true });
        input.addEventListener("cancel", () => reject(new DOMException("cancel", "AbortError")), { once: true });
        input.click();
      });
    };
  });
}
