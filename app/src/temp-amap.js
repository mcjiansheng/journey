// Temporary self-contained AMap 2.0-compatible map engine for frontend preview
// when no real AMap Web JS API key is configured.

const TILE = 256;
const MIN_ZOOM = 3;
const MAX_ZOOM = 19;

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

function mercX(lng) {
  return (lng + 180) / 360;
}

function mercY(lat) {
  const s = Math.sin((clamp(lat, -85, 85) * Math.PI) / 180);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
}

function invX(x) {
  return x * 360 - 180;
}

function invY(y) {
  const n = Math.PI - 2 * Math.PI * y;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

function toLngLatPair(input) {
  if (!input) return null;
  if (Array.isArray(input) && input.length >= 2) {
    const lng = Number(input[0]);
    const lat = Number(input[1]);
    return Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : null;
  }
  const lng = Number(input.getLng?.() ?? input.lng);
  const lat = Number(input.getLat?.() ?? input.lat);
  return Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : null;
}

function haversineMeters(a, b) {
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(s)));
}

const CITIES = [
  {
    name: '杭州',
    full: '杭州市',
    province: '浙江省',
    citycode: '0571',
    adcode: '330100',
    lng: 120.1551,
    lat: 30.2741,
  },
  {
    name: '上海',
    full: '上海市',
    province: '上海市',
    citycode: '021',
    adcode: '310000',
    lng: 121.4737,
    lat: 31.2304,
  },
  {
    name: '北京',
    full: '北京市',
    province: '北京市',
    citycode: '010',
    adcode: '110000',
    lng: 116.3971,
    lat: 39.9165,
  },
  {
    name: '南京',
    full: '南京市',
    province: '江苏省',
    citycode: '025',
    adcode: '320100',
    lng: 118.7969,
    lat: 32.0603,
  },
  {
    name: '苏州',
    full: '苏州市',
    province: '江苏省',
    citycode: '0512',
    adcode: '320500',
    lng: 120.5853,
    lat: 31.299,
  },
  {
    name: '成都',
    full: '成都市',
    province: '四川省',
    citycode: '028',
    adcode: '510100',
    lng: 104.0665,
    lat: 30.5728,
  },
  {
    name: '广州',
    full: '广州市',
    province: '广东省',
    citycode: '020',
    adcode: '440100',
    lng: 113.2644,
    lat: 23.1291,
  },
  {
    name: '深圳',
    full: '深圳市',
    province: '广东省',
    citycode: '0755',
    adcode: '440300',
    lng: 114.0579,
    lat: 22.5431,
  },
  {
    name: '西安',
    full: '西安市',
    province: '陕西省',
    citycode: '029',
    adcode: '610100',
    lng: 108.9398,
    lat: 34.3416,
  },
  {
    name: '厦门',
    full: '厦门市',
    province: '福建省',
    citycode: '0592',
    adcode: '350200',
    lng: 118.0894,
    lat: 24.4798,
  },
  {
    name: '京都',
    full: '京都市',
    province: '京都府',
    citycode: '075',
    adcode: '26100',
    lng: 135.7681,
    lat: 35.0116,
  },
  {
    name: '东京',
    full: '东京都',
    province: '东京都',
    citycode: '03',
    adcode: '13100',
    lng: 139.6917,
    lat: 35.6895,
  },
];

