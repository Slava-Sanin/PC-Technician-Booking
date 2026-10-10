/**
 * Generates src/themes/registry.ts and src/themes/themes.css from theme definitions.
 * Run: node scripts/build-themes.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'src', 'themes');

function hx(h, s, l) {
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const v = l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return Math.round(255 * v)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`.toUpperCase();
}

function mk(n, mode, h, ah, s, as) {
  let bg, card, band, hd, hdt, tx, mu, ac, on, bd;
  if (mode === 'D') {
    bg = hx(h, 32 * s, 9);
    card = hx(h, 30 * s, 13);
    band = hx(h, 28 * s, 18);
    hd = band;
    hdt = hx(h, 40 * s, 92);
    tx = hdt;
    mu = hx(h, 20 * s, 66);
    ac = hx(ah, as, 64);
    on = hx(ah, 50, 8);
    bd = hx(h, 26 * s, 25);
  } else {
    bg = hx(h, 40 * s, 95);
    card = hx(h, 50 * s, 99);
    band = hx(h, 38 * s, 88);
    tx = hx(h, 45 * s, 14);
    mu = hx(h, 22 * s, 42);
    ac = hx(ah, as, 40);
    on = '#FFFFFF';
    bd = hx(h, 30 * s, 81);
    if (mode === 'LH') {
      hd = hx(h, 45 * s, 22);
      hdt = hx(h, 40 * s, 94);
    } else {
      hd = band;
      hdt = hx(h, 45 * s, 16);
    }
  }
  return { name: n, bg, card, band, hd, hdt, tx, mu, ac, on, bd };
}

function row(name, id, bg, card, band, hd, hdt, tx, mu, ac, on, bd, font) {
  return { id, name, colors: { bg, card, band, hd, hdt, tx, mu, ac, on, bd }, font };
}

/** @type {ReturnType<typeof row>[]} */
const manual = [
  // warm-plus: actual project palette (default light theme)
  row(
    'Тёплая+',
    'warm-plus',
    '#D9CFC0',
    '#E5DACA',
    '#D4C4AE',
    '#E5DACA',
    '#292524',
    '#292524',
    '#6B6259',
    '#735740',
    '#FAF6EF',
    '#C4B5A3',
  ),
  row('Midnight', 'midnight', '#12161C', '#1B212A', '#232B36', '#232B36', '#E6EAF0', '#E6EAF0', '#8B96A5', '#4DA3FF', '#06121F', '#2B3441'),
  row('Tech Blue', 'tech-blue', '#F4F7FB', '#FFFFFF', '#E8EEF7', '#FFFFFF', '#1C2430', '#1C2430', '#5B6778', '#2563EB', '#FFFFFF', '#D8E0EC'),
  row('Fresh', 'fresh', '#EEF6F3', '#FFFFFF', '#DDEDE7', '#DDEDE7', '#1F2D2A', '#1F2D2A', '#567069', '#10A37F', '#FFFFFF', '#CFE3DB'),
  row('Terminal', 'terminal', '#0B0F0C', '#121A14', '#17231A', '#17231A', '#C8F7D0', '#C8F7D0', '#6FA57B', '#39FF88', '#04120A', '#1F3324', 'mono'),
  row('Графит', 'grafite', '#F2F2F0', '#FFFFFF', '#E6E6E2', '#2B2D31', '#F2F2F0', '#202124', '#6B6E73', '#FF7A1A', '#1A0F05', '#DADAD6'),
  row('Лаванда', 'lavanda', '#F3F0FA', '#FFFFFF', '#E4DEF4', '#E4DEF4', '#2B2347', '#2B2347', '#6B6286', '#6D4AE0', '#FFFFFF', '#D6CEEB'),
  row('Океан', 'ocean', '#0E1B2A', '#14263A', '#1B3350', '#1B3350', '#E4F0FA', '#E4F0FA', '#8FA9C2', '#2DD4BF', '#04201C', '#24425F'),
  row('Бордо', 'bordeaux', '#F7EFEF', '#FFFFFF', '#EBD9DA', '#6E1F2E', '#FBEFF0', '#2A1519', '#7A5B60', '#9B2C3F', '#FFFFFF', '#E0CBCD'),
  row('Лес', 'forest', '#E9EFE6', '#F7FAF5', '#D3E0CC', '#2F4A36', '#EEF5EA', '#1E2D22', '#5C7060', '#3E7B4F', '#FFFFFF', '#C5D6BE'),
  row('Нордик', 'nordic', '#ECEFF2', '#F8F9FA', '#DDE2E8', '#DDE2E8', '#2B3440', '#2B3440', '#66707C', '#3D5A80', '#FFFFFF', '#CBD2DA'),
  row('Закат', 'sunset', '#1E1714', '#2A201B', '#382A23', '#382A23', '#F6E9DD', '#F6E9DD', '#B39C8A', '#FF8A5B', '#231008', '#4A382E'),
  row('Сакура', 'sakura', '#FBF0F3', '#FFFFFF', '#F5DCE4', '#F5DCE4', '#4A1F2F', '#3B1A26', '#85606D', '#D6336C', '#FFFFFF', '#EBCBD5'),
  row('Терракота', 'terracotta', '#F6EFE4', '#FFFBF4', '#EBDDC6', '#C2562E', '#FFF4EA', '#34261C', '#86705B', '#C2562E', '#FFFFFF', '#E2D2B8'),
  row('Индиго', 'indigo-night', '#15122B', '#1E1A3D', '#29234F', '#29234F', '#E9E6FF', '#E9E6FF', '#9E98CC', '#A78BFA', '#1A1038', '#382F6B'),
  row('Контраст', 'contrast', '#FFFFFF', '#FFFFFF', '#F0F0F0', '#111111', '#FFFFFF', '#111111', '#4D4D4D', '#FFD400', '#111111', '#111111'),
  row('Бирюза', 'turquoise', '#E8F4F5', '#FFFFFF', '#CDE8EA', '#0F4C5C', '#E8F4F5', '#12333A', '#4F7580', '#0F8B9E', '#FFFFFF', '#BBDADD'),
  row('Янтарь', 'amber-night', '#1A1A1A', '#242424', '#2E2E2E', '#2E2E2E', '#F0F0F0', '#EDEDED', '#9A9A9A', '#F5B301', '#1A1200', '#3A3A3A'),
  row('Слива', 'plum', '#F4EEF3', '#FFFFFF', '#E6D5E4', '#5B2A5A', '#F8EDF7', '#2E1A2E', '#7C617B', '#8E3B8C', '#FFFFFF', '#DCC6DA'),
  row('Небо', 'nebo', '#EAF4FD', '#FFFFFF', '#D4E8FA', '#D4E8FA', '#12324F', '#12324F', '#55799A', '#0EA5E9', '#052233', '#BFD9F0'),
  row('Олива', 'olive', '#EFEFE2', '#FAFAF1', '#DEDEC2', '#4B5320', '#F4F4E4', '#2B2E14', '#6F7350', '#6B7A1F', '#FFFFFF', '#D2D2B0'),
  row('Неон', 'neon', '#130B1F', '#1D1230', '#2A1945', '#2A1945', '#FBE7FF', '#FBE7FF', '#B28CC9', '#FF4FB8', '#1F0517', '#43296A'),
  row('Бумага', 'paper', '#FAFAF8', '#FFFFFF', '#EFEFEA', '#FAFAF8', '#111111', '#1A1A1A', '#6A6A66', '#1A1A1A', '#FFFFFF', '#DDDDD6'),
  row('Коралл', 'coral', '#FFF3EE', '#FFFFFF', '#FFDDD0', '#FFDDD0', '#4A1E10', '#3A1A10', '#8A5E50', '#F0562E', '#FFFFFF', '#F3CDBE'),
  row('Дюна', 'duna', '#F3EBDD', '#FFFAF0', '#E6D8BF', '#E6D8BF', '#3B2E1A', '#3B2E1A', '#8A7556', '#B8860B', '#FFFFFF', '#DCCBA9'),
  row('Фисташка', 'pistachio', '#EEF5E6', '#FBFEF7', '#DCEBCB', '#DCEBCB', '#26381A', '#26381A', '#68805A', '#5C9E2E', '#FFFFFF', '#CADDB5'),
  row('Лёд', 'ice', '#EEF6FA', '#FFFFFF', '#D9EAF2', '#FFFFFF', '#16323F', '#16323F', '#5B7F90', '#2A9DC6', '#042330', '#C9DEE8'),
  row('Сирень', 'lilac', '#F6F0F8', '#FFFFFF', '#EADDF0', '#EADDF0', '#35214A', '#35214A', '#7D6A92', '#9B5DE5', '#FFFFFF', '#DCCCE6'),
  row('Персик', 'peach', '#FFF4EA', '#FFFFFF', '#FFE0C7', '#FFE0C7', '#47260F', '#47260F', '#94684A', '#FF8C42', '#2B1405', '#F5D3B5'),
  row('Лайм', 'lime', '#F5F9E4', '#FFFFFF', '#E4EFB8', '#2E3B0A', '#F5F9E4', '#252D0A', '#6E7A3C', '#8CB800', '#1A2200', '#D8E4A6'),
  row('Шалфей', 'sage', '#EBF0EC', '#F9FBF9', '#D6E0D8', '#D6E0D8', '#2A3A30', '#2A3A30', '#667A6C', '#4F7F63', '#FFFFFF', '#C6D4CA'),
  row('Сталь', 'steel', '#EDF0F5', '#FFFFFF', '#DAE0EB', '#1F2A44', '#EDF0F5', '#1F2A44', '#657089', '#3B5BDB', '#FFFFFF', '#CBD3E3'),
  row('Руж', 'rouge', '#FBEFEF', '#FFFFFF', '#F4D6D6', '#F4D6D6', '#4A1818', '#3A1616', '#8F6060', '#D62828', '#FFFFFF', '#EBC9C9'),
  row('Горчица', 'mustard', '#FAF4E1', '#FFFDF5', '#F0E2B0', '#F0E2B0', '#403000', '#352A05', '#8A7632', '#D4A017', '#2B2000', '#E8D9A0'),
  row('Хлопок', 'cotton', '#F5F5F5', '#FFFFFF', '#E8E8E8', '#FFFFFF', '#222222', '#222222', '#707070', '#1E88E5', '#FFFFFF', '#DADADA'),
  row('Пена', 'foam', '#E9F7F4', '#FFFFFF', '#CBEDE5', '#CBEDE5', '#0F3A33', '#0F3A33', '#4F8A7F', '#14B8A6', '#032B26', '#B8E0D8'),
  row('Глина', 'clay', '#F2E8E4', '#FCF7F5', '#E3CFC7', '#7A4B3A', '#F8EEE9', '#3A241C', '#8E6B5E', '#A8573C', '#FFFFFF', '#D9C0B6'),
  row('Ультрамарин', 'ultramarine', '#F0F3FF', '#FFFFFF', '#DCE3FF', '#2B3A9E', '#EEF1FF', '#1B2150', '#6770AD', '#3F51F0', '#FFFFFF', '#CBD3F5'),
  row('Гранат', 'pomegranate', '#F9EEF1', '#FFFFFF', '#EFD3DB', '#EFD3DB', '#4A1426', '#3A1220', '#8F5F6E', '#B3123F', '#FFFFFF', '#E3C3CC'),
  row('Графит-синий', 'grafite-blue', '#14181F', '#1C222B', '#252D39', '#252D39', '#E8ECF2', '#E8ECF2', '#8F9BAD', '#6EA8FE', '#071426', '#303A48'),
  row('Изумруд', 'emerald-night', '#0C1A15', '#12261F', '#1A3329', '#1A3329', '#DDF5EA', '#DDF5EA', '#7FB49D', '#34D399', '#04241A', '#23463A'),
  row('Бордо ночь', 'bordeaux-night', '#1D0F14', '#2A171E', '#3A2029', '#3A2029', '#F8E6EA', '#F8E6EA', '#B88C98', '#FB7185', '#2A0710', '#4D2D38'),
  row('Стальной циан', 'steel-cyan', '#1B1F24', '#242A31', '#2E353D', '#2E353D', '#E6E9ED', '#E6E9ED', '#98A1AC', '#22D3EE', '#032026', '#3A424C'),
  row('Мох', 'moss-night', '#141A12', '#1C2419', '#273221', '#273221', '#E7F0DF', '#E7F0DF', '#93A887', '#A3E635', '#142003', '#33412B'),
  row('Космос', 'cosmos', '#0A0A18', '#12122B', '#1B1B40', '#1B1B40', '#E6E6FF', '#E6E6FF', '#8E8EC4', '#818CF8', '#0B0B2B', '#2A2A5C'),
  row('Эспрессо', 'espresso', '#1C1411', '#271C17', '#34261F', '#34261F', '#F3E7DC', '#F3E7DC', '#B09882', '#D9A066', '#24140A', '#47352B'),
  row('Уголь и красный', 'coal-red', '#121212', '#1B1B1B', '#262626', '#262626', '#EFEFEF', '#EFEFEF', '#9B9B9B', '#EF4444', '#FFFFFF', '#333333'),
  row('Глубокий бирюзовый', 'deep-turquoise', '#07191C', '#0D2428', '#143238', '#143238', '#DDF3F5', '#DDF3F5', '#7BAAB0', '#2DD4BF', '#032320', '#1F4249'),
  row('Аметист', 'amethyst-night', '#181226', '#221A36', '#2E2448', '#2E2448', '#EEE6FF', '#EEE6FF', '#A596C9', '#C084FC', '#220A3A', '#3E3260'),
  row('Тёмный хаки', 'dark-khaki', '#1A1B14', '#23251B', '#2E3025', '#2E3025', '#EEF0DC', '#EEF0DC', '#A3A682', '#D4D96B', '#1F2005', '#3B3E2E'),
  row('Кобальт', 'cobalt', '#0B1530', '#111E40', '#192A58', '#192A58', '#E3EAFF', '#E3EAFF', '#8CA0D6', '#4C7DFF', '#05102E', '#243B7A'),
  row('Тёмная роза', 'dark-rose', '#1F1219', '#2B1A24', '#3A2433', '#3A2433', '#FBE8F2', '#FBE8F2', '#BE93AB', '#F472B6', '#2B0A1B', '#4F3245'),
  row('Серебро', 'silver-night', '#16181B', '#1F2226', '#2A2E33', '#E9ECEF', '#16181B', '#E9ECEF', '#9AA0A8', '#E9ECEF', '#16181B', '#363A40'),
  row('Лава', 'lava', '#1A0F0A', '#27160E', '#3A2015', '#3A2015', '#FFE9DC', '#FFE9DC', '#C0937A', '#FF5A1F', '#1F0A02', '#4F2D1D'),
];

