export const markIcons = {
  circle: '●',
  triangle: '▲',
  square: '■',
  diamond: '◆',
  hexagon: '⬢',
  star: '★',
  heart: '♥',
  flag: '⚑',
};
export const markColors = {
  blue: '#176b88',
  green: '#2f7a5a',
  coral: '#c8553d',
  amber: '#b7791f',
  purple: '#7a4f9a',
  rose: '#b8457a',
  sky: '#3f7fbf',
  graphite: '#4a5560',
};
export const iconNames = {
  circle: '圆',
  triangle: '三角',
  square: '方块',
  diamond: '菱形',
  hexagon: '六边形',
  star: '星',
  heart: '心',
  flag: '旗',
};
export const colorNames = {
  blue: '海图蓝',
  green: '森林绿',
  coral: '珊瑚红',
  amber: '琥珀',
  purple: '梅紫',
  rose: '玫红',
  sky: '天蓝',
  graphite: '石墨',
};
export const defaultMark = (palette = 'forest') => ({
  icon: 'circle',
  color: palette === 'atlas' ? 'blue' : 'green',
});
export const markKey = (mark) => (mark ? mark.icon + ':' + mark.color : 'default');