const DEMO_POIS = [
  {
    id: 'TEMP_HZ_01',
    name: '西湖风景名胜区 · 断桥残雪',
    address: '浙江省杭州市西湖区北山街与白堤交汇处',
    district: '西湖区',
    city: '杭州',
    type: '风景名胜;公园广场;景点',
    lng: 120.1506,
    lat: 30.2587,
    tel: '0571-87179617',
    opentime2: '全天开放',
    intro: '西湖十景之一，串联白堤、孤山与北山街的湖畔步行起点，清晨与黄昏最适合漫步。',
  },
  {
    id: 'TEMP_HZ_02',
    name: '灵隐寺',
    address: '浙江省杭州市西湖区灵隐路法云弄1号',
    district: '西湖区',
    city: '杭州',
    type: '风景名胜;寺庙道观;历史文化',
    lng: 120.1014,
    lat: 30.2408,
    tel: '0571-87968665',
    opentime2: '07:00 - 18:15',
    intro: '飞来峰山麓千年古刹，周边林木幽静，可连游永福寺与韬光寺。',
  },
  {
    id: 'TEMP_HZ_03',
    name: '知味观 · 味庄（杨公堤店）',
    address: '浙江省杭州市西湖区杨公堤10-12号',
    district: '西湖区',
    city: '杭州',
    type: '餐饮服务;中餐厅;杭帮菜',
    lng: 120.1369,
    lat: 30.2336,
    tel: '0571-87970568',
    opentime2: '10:30 - 14:00, 16:30 - 20:30',
    intro: '临水而建的经典杭帮菜馆，东坡肉、西湖醋鱼、龙井虾仁与桂花藕粉口碑稳定。',
  },
  {
    id: 'TEMP_HZ_04',
    name: '龙井村茶园',
    address: '浙江省杭州市西湖区龙井路龙井村1号',
    district: '西湖区',
    city: '杭州',
    type: '风景名胜;乡村旅游;茶园景点',
    lng: 120.1112,
    lat: 30.2194,
    tel: '',
    opentime2: '全天开放',
    intro: '西湖龙井核心产区，可沿十里琅珰山脊步道茶田远眺西湖群山。',
  },
  {
    id: 'TEMP_HZ_05',
    name: '法喜寺（上天竺）',
    address: '浙江省杭州市西湖区天竺路338号',
    district: '西湖区',
    city: '杭州',
    type: '风景名胜;寺庙道观;景点',
    lng: 120.0956,
    lat: 30.2177,
    tel: '0571-87989320',
    opentime2: '06:30 - 18:00',
    intro: '白墙黛瓦隐于天竺山谷中，寺内斋饭清淡可口，高处观景台视野极佳。',
  },
  {
    id: 'TEMP_HZ_06',
    name: '河坊街历史文化街区',
    address: '浙江省杭州市上城区河坊街180号',
    district: '上城区',
    city: '杭州',
    type: '风景名胜;历史街区;文化',
    lng: 120.1714,
    lat: 30.2414,
    tel: '',
    opentime2: '09:00 - 22:00',
    intro: '南宋御街旁的老字号步行街，夜晚灯笼亮起时很有烟火气，可逛胡庆余堂。',
  },
  {
    id: 'TEMP_HZ_07',
    name: '小河直街历史街区',
    address: '浙江省杭州市拱墅区小河直街1号',
    district: '拱墅区',
    city: '杭州',
    type: '风景名胜;文化艺术;咖啡茶馆',
    lng: 120.1362,
    lat: 30.3125,
    tel: '',
    opentime2: '全天开放',
    intro: '京杭大运河畔静谧水乡老街，聚集了独立咖啡店、茶室与手工买手店。',
  },
  {
    id: 'TEMP_HZ_08',
    name: '杭州西湖国宾馆',
    address: '浙江省杭州市西湖区杨公堤18号',
    district: '西湖区',
    city: '杭州',
    type: '住宿服务;酒店;园林度假酒店',
    lng: 120.1328,
    lat: 30.2398,
    tel: '0571-87979889',
    opentime2: '24小时营业',
    intro: '三面临湖的私密园林酒店，步行可达曲院风荷与苏堤春晓。',
  },
  {
    id: 'TEMP_HZ_09',
    name: '杭州东站',
    address: '浙江省杭州市上城区天城路1号',
    district: '上城区',
    city: '杭州',
    type: '交通设施;火车站;交通枢纽',
    lng: 120.213,
    lat: 30.291,
    tel: '0571-12306',
    opentime2: '24小时运营',
    intro: '杭州主要高铁枢纽，地铁1号线、4号线、6号线及19号线直达市中心与西湖。',
  },
  {
    id: 'TEMP_HZ_10',
    name: '湖滨银泰 in77 · 咖啡小憩',
    address: '浙江省杭州市上城区延安路258号',
    district: '上城区',
    city: '杭州',
    type: '餐饮服务;咖啡茶室;商圈',
    lng: 120.1636,
    lat: 30.2546,
    tel: '0571-85871177',
    opentime2: '10:00 - 22:00',
    intro: '紧邻西湖音乐喷泉，适合行程间隙喝杯手冲咖啡并休整补充装备。',
  },
  {
    id: 'TEMP_HZ_11',
    name: '中国茶叶博物馆（双峰馆区）',
    address: '浙江省杭州市西湖区龙井路88号',
    district: '西湖区',
    city: '杭州',
    type: '风景名胜;博物馆;文化',
    lng: 120.1235,
    lat: 30.2286,
    tel: '0571-87964221',
    opentime2: '09:00 - 16:30（周一闭馆）',
    intro: '藏在茶山溪水间的园林博物馆，详细展示绿茶发酵与宋代点茶文化。',
  },
  {
    id: 'TEMP_SH_01',
    name: '外滩万国建筑博览群',
    address: '上海市黄浦区中山东一路',
    district: '黄浦区',
    city: '上海',
    type: '风景名胜;历史街区;景点',
    lng: 121.4903,
    lat: 31.2335,
    tel: '',
    opentime2: '全天开放',
    intro: '黄浦江西岸经典天际线步行长廊。',
  },
  {
    id: 'TEMP_BJ_01',
    name: '故宫博物院',
    address: '北京市东城区景山前街4号',
    district: '东城区',
    city: '北京',
    type: '风景名胜;博物馆;景点',
    lng: 116.397,
    lat: 39.918,
    tel: '400-950-1925',
    opentime2: '08:30 - 17:00',
    intro: '明清皇家宫殿建筑群。',
  },
];

// West Lake stylized polygon for Hangzhou backdrop
const WEST_LAKE_POLY = [
  [120.132, 30.257],
  [120.145, 30.261],
  [120.157, 30.259],
  [120.161, 30.249],
  [120.158, 30.237],
  [120.149, 30.232],
  [120.137, 30.234],
  [120.131, 30.243],
  [120.132, 30.257],
];

const QIANTANG_RIVER_POLY = [
  [120.08, 30.182],
  [120.14, 30.197],
  [120.19, 30.214],
  [120.23, 30.243],
  [120.27, 30.275],
];

class Pixel {
  constructor(x, y) {
    this.x = Number(x) || 0;
    this.y = Number(y) || 0;
  }
  getX() {
    return this.x;
  }
  getY() {
    return this.y;
  }
}

class LngLat {
  constructor(lng, lat) {
    this.lng = Number(lng);
    this.lat = Number(lat);
  }
  getLng() {
    return this.lng;
  }
  getLat() {
    return this.lat;
  }
}

class Bounds {
  constructor(sw, ne) {
    const p1 = toLngLatPair(sw) || [0, 0];
    const p2 = toLngLatPair(ne) || p1;
    this.sw = new LngLat(Math.min(p1[0], p2[0]), Math.min(p1[1], p2[1]));
    this.ne = new LngLat(Math.max(p1[0], p2[0]), Math.max(p1[1], p2[1]));
  }
  getSouthWest() {
    return this.sw;
  }
  getNorthEast() {
    return this.ne;
  }
  getCenter() {
    return new LngLat((this.sw.lng + this.ne.lng) / 2, (this.sw.lat + this.ne.lat) / 2);
  }
}

