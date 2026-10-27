// Runtime Obsidian module is supplied by the host. Individual tests mock its APIs.
export const Platform = { isDesktopApp: true, isMobile: false, isMacOS: true };

export const getLanguage = () => "zh";
// Exercise host adapters against the tests' fetch fixtures without a live Obsidian process.
export async function requestUrl(options: { url: string; method?: string; headers?: Record<string, string>; body?: string }) {
  const response = await fetch(options.url, { ...options, redirect: "error" });
  return { status: response.status, headers: Object.fromEntries(response.headers), arrayBuffer: await response.arrayBuffer() };
}
