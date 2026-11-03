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

export const markLabel = (mark) => colorNames[mark.color] + iconNames[mark.icon];

export const markPaths = {
  circle: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z',
  triangle: 'M12 3 22 21H2Z',
  square: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z',
  diamond: 'm12 2 10 10-10 10L2 12Z',
  hexagon: 'm12 2 9 5v10l-9 5-9-5V7Z',
  star: 'm12 2 3.1 6.3L22 9.3l-5 4.9 1.2 6.9L12 17.8l-6.2 3.3L7 14.2 2 9.3l6.9-1Z',
  heart: 'M12 21 3.2 12.2A5.6 5.6 0 0 1 12 5.4a5.6 5.6 0 0 1 8.8 6.8Z',
  flag: 'M4 2h2v1c5-3 8 4 15 0v12c-7 4-10-3-15 0v7H4Z',
};