function makeEmitter() {
  const listeners = new Map();
  return {
    on(event, fn) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(fn);
      return this;
    },
    off(event, fn) {
      listeners.get(event)?.delete(fn);
      return this;
    },
    emit(event, payload) {
      for (const fn of listeners.get(event) || []) {
        try {
          fn(payload);
        } catch {
          // Keep other listeners running
        }
      }
    },
    clear() {
      listeners.clear();
    },
  };
}

class Marker {
  constructor(options = {}) {
    this._emitter = makeEmitter();
    this._position = toLngLatPair(options.position) || [120.1551, 30.2741];
    this._content = options.content || null;
    this._offset =
      options.offset instanceof Pixel
        ? options.offset
        : new Pixel(options.offset?.[0] || 0, options.offset?.[1] || 0);
    this._zIndex = options.zIndex ?? 10;
    this._el = null;
  }
  on(event, fn) {
    this._emitter.on(event, fn);
    return this;
  }
  off(event, fn) {
    this._emitter.off(event, fn);
    return this;
  }
  getPosition() {
    return new LngLat(this._position[0], this._position[1]);
  }
  setPosition(pos) {
    const p = toLngLatPair(pos);
    if (p) this._position = p;
  }
}

class LabelMarker {
  constructor(options = {}) {
    this._position = toLngLatPair(options.position) || [120.1551, 30.2741];
    this._rank = options.rank ?? 10;
    this._text = options.text || {};
  }
  getPosition() {
    return new LngLat(this._position[0], this._position[1]);
  }
}

class LabelsLayer {
  constructor(options = {}) {
    this._options = options;
    this._markers = [];
  }
  add(items) {
    const list = Array.isArray(items) ? items : [items];
    for (const item of list) {
      if (item && !this._markers.includes(item)) this._markers.push(item);
    }
  }
  remove(items) {
    const list = Array.isArray(items) ? items : [items];
    this._markers = this._markers.filter((m) => !list.includes(m));
  }
}

class Polyline {
  constructor(options = {}) {
    this._path = (options.path || []).map(toLngLatPair).filter(Boolean);
    this._strokeColor = options.strokeColor || '#18786b';
    this._strokeWeight = options.strokeWeight || 4;
    this._strokeOpacity = options.strokeOpacity ?? 0.85;
    this._showDir = Boolean(options.showDir);
  }
  getPath() {
    return this._path.map(([lng, lat]) => new LngLat(lng, lat));
  }
}

class Scale {
  constructor(options = {}) {
    this._options = options;
    this._el = null;
  }
}

class TempMap {
  constructor(container, options = {}) {
    this._container = typeof container === 'string' ? document.querySelector(container) : container;
    const center = toLngLatPair(options.center) || [120.1551, 30.2741];
    this._center = [clamp(center[0], -180, 180), clamp(center[1], -85, 85)];
    this._zoom = clamp(Number(options.zoom) || 12, MIN_ZOOM, MAX_ZOOM);
    this._emitter = makeEmitter();
    this._overlays = new Set();
    this._controls = [];
    this._animFrame = 0;
    this._destroyed = false;
    this._resizeObserver = null;
    this._dragging = false;
    this._movedDuringDrag = false;
    this._dragStart = null;

    this._mount();
    queueMicrotask(() => {
      if (!this._destroyed) this._emitter.emit('complete');
    });
  }

  _mount() {
    if (!this._container) return;
    this._container.innerHTML = '';

    const root = document.createElement('div');
    root.className = 'temp-amap-root';
    root.setAttribute('data-temp-map', 'true');

    const svgBackdrop = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svgBackdrop.setAttribute('class', 'temp-amap-backdrop');
    svgBackdrop.setAttribute('aria-hidden', 'true');

    const svgLines = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svgLines.setAttribute('class', 'temp-amap-lines');
    svgLines.setAttribute('aria-hidden', 'true');

    const hotspotLayer = document.createElement('div');
    hotspotLayer.className = 'temp-amap-hotspots';

    const markerLayer = document.createElement('div');
    markerLayer.className = 'temp-amap-markers';

    const labelLayer = document.createElement('div');
    labelLayer.className = 'temp-amap-labels';

    const badge = document.createElement('div');
    badge.className = 'temp-amap-badge';
    badge.innerHTML =
      '<span class="temp-amap-badge-full">临时交互地图 · 未配置高德 Key（前端预览模式）</span><span class="temp-amap-badge-compact">预览地图 · 未配高德 Key</span>';

    root.append(svgBackdrop, svgLines, hotspotLayer, markerLayer, labelLayer, badge);
    this._container.append(root);

    this._root = root;
    this._svgBackdrop = svgBackdrop;
    this._svgLines = svgLines;
    this._hotspotLayer = hotspotLayer;
    this._markerLayer = markerLayer;
    this._labelLayer = labelLayer;

    this._bindInteractions();
    if (typeof ResizeObserver === 'function') {
      this._resizeObserver = new ResizeObserver(() => this._render());
      this._resizeObserver.observe(root);
    }
    this._render();
  }

