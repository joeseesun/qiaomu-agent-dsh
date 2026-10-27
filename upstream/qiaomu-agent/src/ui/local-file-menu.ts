import { Menu, Notice, Platform, type App } from "obsidian";
import { localFileTarget, openLocalFile } from "../services/local-file-links";
import { artifactText as t } from "../i18n/artifacts";

export const revealFileLabel = () => t(Platform.isMacOS ? "finder" : "reveal");

export function openArtifact(app: App, target: string, sourcePath = "", reveal = false): void {
  void openLocalFile(app, target, sourcePath, reveal).catch((error: unknown) => new Notice(error instanceof Error ? error.message : String(error)));
}

export function showLocalFileMenu(app: App, target: string, sourcePath: string, event: MouseEvent): void {
  if (!localFileTarget(app, target, sourcePath)) return;
  const menu = new Menu();
  menu.addItem((item) => item.setTitle(t("open")).setIcon("external-link").onClick(() => openArtifact(app, target, sourcePath)));
  if (Platform.isDesktopApp) menu.addItem((item) => item.setTitle(revealFileLabel()).setIcon("folder-open").onClick(() => openArtifact(app, target, sourcePath, true)));
  menu.showAtMouseEvent(event);
}
