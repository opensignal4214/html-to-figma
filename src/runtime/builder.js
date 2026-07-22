/*
 * html-to-figma runtime — runs inside Figma (Scripter or a plugin's code.js).
 * Plain Figma Plugin API, no dependencies. The generator embeds this file
 * after a `const __TREE__ = {...}` declaration and appends a call to main().
 */
'use strict';

var __B64_LOOKUP = null;
function __base64ToBytes(b64) {
  if (!__B64_LOOKUP) {
    __B64_LOOKUP = {};
    var alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    for (var i = 0; i < alphabet.length; i++) __B64_LOOKUP[alphabet[i]] = i;
  }
  var clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  var out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  var buffer = 0;
  var bits = 0;
  var o = 0;
  for (var c = 0; c < clean.length; c++) {
    buffer = (buffer << 6) | __B64_LOOKUP[clean[c]];
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (buffer >> bits) & 0xff;
    }
  }
  return out.subarray(0, o);
}

function __solid(c) {
  return { type: 'SOLID', color: { r: c.r, g: c.g, b: c.b }, opacity: c.a === undefined ? 1 : c.a };
}

var __WEIGHT_NAMES = {
  100: 'Thin', 200: 'Extra Light', 300: 'Light', 400: 'Regular',
  500: 'Medium', 600: 'Semi Bold', 700: 'Bold', 800: 'Extra Bold', 900: 'Black',
};

function __styleName(weight, italic) {
  var bucket = Math.min(900, Math.max(100, Math.round((weight || 400) / 100) * 100));
  var name = __WEIGHT_NAMES[bucket] || 'Regular';
  if (!italic) return name;
  return name === 'Regular' ? 'Italic' : name + ' Italic';
}

var __GENERIC_FONTS = {
  'sans-serif': 'Inter', 'system-ui': 'Inter', 'ui-sans-serif': 'Inter',
  '-apple-system': 'Inter', 'blinkmacsystemfont': 'Inter', 'segoe ui': 'Inter',
  'helvetica neue': 'Inter', helvetica: 'Inter', arial: 'Inter',
  serif: 'Georgia', 'ui-serif': 'Georgia', 'times new roman': 'Georgia',
  monospace: 'Roboto Mono', 'ui-monospace': 'Roboto Mono', consolas: 'Roboto Mono',
  menlo: 'Roboto Mono', 'courier new': 'Roboto Mono',
};