  _bindInteractions() {
    const root = this._root;
    if (!root) return;

    const onPointerDown = (e) => {
      if (e.button !== 0) return;
      if (e.target.closest('.place-marker, .temp-amap-hotspot, .amap-scalecontrol')) return;
      this.stopMove();
      this._dragging = true;
      this._movedDuringDrag = false;
      this._dragStart = {
        x: e.clientX,
        y: e.clientY,
        worldCenter: this._centerWorldPixel(),
      };
      root.classList.add('is-dragging');
      root.setPointerCapture?.(e.pointerId);
    };

    const onPointerMove = (e) => {
      if (!this._dragging || !this._dragStart) return;
      const dx = e.clientX - this._dragStart.x;
      const dy = e.clientY - this._dragStart.y;
      if (!this._movedDuringDrag && Math.hypot(dx, dy) > 4) {
        this._movedDuringDrag = true;
        this._emitter.emit('dragstart');
      }
      if (!this._movedDuringDrag) return;
      const world = TILE * 2 ** this._zoom;
      const nx = this._dragStart.worldCenter.x - dx;
      const ny = clamp(this._dragStart.worldCenter.y - dy, 0, world);
      this._center = [invX(nx / world), clamp(invY(ny / world), -85, 85)];
      this._render();
    };

    const finishDrag = (e, cancelled = false) => {
      if (!this._dragging) return;
      this._dragging = false;
      root.classList.remove('is-dragging');
      if (this._movedDuringDrag) {
        this._emitter.emit('moveend');
      } else if (!cancelled && e) {
        const rect = root.getBoundingClientRect();
        const px = e.clientX - rect.left;
        const py = e.clientY - rect.top;
        const lnglat = this._containerToLngLat(px, py);
        this._emitter.emit('click', {
          lnglat,
          pixel: new Pixel(px, py),
        });
      }
      this._dragStart = null;
      this._movedDuringDrag = false;
    };

    const onWheel = (e) => {
      e.preventDefault();
      this.stopMove();
      this._emitter.emit('zoomstart');
      const rect = root.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const anchor = this._containerToLngLat(cx, cy);
      const step = e.deltaY < 0 ? 0.65 : -0.65;
      const nextZoom = clamp(Number((this._zoom + step).toFixed(2)), MIN_ZOOM, MAX_ZOOM);
      if (nextZoom === this._zoom) return;
      this._zoom = nextZoom;
      // Keep cursor point anchored when zooming
      const world = TILE * 2 ** this._zoom;
      const w = rect.width || 1;
      const h = rect.height || 1;
      const ax = mercX(anchor.lng) * world;
      const ay = mercY(anchor.lat) * world;
      const newCenterWx = ax - (cx - w / 2);
      const newCenterWy = clamp(ay - (cy - h / 2), 0, world);
      this._center = [invX(newCenterWx / world), clamp(invY(newCenterWy / world), -85, 85)];
      this._render();
      this._emitter.emit('zoomend');
      this._emitter.emit('moveend');
    };

    root.addEventListener('pointerdown', onPointerDown);
    root.addEventListener('pointermove', onPointerMove);
    root.addEventListener('pointerup', (e) => finishDrag(e, false));
    root.addEventListener('pointercancel', (e) => finishDrag(e, true));
    root.addEventListener('wheel', onWheel, { passive: false });
  }

  _size() {
    const rect = this._root?.getBoundingClientRect();
    return {
      w: rect?.width > 0 ? rect.width : this._container?.clientWidth || 1000,
      h: rect?.height > 0 ? rect.height : this._container?.clientHeight || 720,
    };
  }

  _centerWorldPixel(zoom = this._zoom) {
    const world = TILE * 2 ** zoom;
    return new Pixel(mercX(this._center[0]) * world, mercY(this._center[1]) * world);
  }

  _containerToLngLat(px, py) {
    const { w, h } = this._size();
    const world = TILE * 2 ** this._zoom;
    const center = this._centerWorldPixel();
    const wx = center.x + (px - w / 2);
    const wy = clamp(center.y + (py - h / 2), 0, world);
    return new LngLat(invX(wx / world), clamp(invY(wy / world), -85, 85));
  }

  lngLatToPixel(pos, zoom = this._zoom) {
    const p = toLngLatPair(pos);
    if (!p) return new Pixel(0, 0);
    const world = TILE * 2 ** zoom;
    return new Pixel(mercX(p[0]) * world, mercY(p[1]) * world);
  }

  pixelToLngLat(pixel, zoom = this._zoom) {
    const world = TILE * 2 ** zoom;
    const x = pixel?.getX?.() ?? pixel?.x ?? 0;
    const y = clamp(pixel?.getY?.() ?? pixel?.y ?? 0, 0, world);
    return new LngLat(invX(x / world), clamp(invY(y / world), -85, 85));
  }

  lngLatToContainer(pos) {
    const p = toLngLatPair(pos);
    if (!p) return new Pixel(0, 0);
    const { w, h } = this._size();
    const pt = this.lngLatToPixel(p, this._zoom);
    const c = this._centerWorldPixel(this._zoom);
    return new Pixel(pt.x - c.x + w / 2, pt.y - c.y + h / 2);
  }

  on(event, fn) {
    this._emitter.on(event, fn);
    return this;
  }

  off(event, fn) {
    this._emitter.off(event, fn);
    return this;
  }

  getCenter() {
    return new LngLat(this._center[0], this._center[1]);
  }

  getZoom() {
    return this._zoom;
  }

  setZoom(zoom, immediate = true) {
    const next = clamp(Number(zoom), MIN_ZOOM, MAX_ZOOM);
    if (!Number.isFinite(next)) return;
    this.setZoomAndCenter(next, this._center, immediate, 240);
  }

  zoomIn() {
    this._emitter.emit('zoomstart');
    this.setZoom(Math.min(MAX_ZOOM, Math.round(this._zoom) + 1), false);
  }

  zoomOut() {
    this._emitter.emit('zoomstart');
    this.setZoom(Math.max(MIN_ZOOM, Math.round(this._zoom) - 1), false);
  }

  setCenter(center, immediate = true) {
    const next = toLngLatPair(center);
    if (!next) return;
    this.setZoomAndCenter(this._zoom, next, immediate, 240);
  }

  stopMove() {
    if (this._animFrame) {
      cancelAnimationFrame(this._animFrame);
      this._animFrame = 0;
    }
  }