const S = [
  ['Ваниль', 'L', 45, 30, 0.9, 75],
  ['Абрикос', 'L', 28, 18, 1, 85],
  ['Малина', 'L', 340, 338, 0.9, 70],
  ['Пион', 'L', 325, 300, 0.9, 60],
  ['Орхидея', 'L', 290, 280, 0.8, 55],
  ['Васильки', 'L', 225, 225, 0.9, 75],
  ['Незабудка', 'L', 210, 200, 0.9, 80],
  ['Бриз', 'L', 195, 190, 0.9, 85],
  ['Нефрит', 'L', 165, 160, 0.8, 80],
  ['Папоротник', 'L', 140, 135, 0.8, 55],
  ['Яблоко', 'L', 100, 95, 0.8, 65],
  ['Лён', 'L', 55, 40, 0.7, 80],
  ['Мёд', 'L', 40, 38, 1, 90],
  ['Тыква', 'L', 20, 22, 1, 85],
  ['Брусника', 'L', 350, 355, 0.9, 65],
  ['Туман', 'L', 220, 215, 0.3, 55],
  ['Лотос', 'L', 310, 330, 0.6, 65],
  ['Снег', 'L', 210, 210, 0.15, 70],
  ['Банковский', 'LH', 220, 215, 0.9, 80],
  ['Клюква', 'LH', 350, 350, 0.9, 70],
  ['Хвоя', 'LH', 150, 145, 0.8, 60],
  ['Баклажан', 'LH', 285, 280, 0.8, 55],
  ['Кирпич', 'LH', 15, 15, 0.9, 75],
  ['Торф', 'LH', 30, 30, 0.7, 70],
  ['Лазурит', 'LH', 215, 210, 0.9, 85],
  ['Малахит', 'LH', 155, 160, 0.8, 80],
  ['Сумерки', 'LH', 250, 255, 0.8, 70],
  ['Индиго день', 'LH', 235, 240, 0.9, 75],
  ['Ржавчина', 'LH', 18, 20, 0.9, 85],
  ['Чернила', 'LH', 230, 220, 0.3, 70],
  ['Бутылочное стекло', 'LH', 160, 150, 0.7, 65],
  ['Шоколад', 'LH', 25, 28, 0.7, 75],
  ['Сапфир', 'LH', 205, 205, 0.9, 90],
  ['Полярная ночь', 'D', 215, 200, 1, 80],
  ['Чернила тьма', 'D', 240, 225, 0.9, 85],
  ['Хвойная ночь', 'D', 150, 140, 0.8, 60],
  ['Глубокий пламень', 'D', 0, 10, 0.8, 80],
  ['Лавандовая ночь', 'D', 265, 270, 0.8, 85],
  ['Малахитовая ночь', 'D', 160, 165, 0.8, 70],
  ['Медь', 'D', 20, 25, 0.8, 75],
  ['Пепел', 'D', 0, 200, 0.08, 70],
  ['Сумрак', 'D', 255, 300, 0.7, 70],
  ['Бездна', 'D', 200, 185, 1, 90],
  ['Виноград', 'D', 300, 320, 0.7, 75],
  ['Охра', 'D', 45, 40, 0.8, 85],
  ['Тёмный лес', 'D', 120, 100, 0.6, 60],
  ['Мазут', 'D', 30, 35, 0.2, 90],
  ['Золото ночи', 'D', 48, 48, 0.6, 92],
  ['Рассвет', 'D', 340, 20, 0.7, 90],
  ['Лагуна', 'D', 180, 170, 0.9, 75],
];