async function __resolveFont(stack, weight, italic, cache) {
  var style = __styleName(weight, italic);
  var key = String(stack) + '|' + style;
  if (cache[key]) return cache[key];

  var families = String(stack || 'Inter')
    .split(',')
    .map(function (f) { return f.trim().replace(/^["']|["']$/g, ''); })
    .map(function (f) { return __GENERIC_FONTS[f.toLowerCase()] || f; });
  families.push('Inter');
  families = families.filter(function (f, i) { return f && families.indexOf(f) === i; });

  var styles = [style];
  if (italic && style !== 'Italic') styles.push('Italic');
  if (style !== 'Regular') styles.push('Regular');

  for (var fi = 0; fi < families.length; fi++) {
    for (var si = 0; si < styles.length; si++) {
      var font = { family: families[fi], style: styles[si] };
      try {
        await figma.loadFontAsync(font);
        cache[key] = font;
        return font;
      } catch (e) { /* try next candidate */ }
    }
  }
  var fallback = { family: 'Inter', style: 'Regular' };
  await figma.loadFontAsync(fallback);
  cache[key] = fallback;
  return fallback;
}

function __applyBox(node, st) {
  if (st.radius) {
    if ('topLeftRadius' in node) {
      node.topLeftRadius = st.radius.tl || 0;
      node.topRightRadius = st.radius.tr || 0;
      node.bottomRightRadius = st.radius.br || 0;
      node.bottomLeftRadius = st.radius.bl || 0;
    } else if ('cornerRadius' in node) {
      node.cornerRadius = st.radius.tl || 0;
    }
  }
  if (st.border && st.border.color && 'strokes' in node) {
    node.strokes = [__solid(st.border.color)];
    node.strokeWeight = st.border.width || 1;
    if ('strokeAlign' in node) node.strokeAlign = 'INSIDE';
    if (st.border.dashed && 'dashPattern' in node) {
      node.dashPattern = [Math.max(2, st.border.width * 3), Math.max(2, st.border.width * 2)];
    }
  }
  if (st.shadows && st.shadows.length && 'effects' in node) {
    node.effects = st.shadows.map(function (s) {
      return {
        type: s.inset ? 'INNER_SHADOW' : 'DROP_SHADOW',
        color: { r: s.color.r, g: s.color.g, b: s.color.b, a: s.color.a },
        offset: { x: s.x, y: s.y },
        radius: s.blur || 0,
        spread: s.spread || 0,
        visible: true,
        blendMode: 'NORMAL',
      };
    });
  }
  if ('clipsContent' in node) node.clipsContent = !!st.clip;
}

function __frameFills(st) {
  var fills = [];
  if (st.background) fills.push(__solid(st.background));
  if (st.gradient) {
    fills.push({
      type: 'GRADIENT_LINEAR',
      gradientTransform: st.gradient.transform,
      gradientStops: st.gradient.stops.map(function (s) {
        return { position: s.position, color: { r: s.color.r, g: s.color.g, b: s.color.b, a: s.color.a } };
      }),
    });
  }
  if (st.backgroundImage && st.backgroundImage.base64) {
    try {
      var img = figma.createImage(__base64ToBytes(st.backgroundImage.base64));
      fills.push({ type: 'IMAGE', imageHash: img.hash, scaleMode: st.backgroundImage.scaleMode || 'FILL' });
    } catch (e) {
      console.warn('html-to-figma: background image skipped: ' + e.message);
    }
  }
  return fills;
}

async function __createText(n, ctx) {
  var t = n.text;
  var node = figma.createText();
  var font = await __resolveFont(t.fontFamily, t.fontWeight, t.italic, ctx.fonts);
  node.fontName = font;
  node.characters = t.characters || '';
  node.fontSize = t.fontSize || 12;
  if (t.lineHeightPx) node.lineHeight = { value: t.lineHeightPx, unit: 'PIXELS' };
  if (t.letterSpacing) node.letterSpacing = { value: t.letterSpacing, unit: 'PIXELS' };
  node.textAlignHorizontal = t.align || 'LEFT';
  node.textAlignVertical = 'TOP';
  if (t.decoration) node.textDecoration = t.decoration;
  if (t.case) node.textCase = t.case;
  node.fills = [__solid(t.color || { r: 0, g: 0, b: 0, a: 1 })];
  if (t.shadows && t.shadows.length && 'effects' in node) {
    node.effects = t.shadows.map(function (s) {
      return {
        type: 'DROP_SHADOW',
        color: { r: s.color.r, g: s.color.g, b: s.color.b, a: s.color.a },
        offset: { x: s.x, y: s.y },
        radius: s.blur || 0,
        spread: 0,
        visible: true,
        blendMode: 'NORMAL',
      };
    });
  }
  node.textAutoResize = 'NONE';
  node.resize(Math.max(n.rect.width, 1), Math.max(n.rect.height, 1));
  if (t.truncate && 'textTruncation' in node) {
    try { node.textTruncation = 'ENDING'; } catch (e) { /* older API */ }
  }
  node.name = n.name || (t.characters || 'text').slice(0, 40);
  return node;
}

function __createSvg(n) {
  var node = figma.createNodeFromSvg(n.svg);
  node.name = n.name || 'svg';
  if (n.rect.width >= 1 && n.rect.height >= 1) {
    node.resize(n.rect.width, n.rect.height);
  }
  return node;
}

function __createImage(n) {
  var rect = figma.createRectangle();
  rect.name = n.name || 'image';
  rect.resize(Math.max(n.rect.width, 0.01), Math.max(n.rect.height, 0.01));
  var applied = false;
  if (n.image && n.image.base64) {
    try {
      var img = figma.createImage(__base64ToBytes(n.image.base64));
      var fill = { type: 'IMAGE', imageHash: img.hash, scaleMode: n.image.scaleMode || 'FILL' };
      // CROP mode honors object-position: imageTransform maps container UV to
      // the visible normalized sub-rectangle of the image.
      if (n.image.scaleMode === 'CROP' && n.image.crop) {
        var c = n.image.crop;
        fill.imageTransform = [[c.w, 0, c.x], [0, c.h, c.y]];
      }
      rect.fills = [fill];
      applied = true;
    } catch (e) {
      console.warn('html-to-figma: image skipped: ' + e.message);
    }
  }
  if (!applied) {
    rect.fills = [{ type: 'SOLID', color: { r: 0.85, g: 0.85, b: 0.87 } }];
  }
  __applyBox(rect, n.style || {});
  return rect;
}

async function __createFrame(n, ctx) {
  var isComponent = !!n.component;
  var frame = isComponent ? figma.createComponent() : figma.createFrame();
  frame.name = (isComponent && typeof n.component === 'string' ? n.component : null) || n.name || 'frame';
  if (isComponent) ctx.components.push(frame.name);
  frame.resize(Math.max(n.rect.width, 0.01), Math.max(n.rect.height, 0.01));

  var st = n.style || {};
  frame.fills = __frameFills(st);
  __applyBox(frame, st);

  var ly = n.layout || {};
  var autoLayout = ly.mode === 'HORIZONTAL' || ly.mode === 'VERTICAL';
  if (autoLayout) {
    frame.layoutMode = ly.mode;
    frame.primaryAxisSizingMode = 'FIXED';
    frame.counterAxisSizingMode = 'FIXED';
    frame.itemSpacing = ly.gap || 0;
    frame.paddingTop = ly.paddingTop || 0;
    frame.paddingRight = ly.paddingRight || 0;
    frame.paddingBottom = ly.paddingBottom || 0;
    frame.paddingLeft = ly.paddingLeft || 0;
    frame.primaryAxisAlignItems = ly.primaryAlign || 'MIN';
    frame.counterAxisAlignItems = ly.counterAlign || 'MIN';
    if (ly.wrap) {
      try {
        frame.layoutWrap = 'WRAP';
        frame.counterAxisSpacing = ly.rowGap || ly.gap || 0;
      } catch (e) { /* older API */ }
    }
    frame.resize(Math.max(n.rect.width, 0.01), Math.max(n.rect.height, 0.01));
  }

  var children = n.children || [];
  for (var i = 0; i < children.length; i++) {
    await __createNode(children[i], frame, n.rect, ctx);
  }
  return frame;
}

async function __createNode(n, parent, parentRect, ctx) {
  var node = null;
  try {
    if (n.type === 'TEXT') node = await __createText(n, ctx);
    else if (n.type === 'SVG') node = __createSvg(n);
    else if (n.type === 'IMAGE') node = __createImage(n);
    else node = await __createFrame(n, ctx);
  } catch (e) {
    console.warn('html-to-figma: skipped "' + (n.name || n.type) + '": ' + e.message);
    return null;
  }
  if (!node) return null;

  parent.appendChild(node);
  ctx.count++;

  var parentAuto = 'layoutMode' in parent && parent.layoutMode !== 'NONE';
  if (parentAuto && n.abs) {
    try { node.layoutPositioning = 'ABSOLUTE'; } catch (e) { /* older API */ }
  }
  if (!parentAuto || n.abs) {
    node.x = n.rect.x - parentRect.x;
    node.y = n.rect.y - parentRect.y;
  }
  if (n.style && n.style.opacity !== undefined) node.opacity = n.style.opacity;
  if (n.style && n.style.blendMode && 'blendMode' in node) {
    try { node.blendMode = n.style.blendMode; } catch (e) { /* unsupported */ }
  }
  // Leaf rotation: n.rect is the untransformed box, so x/y put the center in
  // the right place; Figma's rotation setter turns the node about its center.
  // (Pivot/sign to be confirmed against live Figma — ROADMAP 1.2 / 2.3.)
  if (n.rotation && 'rotation' in node) {
    try { node.rotation = n.rotation; } catch (e) { /* unsupported node */ }
  }
  return node;
}

async function main(tree, opts) {
  opts = opts || {};
  var ctx = { fonts: {}, count: 0, components: [] };

  var container = figma.currentPage;
  var root = null;
  try {
    if (tree.type === 'TEXT') root = await __createText(tree, ctx);
    else if (tree.type === 'SVG') root = __createSvg(tree);
    else if (tree.type === 'IMAGE') root = __createImage(tree);
    else root = await __createFrame(tree, ctx);
    container.appendChild(root);
    ctx.count++;
  } catch (e) {
    figma.notify('html-to-figma failed: ' + e.message, { error: true });
    if (opts.close) figma.closePlugin();
    throw e;
  }

  var center = figma.viewport.center;
  root.x = Math.round(center.x - tree.rect.width / 2);
  root.y = Math.round(center.y - tree.rect.height / 2);

  figma.currentPage.selection = [root];
  figma.viewport.scrollAndZoomIntoView([root]);
  var componentNote = ctx.components.length ? ' (' + ctx.components.length + ' components)' : '';
  figma.notify('html-to-figma: created ' + ctx.count + ' nodes' + componentNote);
  if (opts.close) figma.closePlugin();
  return root;
}