  setZoomAndCenter(zoom, center, immediate = false, duration = 320) {
    const targetZoom = clamp(Number(zoom) || this._zoom, MIN_ZOOM, MAX_ZOOM);
    const targetCenter = toLngLatPair(center) || this._center;
    this.stopMove();
    if (immediate || duration <= 0 || typeof requestAnimationFrame !== 'function') {
      this._zoom = targetZoom;
      this._center = targetCenter;
      this._render();
      this._emitter.emit('zoomend');
      this._emitter.emit('moveend');
      return;
    }
    const startZoom = this._zoom;
    const startCenter = [...this._center];
    const started = performance.now();
    const step = (now) => {
      if (this._destroyed) return;
      const t = clamp((now - started) / duration, 0, 1);
      const ease = 1 - (1 - t) ** 3;
      this._zoom = startZoom + (targetZoom - startZoom) * ease;
      this._center = [
        startCenter[0] + (targetCenter[0] - startCenter[0]) * ease,
        startCenter[1] + (targetCenter[1] - startCenter[1]) * ease,
      ];
      this._render();
      if (t < 1) {
        this._animFrame = requestAnimationFrame(step);
      } else {
        this._animFrame = 0;
        this._emitter.emit('zoomend');
        this._emitter.emit('moveend');
      }
    };
    this._animFrame = requestAnimationFrame(step);
  }

  setBounds(bounds, immediate = false, avoid = [60, 60, 60, 60], maxZoom = 18) {
    if (!bounds) return;
    const sw = bounds.getSouthWest?.();
    const ne = bounds.getNorthEast?.();
    if (!sw || !ne) return;
    const { w, h } = this._size();
    const [top = 60, right = 60, bottom = 60, left = 60] = Array.isArray(avoid)
      ? avoid
      : [60, 60, 60, 60];
    const boxW = Math.max(80, w - left - right);
    const boxH = Math.max(80, h - top - bottom);
    const x0 = mercX(sw.lng);
    const x1 = mercX(ne.lng);
    const y0 = mercY(ne.lat);
    const y1 = mercY(sw.lat);
    let zoom = Math.min(maxZoom, 15);
    if (x1 > x0 || y1 > y0) {
      const fx = x1 > x0 ? boxW / ((x1 - x0) * TILE) : Infinity;
      const fy = y1 > y0 ? boxH / ((y1 - y0) * TILE) : Infinity;
      zoom = clamp(Math.floor(Math.log2(Math.min(fx, fy)) * 10) / 10, MIN_ZOOM, maxZoom);
    }
    const world = TILE * 2 ** zoom;
    const boxCenterOffsetX = left + boxW / 2 - w / 2;
    const boxCenterOffsetY = top + boxH / 2 - h / 2;
    const cxWorld = ((x0 + x1) / 2) * world - boxCenterOffsetX;
    const cyWorld = clamp(((y0 + y1) / 2) * world - boxCenterOffsetY, 0, world);
    this.setZoomAndCenter(
      zoom,
      [invX(cxWorld / world), clamp(invY(cyWorld / world), -85, 85)],
      immediate,
      320,
    );
  }

  setFitView(overlays = [], immediate = false, avoid = [60, 60, 60, 60], maxZoom = 15) {
    const pts = [];
    for (const item of overlays || []) {
      if (item instanceof Marker) pts.push(item._position);
      else if (item instanceof Polyline) pts.push(...item._path);
    }
    if (!pts.length) return;
    if (pts.length === 1) {
      const { w, h } = this._size();
      const [top = 60, right = 60, bottom = 60, left = 60] = Array.isArray(avoid)
        ? avoid
        : [60, 60, 60, 60];
      const boxW = Math.max(80, w - left - right);
      const boxH = Math.max(80, h - top - bottom);
      const zoom = Math.min(maxZoom, 15);
      const world = TILE * 2 ** zoom;
      const pt = this.lngLatToPixel(pts[0], zoom);
      const ox = left + boxW / 2 - w / 2;
      const oy = top + boxH / 2 - h / 2;
      const target = this.pixelToLngLat(new Pixel(pt.x - ox, pt.y - oy), zoom);
      this.setZoomAndCenter(zoom, target, immediate, 320);
      return;
    }
    const lngs = pts.map((p) => p[0]);
    const lats = pts.map((p) => p[1]);
    this.setBounds(
      new Bounds([Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]),
      immediate,
      avoid,
      maxZoom,
    );
  }

  getCity(cb) {
    let best = CITIES[0];
    let bestDist = Infinity;
    for (const city of CITIES) {
      const d = haversineMeters(this._center, [city.lng, city.lat]);
      if (d < bestDist) {
        bestDist = d;
        best = city;
      }
    }
    cb?.({
      province: best.province,
      city: best.full,
      citycode: best.citycode,
      district: best.name + '市区',
    });
  }

  add(items) {
    const list = Array.isArray(items) ? items : [items];
    for (const item of list) {
      if (item) this._overlays.add(item);
    }
    this._renderOverlays();
  }

  remove(items) {
    const list = Array.isArray(items) ? items : [items];
    for (const item of list) {
      this._overlays.delete(item);
    }
    this._renderOverlays();
  }

  addControl(control) {
    if (!control || this._controls.includes(control)) return;
    this._controls.push(control);
    if (control instanceof Scale && this._root) {
      const el = document.createElement('div');
      el.className = 'amap-scalecontrol temp-amap-scale';
      const line = document.createElement('div');
      line.className = 'temp-amap-scale-bar';
      const label = document.createElement('span');
      label.className = 'temp-amap-scale-label';
      el.append(label, line);
      control._el = el;
      this._root.append(el);
      this._updateScale();
    }
  }

  destroy() {
    this._destroyed = true;
    this.stopMove();
    this._resizeObserver?.disconnect();
    this._emitter.clear();
    this._overlays.clear();
    if (this._container) this._container.innerHTML = '';
  }

