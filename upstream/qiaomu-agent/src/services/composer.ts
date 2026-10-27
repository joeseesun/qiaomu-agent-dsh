export function slashQuery(text: string): string | null {
  const match = /^\/([^\n/]*)$/.exec(text);
  return match ? match[1]!.toLocaleLowerCase() : null;
}
export function startsFileMention(text: string, cursor: number): boolean {
  return /(^|\s)@$/.test(text.slice(0, cursor));
}