const translit = {
  ё: 'e',
  й: 'y',
  ц: 'ts',
  у: 'u',
  к: 'k',
  е: 'e',
  н: 'n',
  г: 'g',
  ш: 'sh',
  щ: 'sch',
  з: 'z',
  х: 'h',
  ъ: '',
  ф: 'f',
  ы: 'y',
  в: 'v',
  а: 'a',
  п: 'p',
  р: 'r',
  о: 'o',
  л: 'l',
  д: 'd',
  ж: 'zh',
  э: 'e',
  я: 'ya',
  ч: 'ch',
  с: 's',
  м: 'm',
  и: 'i',
  т: 't',
  ь: '',
  б: 'b',
  ю: 'yu',
  ё: 'yo',
  Ё: 'yo',
  Й: 'y',
  Ц: 'ts',
  У: 'u',
  К: 'k',
  Е: 'e',
  Н: 'n',
  Г: 'g',
  Ш: 'sh',
  Щ: 'sch',
  З: 'z',
  Х: 'h',
  Ъ: '',
  Ф: 'f',
  Ы: 'y',
  В: 'v',
  А: 'a',
  П: 'p',
  Р: 'r',
  О: 'o',
  Л: 'l',
  Д: 'd',
  Ж: 'zh',
  Э: 'e',
  Я: 'ya',
  Ч: 'ch',
  С: 's',
  М: 'm',
  И: 'i',
  Т: 't',
  Ь: '',
  Б: 'b',
  Ю: 'yu',
};