  _updateScale() {
    for (const ctrl of this._controls) {
      if (!(ctrl instanceof Scale) || !ctrl._el) continue;
      const metersPerPixel =
        (156543.03392 * Math.cos((this._center[1] * Math.PI) / 180)) / 2 ** this._zoom;
      const targetMeters = metersPerPixel * 72;
      const niceSteps = [
        10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000, 500000,
      ];
      let meters = niceSteps[0];
      for (const s of niceSteps) {
        if (s <= targetMeters * 1.4) meters = s;
      }
      const px = clamp(Math.round(meters / metersPerPixel), 34, 110);
      const text = meters >= 1000 ? `${meters / 1000} 公里` : `${meters} 米`;
      ctrl._el.querySelector('.temp-amap-scale-bar').style.width = `${px}px`;
      ctrl._el.querySelector('.temp-amap-scale-label').textContent = text;
    }
  }

  _render() {
    if (this._destroyed || !this._root) return;
    this._renderBackdrop();
    this._renderOverlays();
    this._updateScale();
  }

  _renderBackdrop() {
    const svg = this._svgBackdrop;
    if (!svg) return;
    const { w, h } = this._size();
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);

    const gridStep = 0.015;
    const tl = this._containerToLngLat(0, 0);
    const br = this._containerToLngLat(w, h);
    const minLng = Math.floor(Math.min(tl.lng, br.lng) / gridStep) * gridStep;
    const maxLng = Math.ceil(Math.max(tl.lng, br.lng) / gridStep) * gridStep;
    const minLat = Math.floor(Math.min(tl.lat, br.lat) / gridStep) * gridStep;
    const maxLat = Math.ceil(Math.max(tl.lat, br.lat) / gridStep) * gridStep;

    const parts = [`<rect width="${w}" height="${h}" fill="var(--map-land)" />`];

    // Procedural urban blocks & parks anchored in geographic coordinates
    const maxCells = 18;
    const lngSteps = Math.min(maxCells, Math.round((maxLng - minLng) / gridStep));
    const latSteps = Math.min(maxCells, Math.round((maxLat - minLat) / gridStep));
    if (lngSteps <= maxCells && latSteps <= maxCells && this._zoom >= 10.5) {
      for (let i = 0; i <= lngSteps; i++) {
        for (let j = 0; j <= latSteps; j++) {
          const glng = +(minLng + i * gridStep).toFixed(4);
          const glat = +(minLat + j * gridStep).toFixed(4);
          const hash = Math.abs(Math.sin(glng * 1234.5 + glat * 6789.1) * 10000) % 1;
          const p0 = this.lngLatToContainer([glng + 0.002, glat + gridStep - 0.002]);
          const p1 = this.lngLatToContainer([glng + gridStep - 0.002, glat + 0.002]);
          const bw = Math.max(0, p1.x - p0.x);
          const bh = Math.max(0, p1.y - p0.y);
          if (bw < 6 || bh < 6) continue;
          const fill = hash < 0.22 ? 'var(--map-park)' : 'var(--map-block)';
          parts.push(
            `<rect x="${p0.x.toFixed(1)}" y="${p0.y.toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="6" fill="${fill}" opacity="0.62" />`,
          );
        }
      }
    }

    // Road grid lines
    if (lngSteps <= 28 && latSteps <= 28) {
      for (let i = 0; i <= lngSteps; i++) {
        const lng = minLng + i * gridStep;
        const p = this.lngLatToContainer([lng, tl.lat]);
        const major = Math.round(lng / gridStep) % 3 === 0;
        parts.push(
          `<line x1="${p.x.toFixed(1)}" y1="0" x2="${p.x.toFixed(1)}" y2="${h}" stroke="${major ? 'var(--map-major)' : 'var(--map-road)'}" stroke-width="${major ? 4 : 1.5}" opacity="0.88" />`,
        );
      }
      for (let j = 0; j <= latSteps; j++) {
        const lat = minLat + j * gridStep;
        const p = this.lngLatToContainer([tl.lng, lat]);
        const major = Math.round(lat / gridStep) % 3 === 0;
        parts.push(
          `<line x1="0" y1="${p.y.toFixed(1)}" x2="${w}" y2="${p.y.toFixed(1)}" stroke="${major ? 'var(--map-major)' : 'var(--map-road)'}" stroke-width="${major ? 4 : 1.5}" opacity="0.88" />`,
        );
      }
    }

