export function normalizeActivityUrl(input) {
  let value = input.trim();
  if (!value) return '';
  const domainPort = /^[^\s/:?#]+\.[^\s/:?#]+:\d+(?:[/?#]|$)/u.test(value);
  const scheme = !domainPort && /^[a-z][a-z0-9+.-]*:/i.test(value);
  if (scheme && !/^https?:/i.test(value)) throw new Error('请输入 http 或 https 链接。');
  if (!scheme && !/\s/u.test(value) && value.includes('.')) value = `https://${value}`;
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
  } catch {
    throw new Error('链接格式不对，例如 ehall.nju.edu.cn');
  }
  return value.replace(/^https?:/i, (protocol) => protocol.toLowerCase());
}