function slugName(name) {
  let s = name
    .split('')
    .map((c) => translit[c] ?? (/[a-zA-Z0-9]/.test(c) ? c : '-'))
    .join('')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return s || 'theme';
}

function luminance(hex) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function modeFromBg(bg) {
  return luminance(bg) < 0.45 ? 'dark' : 'light';
}

const usedIds = new Set(manual.map((t) => t.id));
const usedNames = new Set(manual.map((t) => t.name));

const generated = S.map((args) => {
  const raw = mk(...args);
  let id = slugName(raw.name);
  if (usedIds.has(id)) id = `${id}-2`;
  usedIds.add(id);
  if (usedNames.has(raw.name)) {
    raw.name = `${raw.name} 2`;
  }
  usedNames.add(raw.name);
  return row(raw.name, id, raw.bg, raw.card, raw.band, raw.hd, raw.hdt, raw.tx, raw.mu, raw.ac, raw.on, raw.bd);
});

const themes = [...manual, ...generated].map((t) => ({
  ...t,
  mode: modeFromBg(t.colors.bg),
}));

if (themes.length !== 104) {
  console.warn(`Expected 104 themes, got ${themes.length}`);
}

function cssForTheme(t) {
  const sem =
    t.mode === 'dark'
      ? {
          danger: '#F87171',
          dangerDark: '#DC2626',
          success: '#4ADE80',
          warning: '#FBBF24',
          overlay: 'rgba(0, 0, 0, 0.55)',
          shadow: '0 1px 2px rgba(0, 0, 0, 0.35), 0 8px 24px rgba(0, 0, 0, 0.25)',
          knob: '#FFFFFF',
        }
      : {
          danger: '#B91C1C',
          dangerDark: '#991B1B',
          success: '#15803D',
          warning: '#B45309',
          overlay: 'rgba(15, 23, 42, 0.4)',
          shadow: '0 1px 2px rgba(41, 37, 36, 0.06), 0 8px 24px rgba(41, 37, 36, 0.04)',
          knob: '#FFFFFF',
        };

  const font =
    t.font === 'mono'
      ? '  --font-body: ui-monospace, "JetBrains Mono", Consolas, monospace;\n'
      : '';

  return `:root[data-theme="${t.id}"] {
  color-scheme: ${t.mode};
  --bg: ${t.colors.bg};
  --card: ${t.colors.card};
  --band: ${t.colors.band};
  --hd: ${t.colors.hd};
  --hdt: ${t.colors.hdt};
  --tx: ${t.colors.tx};
  --mu: ${t.colors.mu};
  --ac: ${t.colors.ac};
  --on: ${t.colors.on};
  --bd: ${t.colors.bd};
  --ac-dark: color-mix(in srgb, var(--ac) 82%, #000);
  --secondary: color-mix(in srgb, var(--ac) 28%, var(--band));
  --secondary-dark: color-mix(in srgb, var(--ac) 45%, var(--tx));
  --band-line: color-mix(in srgb, var(--bd) 55%, var(--band));
  --danger: ${sem.danger};
  --danger-dark: ${sem.dangerDark};
  --danger-soft: color-mix(in srgb, var(--danger) 14%, var(--card));
  --success: ${sem.success};
  --success-soft: color-mix(in srgb, var(--success) 14%, var(--card));
  --warning: ${sem.warning};
  --warning-soft: color-mix(in srgb, var(--warning) 14%, var(--card));
  --overlay: ${sem.overlay};
  --shadow-card: ${sem.shadow};
  --knob: ${sem.knob};
${font}}`;
}