    // Render West Lake & Qiantang River geographically when visible
    const lakePts = WEST_LAKE_POLY.map((pt) => this.lngLatToContainer(pt));
    if (lakePts.some((p) => p.x > -200 && p.x < w + 200 && p.y > -200 && p.y < h + 200)) {
      const d =
        lakePts
          .map((p, idx) => `${idx === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
          .join(' ') + 'Z';
      parts.push(`<path d="${d}" fill="var(--map-water)" opacity="0.92" />`);
      const centerLake = this.lngLatToContainer([120.146, 30.246]);
      parts.push(
        `<text x="${centerLake.x.toFixed(1)}" y="${centerLake.y.toFixed(1)}" text-anchor="middle" fill="var(--map-text)" font-size="13" font-weight="600" opacity="0.85">西湖</text>`,
      );
    }

    const riverPts = QIANTANG_RIVER_POLY.map((pt) => this.lngLatToContainer(pt));
    if (riverPts.some((p) => p.x > -300 && p.x < w + 300 && p.y > -300 && p.y < h + 300)) {
      const d = riverPts
        .map((p, idx) => `${idx === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
        .join(' ');
      parts.push(
        `<path d="${d}" fill="none" stroke="var(--map-water)" stroke-width="${Math.max(12, Math.round(2 ** (this._zoom - 11) * 14))}" stroke-linecap="round" stroke-linejoin="round" opacity="0.88" />`,
      );
    }

    // Subtle city name watermark with screen-space de-collision
    const placedCities = [];
    for (const c of CITIES) {
      const pt = this.lngLatToContainer([c.lng, c.lat]);
      if (pt.x > 24 && pt.x < w - 24 && pt.y > 40 && pt.y < h - 40) {
        const y = pt.y - 10;
        const collides = placedCities.some(
          (p) => Math.abs(p.x - pt.x) < 88 && Math.abs(p.y - y) < 26,
        );
        if (collides) continue;
        placedCities.push({ x: pt.x, y });
        parts.push(
          `<text x="${pt.x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" fill="var(--map-text)" font-size="12" opacity="0.65">${c.full}</text>`,
        );
      }
    }

    svg.innerHTML = parts.join('');

    // Render clickable base-map hotspots for unpinned landmarks when zoom >= 12
    if (this._hotspotLayer) {
      this._hotspotLayer.innerHTML = '';
      if (this._zoom >= 11.5) {
        for (const poi of DEMO_POIS) {
          const pt = this.lngLatToContainer([poi.lng, poi.lat]);
          if (pt.x < -40 || pt.x > w + 40 || pt.y < -40 || pt.y > h + 40) continue;
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'temp-amap-hotspot';
          btn.style.left = `${pt.x.toFixed(1)}px`;
          btn.style.top = `${pt.y.toFixed(1)}px`;
          btn.title = poi.name;
          btn.innerHTML = `<span class="temp-amap-hotspot-dot"></span><span class="temp-amap-hotspot-name">${poi.name}</span>`;
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            this._emitter.emit('hotspotclick', {
              id: poi.id,
              name: poi.name,
              address: poi.address,
              type: poi.type,
              lnglat: new LngLat(poi.lng, poi.lat),
            });
          });
          this._hotspotLayer.append(btn);
        }
      }
    }
  }

  _renderOverlays() {
    if (!this._root || !this._svgLines || !this._markerLayer || !this._labelLayer) return;
    const { w, h } = this._size();

    // 1. Polylines
    this._svgLines.setAttribute('viewBox', `0 0 ${w} ${h}`);
    const lineSvg = [];
    for (const item of this._overlays) {
      if (!(item instanceof Polyline) || item._path.length < 2) continue;
      const pts = item._path.map((p) => this.lngLatToContainer(p));
      const d = pts
        .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
        .join(' ');
      lineSvg.push(
        `<path d="${d}" fill="none" stroke="${item._strokeColor}" stroke-width="${item._strokeWeight}" stroke-opacity="${item._strokeOpacity}" stroke-linecap="round" stroke-linejoin="round" />`,
      );
      if (item._showDir) {
        for (let i = 1; i < pts.length; i += Math.max(1, Math.floor(pts.length / 4))) {
          const a = pts[i - 1];
          const b = pts[i];
          if (Math.hypot(b.x - a.x, b.y - a.y) < 16) continue;
          const mx = (a.x + b.x) / 2;
          const my = (a.y + b.y) / 2;
          const deg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
          lineSvg.push(
            `<path d="M-4 -3 L3 0 L-4 3" transform="translate(${mx.toFixed(1)} ${my.toFixed(1)}) rotate(${deg.toFixed(1)})" fill="none" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />`,
          );
        }
      }
    }
    this._svgLines.innerHTML = lineSvg.join('');

    // 2. Markers
    this._markerLayer.innerHTML = '';
    for (const item of this._overlays) {
      if (!(item instanceof Marker)) continue;
      const pt = this.lngLatToContainer(item._position);
      const wrap = document.createElement('div');
      wrap.className = 'temp-amap-marker-wrap';
      wrap.style.left = `${(pt.x + item._offset.x).toFixed(1)}px`;
      wrap.style.top = `${(pt.y + item._offset.y).toFixed(1)}px`;
      wrap.style.zIndex = String(item._zIndex);
      if (item._content instanceof HTMLElement) {
        wrap.append(item._content);
      } else if (typeof item._content === 'string') {
        wrap.innerHTML = item._content;
      }
      wrap.addEventListener('click', (e) => {
        e.stopPropagation();
        item._emitter.emit('click', {
          target: item,
          lnglat: item.getPosition(),
        });
      });
      this._markerLayer.append(wrap);
    }

    // 3. LabelsLayer
    this._labelLayer.innerHTML = '';
    for (const item of this._overlays) {
      if (!(item instanceof LabelsLayer)) continue;
      const sorted = [...item._markers].sort((a, b) => (b._rank || 0) - (a._rank || 0));
      for (const lm of sorted) {
        const pt = this.lngLatToContainer(lm._position);
        if (pt.x < -120 || pt.x > w + 120 || pt.y < -60 || pt.y > h + 60) continue;
        const t = lm._text || {};
        if (!t.content) continue;
        const [ox = 18, oy = 0] = Array.isArray(t.offset) ? t.offset : [18, 0];
        const span = document.createElement('span');
        span.className = `temp-amap-label dir-${t.direction || 'right'}`;
        span.style.left = `${(pt.x + ox).toFixed(1)}px`;
        span.style.top = `${(pt.y + oy).toFixed(1)}px`;
        if (t.style?.fontSize) span.style.fontSize = `${t.style.fontSize}px`;
        span.textContent = t.content;
        this._labelLayer.append(span);
      }
    }
  }
}

