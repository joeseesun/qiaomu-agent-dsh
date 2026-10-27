import { setIcon } from "obsidian";
import { isPrivateHttpUrl } from "../services/network-hosts";
import { connectionText as ct } from "../i18n/connection";

export function renderPrivateHttpNotice(
  parent: HTMLElement,
  getUrl: () => string,
  getAllow: () => boolean,
  setAllow: (allow: boolean) => void,
  onClearError?: () => void
): () => void {
  const notice = parent.createDiv({ cls: "qa-ms-private-http-notice" });
  const update = () => {
    notice.empty();
    const url = getUrl();
    if (!isPrivateHttpUrl(url)) {
      notice.hidden = true;
      return;
    }
    notice.hidden = false;
    const row = notice.createDiv({ cls: "qa-ms-private-http-row" });
    const icon = row.createSpan({ cls: "qa-ms-private-http-icon", attr: { "aria-hidden": "true" } });
    setIcon(icon, "shield-alert");
    const body = row.createDiv({ cls: "qa-ms-private-http-body" });
    body.createDiv({ cls: "qa-ms-private-http-text", text: ct("privateHttpNotice") });
    const label = body.createEl("label", { cls: "qa-ms-private-http-label" });
    const checkbox = label.createEl("input", { type: "checkbox" });
    checkbox.checked = getAllow();
    checkbox.addEventListener("change", () => {
      setAllow(checkbox.checked);
      if (checkbox.checked && onClearError) onClearError();
    });
    label.createSpan({ text: ct("privateHttpAllow") });
  };
  update();
  return update;
}