const css = `/* Auto-generated by scripts/build-themes.mjs — do not edit by hand */
:root[data-theme="warm-plus"] {
  color-scheme: light;
}

${themes.map(cssForTheme).join('\n\n')}
`;

const registryTs = `/* Auto-generated by scripts/build-themes.mjs — do not edit by hand */

export type ThemeMode = 'light' | 'dark';

export type ThemeColors = {
  bg: string;
  card: string;
  band: string;
  hd: string;
  hdt: string;
  tx: string;
  mu: string;
  ac: string;
  on: string;
  bd: string;
};

export type ThemeDefinition = {
  id: string;
  name: string;
  mode: ThemeMode;
  colors: ThemeColors;
  font?: 'mono';
};

export const THEMES: ThemeDefinition[] = ${JSON.stringify(
  themes.map(({ font, ...rest }) => (font ? { ...rest, font } : rest)),
  null,
  2,
)};

export const THEME_BY_ID: Record<string, ThemeDefinition> = Object.fromEntries(
  THEMES.map((theme) => [theme.id, theme]),
);

export const DEFAULT_THEME_ID = 'vanil';
export const DEFAULT_LIGHT_THEME_ID = 'vanil';
export const DEFAULT_DARK_THEME_ID = 'vanil';

export const STORAGE_KEY = 'ui-theme';
`;

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'registry.ts'), registryTs);
writeFileSync(join(outDir, 'themes.css'), css);
console.log(`Wrote ${themes.length} themes to src/themes/`);