class PlaceSearch {
  constructor(options = {}) {
    this._city = options.city || '';
  }
  search(keyword, cb) {
    const q = String(keyword || '')
      .trim()
      .toLowerCase();
    const city = String(this._city || '').trim();
    const matches = DEMO_POIS.filter((poi) => {
      const hay =
        `${poi.name} ${poi.address} ${poi.city} ${poi.district} ${poi.type}`.toLowerCase();
      return (
        (!city || poi.city.includes(city) || city.includes(poi.city) || hay.includes(q)) &&
        hay.includes(q)
      );
    });
    const finalList = matches.length
      ? matches
      : DEMO_POIS.filter(
          (poi) => !city || poi.city.includes(city) || city.includes(poi.city),
        ).slice(0, 4);
    setTimeout(() => {
      cb?.('complete', {
        poiList: {
          pois: finalList.map((p) => ({
            ...p,
            location: new LngLat(p.lng, p.lat),
          })),
        },
      });
    }, 30);
  }
  getDetails(id, cb) {
    const poi = DEMO_POIS.find((p) => p.id === id);
    setTimeout(() => {
      if (!poi) {
        cb?.('no_data', {});
        return;
      }
      cb?.('complete', {
        poiList: {
          pois: [
            {
              ...poi,
              location: new LngLat(poi.lng, poi.lat),
              scenic: { intro: poi.intro, opentime: poi.opentime2 },
            },
          ],
        },
      });
    }, 25);
  }
}

class AutoComplete {
  constructor(options = {}) {
    this._city = options.city || '';
  }
  search(keyword, cb) {
    const q = String(keyword || '')
      .trim()
      .toLowerCase();
    const tips = DEMO_POIS.filter((p) =>
      `${p.name} ${p.address} ${p.city} ${p.type}`.toLowerCase().includes(q),
    )
      .slice(0, 6)
      .map((p) => ({
        ...p,
        location: new LngLat(p.lng, p.lat),
      }));
    setTimeout(() => {
      cb?.('complete', { tips });
    }, 20);
  }
}

class Geocoder {
  constructor(options = {}) {
    this._city = options.city || '';
  }
  getLocation(address, cb) {
    const q = String(address || '').trim();
    const poi = DEMO_POIS.find((p) => p.name.includes(q) || q.includes(p.name));
    if (poi) {
      setTimeout(() => {
        cb?.('complete', {
          geocodes: [
            {
              formattedAddress: poi.address,
              location: new LngLat(poi.lng, poi.lat),
              province: '浙江省',
              city: poi.city + '市',
              district: poi.district,
              adcode: '330106',
            },
          ],
        });
      }, 20);
      return;
    }
    const city = CITIES.find((c) => q.includes(c.name) || c.full.includes(q)) || CITIES[0];
    setTimeout(() => {
      cb?.('complete', {
        geocodes: [
          {
            formattedAddress: `${city.province}${city.full}`,
            location: new LngLat(city.lng, city.lat),
            province: city.province,
            city: city.full,
            adcode: city.adcode,
          },
        ],
      });
    }, 20);
  }
  getAddress(lnglat, cb) {
    const pt = toLngLatPair(lnglat) || [120.1551, 30.2741];
    let nearest = null;
    let bestDist = Infinity;
    for (const poi of DEMO_POIS) {
      const d = haversineMeters(pt, [poi.lng, poi.lat]);
      if (d < bestDist) {
        bestDist = d;
        nearest = poi;
      }
    }
    const formattedAddress =
      nearest && bestDist < 1200
        ? `${nearest.district} · 靠近${nearest.name}`
        : `杭州市附近 (${pt[0].toFixed(4)}, ${pt[1].toFixed(4)})`;
    setTimeout(() => {
      cb?.('complete', {
        regeocode: {
          formattedAddress,
        },
      });
    }, 20);
  }
}

function makeRouteService(mode) {
  const speedsMps = {
    walking: 1.25,
    bicycling: 3.9,
    driving: 7.8,
    transit: 6.2,
  };
  const baseWaitSec = mode === 'transit' ? 360 : 0;
  return class RouteService {
    search(origin, destination, cb) {
      const a = toLngLatPair(origin);
      const b = toLngLatPair(destination);
      if (!a || !b) {
        cb?.('error', 'INVALID_COORDS');
        return;
      }
      const straight = Math.max(80, haversineMeters(a, b));
      const distance = Math.round(straight * (mode === 'walking' ? 1.18 : 1.28));
      const time = Math.max(60, Math.round(distance / (speedsMps[mode] || 1.25) + baseWaitSec));
      // Build a gently curved multi-point polyline between a and b
      const steps = 6;
      const path = [];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const offsetFactor = mode === 'walking' ? 0.08 : 0.14;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const arc = Math.sin(t * Math.PI) * offsetFactor;
        path.push([+(a[0] + dx * t - dy * arc).toFixed(6), +(a[1] + dy * t + dx * arc).toFixed(6)]);
      }
      setTimeout(() => {
        cb?.('complete', {
          routes: [
            {
              distance,
              time,
              steps: [{ path }],
              path,
            },
          ],
        });
      }, 25);
    }
  };
}

export function getTempAmap() {
  const AMap = {
    Map: TempMap,
    Marker,
    LabelMarker,
    LabelsLayer,
    Polyline,
    Scale,
    Pixel,
    LngLat,
    Bounds,
    PlaceSearch,
    AutoComplete,
    Geocoder,
    Walking: makeRouteService('walking'),
    Driving: makeRouteService('driving'),
    Riding: makeRouteService('bicycling'),
    Transfer: makeRouteService('transit'),
    getConfig: () => ({ defaultLocation: [120.1551, 30.2741] }),
    plugin(_plugins, cb) {
      queueMicrotask(() => cb?.());
    },
    convertFrom(coords, _type, cb) {
      const p = toLngLatPair(coords) || [120.1551, 30.2741];
      setTimeout(() => {
        cb?.('complete', { locations: [new LngLat(p[0], p[1])] });
      }, 15);
    },
  };
  return AMap;
}
