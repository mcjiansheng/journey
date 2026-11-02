export function isDark(theme, systemDark) {
  return theme === 'dark' || ((!theme || theme === 'system') && systemDark);
}
