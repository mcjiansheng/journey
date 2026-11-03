import { markIcons, markColors, markPaths } from './marks.js';
const svgNS = 'http://www.w3.org/2000/svg';

function shape(tag, attributes) {
  const element = document.createElementNS(svgNS, tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  return element;
}

export function createMapMarker(
  place,
  {
    selected = false,
    saved = false,
    arranged = false,
    order = null,
    mark = place.mark,
    label = null,
    labelSide = null,
    count = 1,
    mixed = null,
  } = {},
) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `place-marker${selected ? ' selected-marker' : order !== null ? ' route-marker' : ' favorite-marker'}${arranged ? ' arranged' : ''}`;
  button.setAttribute('aria-label', count > 1 ? count + ' 个收藏：' + place.name : place.name);
  if (mark) button.style.color = markColors[mark.color];
  button.setAttribute('aria-pressed', String(selected));
  const graphic = document.createElement('span');
  graphic.className = 'marker-graphic';
  graphic.setAttribute('aria-hidden', 'true');
  if (selected) {
    const pin = shape('svg', { viewBox: '0 0 32 42', fill: 'none' });
    pin.append(
      shape('path', {
        d: 'M16 40C13 35 2 25 2 16a14 14 0 0 1 28 0c0 9-11 19-14 24Z',
        fill: 'currentColor',
        stroke: '#fffefa',
        'stroke-width': '2',
      }),
    );
    if (saved) {
      const symbol = shape('text', {
        x: 16,
        y: 22,
        fill: '#fffefa',
        'text-anchor': 'middle',
        'font-size': 18,
      });
      symbol.textContent = markIcons[mark?.icon || 'circle'];
      pin.append(symbol);
    } else pin.append(shape('circle', { cx: '16', cy: '16', r: '5', fill: '#fffefa' }));
    graphic.append(pin);
    const label = document.createElement('span');
    label.className = 'marker-label';
    label.textContent =
      [...place.name].slice(0, 8).join('') + ([...place.name].length > 8 ? '…' : '');
    label.setAttribute('aria-hidden', 'true');
    button.append(label);
  } else if (order !== null) {
    graphic.textContent = String(order);
  } else {
    if (mixed) {
      button.classList.add('mixed-marker');
      for (const item of mixed) {
        const icon = shape('svg', { viewBox: '0 0 24 24', 'data-mark-icon': item.icon });
        icon.append(
          shape('path', {
            d: markPaths[item.icon],
            fill: 'currentColor',
            stroke: '#fffefa',
            'stroke-width': 1.2,
            'stroke-linejoin': 'round',
          }),
        );
        icon.style.color = markColors[item.color];
        graphic.append(icon);
      }
    } else {
      const icon = shape('svg', { viewBox: '0 0 24 24', 'data-mark-icon': mark?.icon || 'circle' });
      icon.append(
        shape('path', {
          d: markPaths[mark?.icon || 'circle'],
          fill: 'currentColor',
          stroke: '#fffefa',
          'stroke-width': 1.2,
          'stroke-linejoin': 'round',
        }),
      );
      graphic.append(icon);
    }
  }
  if (count > 1) {
    const badge = document.createElement('span');
    badge.className = 'marker-count';
    badge.textContent = count;
    button.append(badge);
  }
  if (!selected && label && labelSide) {
    const text = document.createElement('span');
    text.className = 'marker-label ' + labelSide;
    text.textContent = [...label].slice(0, 8).join('') + ([...label].length > 8 ? '…' : '');
    button.append(text);
  }

  button.append(graphic);
  return button;
}
