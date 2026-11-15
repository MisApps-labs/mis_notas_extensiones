// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ferlagod
// Mis Notas para Chromium — extrae el contenido de la página como Markdown compatible con la app.
//
// Se inyecta bajo demanda (permiso activeTab) después de vendor/Readability.js, vendor/turndown.js
// y vendor/turndown-plugin-gfm.js, y deja una función global en el mundo aislado de la extensión:
//
//   __misNotasExtract({ mode, ingredientsAsTasks }) → { title, url, mode, markdown, modes }
//
// mode: 'auto' | 'recipe' | 'article' | 'selection' | 'page' | 'link'
//
// El Markdown se adapta al lector de Mis Notas: cada línea es un bloque, las imágenes van en su
// propia línea, las sublistas se sangran con dos espacios y nada empieza con cuatro espacios
// (sería código).

(() => {
  if (window.__misNotasExtract) return;

  const msg = (key, fallback) => {
    try {
      return chrome.i18n.getMessage(key) || fallback;
    } catch {
      return fallback;
    }
  };

  const NESTED = '\u0001'; // marca interna de las líneas de una sublista
  // Casillas de tareas convertidas en texto (Readability elimina los <input>).
  const BOX_OFF = '';
  const BOX_ON = '';

  // ------------------------------------------------------------------
  // Utilidades
  // ------------------------------------------------------------------

  /** Quita etiquetas HTML y entidades, conservando los saltos de párrafo. */
  function plain(value) {
    if (value == null) return '';
    const html = String(value)
      .replace(/<\s*br\s*\/?>/gi, '\n')
      .replace(/<\/\s*(p|li|div|h\d)\s*>/gi, '\n');
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    return tpl.content.textContent
      .split('\n')
      .map((l) => l.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .join('\n');
  }

  const oneLine = (s) => plain(s).replace(/\n+/g, ' ').trim();

  /** Dirección segura para Markdown: sin espacios ni paréntesis sueltos. */
  const mdUrl = (u) => u.replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29');
  const mdText = (t) => t.replace(/[[\]]/g, (c) => (c === '[' ? '(' : ')')).replace(/\s+/g, ' ').trim();

  function absolute(u) {
    if (!u) return '';
    try {
      return new URL(u, document.baseURI).href;
    } catch {
      return '';
    }
  }

  // ------------------------------------------------------------------
  // Imágenes: la mejor dirección de cada <img> (carga diferida, srcset…)
  // ------------------------------------------------------------------

  const LAZY_ATTRS = ['data-src', 'data-lazy-src', 'data-original', 'data-lazy', 'data-url', 'data-pin-media'];

  function firstFromSrcset(srcset) {
    if (!srcset) return '';
    // La candidata más grande: "a.jpg 300w, b.jpg 1200w"
    let best = '';
    let bestW = -1;
    for (const part of srcset.split(/,\s+/)) {
      const [u, d] = part.trim().split(/\s+/);
      const w = d ? parseFloat(d) : 1;
      if (u && w > bestW) { best = u; bestW = w; }
    }
    return best;
  }

  function bestImageSrc(img) {
    const isPlaceholder = (s) => !s || (s.startsWith('data:') && s.length < 400);
    let src = img.currentSrc || img.getAttribute('src') || '';
    if (isPlaceholder(src)) {
      for (const a of LAZY_ATTRS) {
        const v = img.getAttribute(a);
        if (v && !isPlaceholder(v)) { src = v; break; }
      }
    }
    if (isPlaceholder(src)) src = firstFromSrcset(img.getAttribute('data-srcset') || img.getAttribute('srcset'));
    if (isPlaceholder(src)) return '';
    return src.startsWith('data:') ? src : absolute(src);
  }

  /** Anota en la página la mejor dirección de cada imagen; los clones la heredan. */
  function markImages() {
    for (const img of document.images) {
      const src = bestImageSrc(img);
      if (src) img.setAttribute('data-mn-src', src);
    }
  }

  function unmarkImages() {
    for (const img of document.querySelectorAll('img[data-mn-src]')) img.removeAttribute('data-mn-src');
  }

  // ------------------------------------------------------------------
  // HTML → Markdown
  // ------------------------------------------------------------------

  function makeTurndown() {
    const td = new TurndownService({
      headingStyle: 'atx',
      hr: '---',
      bulletListMarker: '-',
      codeBlockStyle: 'fenced',
      emDelimiter: '*',
      strongDelimiter: '**'
    });
    td.use([turndownPluginGfm.tables, turndownPluginGfm.strikethrough]);
    td.remove([
      'script', 'style', 'noscript', 'template', 'iframe', 'object', 'embed', 'form', 'button',
      'input', 'select', 'textarea', 'svg', 'canvas', 'video', 'audio', 'dialog', 'picture > source'
    ]);

    td.addRule('mnHeading', {
      filter: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
      replacement: (content, node) => {
        const text = content.replace(/\s*\n\s*/g, ' ').trim();
        if (!text) return '';
        // Una imagen dentro de un título va aparte.
        const images = text.match(/!\[[^\]]*\]\([^)]*\)/g) || [];
        const rest = text.replace(/!\[[^\]]*\]\([^)]*\)/g, '').trim();
        const level = Number(node.nodeName.charAt(1));
        return `\n\n${images.join('\n\n')}${images.length ? '\n\n' : ''}${rest ? `${'#'.repeat(level)} ${rest}` : ''}\n\n`;
      }
    });

    td.addRule('mnImage', {
      filter: 'img',
      replacement: (_content, node) => {
        const src = node.getAttribute('data-mn-src') || bestImageSrc(node);
        if (!src) return '';
        const alt = mdText(node.getAttribute('alt') || '');
        return `\n\n![${alt}](${mdUrl(src)})\n\n`;
      }
    });

    td.addRule('mnLink', {
      filter: (node) => node.nodeName === 'A' && node.getAttribute('href'),
      replacement: (content, node) => {
        const href = absolute(node.getAttribute('href'));
        // Imagen enlazada: la imagen sola (la app no muestra imágenes dentro de enlaces).
        if (/!\[[^\]]*\]\([^)]*\)/.test(content)) return content;
        const text = content.replace(/\s*\n\s*/g, ' ').trim();
        if (!text) return '';
        if (!href || !/^(https?|mailto):/i.test(href)) return text;
        const page = location.href.split('#')[0];
        if (href.startsWith(`${page}#`)) return text;
        return `[${text}](${mdUrl(href)})`;
      }
    });

    td.addRule('mnList', {
      filter: ['ul', 'ol'],
      replacement: (content, node) => {
        const lines = content.split('\n').filter((l) => l.trim() !== '');
        if (node.parentNode && node.parentNode.nodeName === 'LI') {
          return `\n${lines.map((l) => NESTED + l).join('\n')}\n`;
        }
        return `\n\n${lines.join('\n')}\n\n`;
      }
    });

    td.addRule('mnListItem', {
      filter: 'li',
      replacement: (content, node) => {
        const text = [];
        const nested = [];
        for (const line of content.split('\n')) {
          if (line.startsWith(NESTED)) nested.push(`  ${line.slice(1)}`);
          else if (/^\s*!\[[^\]]*\]\([^)]*\)\s*$/.test(line)) nested.push(`  ${line.trim()}`);
          // Un título dentro de un elemento de lista ("### Paso 1") pasa a negrita.
          else if (/^#{1,6} /.test(line.trim())) text.push(`**${line.trim().replace(/^#{1,6} /, '')}**`);
          else if (line.trim()) text.push(line.trim());
        }
        const parent = node.parentNode;
        let prefix = '- ';
        if (parent && parent.nodeName === 'OL') {
          const start = parseInt(parent.getAttribute('start') || '1', 10) || 1;
          const index = Array.prototype.indexOf.call(parent.children, node);
          prefix = `${start + index}. `;
        }
        let body = text.join(' ').replace(/\s+/g, ' ').trim();
        if (body.startsWith(BOX_OFF) || body.startsWith(BOX_ON)) {
          prefix = `- [${body.startsWith(BOX_ON) ? 'x' : ' '}] `;
          body = body.slice(1).trim();
        }
        if (!body && nested.length === 0) return '';
        return `${prefix}${body}${nested.length ? `\n${nested.join('\n')}` : ''}\n`;
      }
    });

    td.addRule('mnCell', {
      filter: ['th', 'td'],
      replacement: (content, node) => {
        const first = node.parentNode && node.parentNode.firstElementChild === node;
        const text = content.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|').trim();
        return `${first ? '| ' : ' '}${text} |`;
      }
    });

    td.addRule('mnFigcaption', {
      filter: 'figcaption',
      replacement: (content) => {
        const t = content.replace(/\s*\n\s*/g, ' ').trim();
        return t ? `\n\n*${t}*\n\n` : '';
      }
    });

    return td;
  }

  /** Limpieza de un clon antes de convertirlo. */
  function prepareClone(root, { stripChrome }) {
    const drop = [
      '[hidden]', '[aria-hidden="true"]', '.screen-reader-text', '.sr-only', '.visually-hidden'
    ];
    if (stripChrome) {
      drop.push('nav', 'footer', 'aside', 'header nav', '[role="navigation"]', '[role="contentinfo"]',
        '[role="complementary"]', '[role="banner"]', '[role="dialog"]', '[aria-modal="true"]');
    }
    for (const el of root.querySelectorAll(drop.join(','))) el.remove();
    prepareStructure(root);
    return root;
  }

  /**
   * Cambios que deben hacerse antes de Readability (que elimina los <input> y las tablas que
   * parecen de maquetación): casillas → marcas de texto, y cabecera en las tablas que no la tienen.
   */
  function prepareStructure(root) {
    // Llamadas a notas y enlaces de edición (Wikipedia y similares); Readability borra las clases.
    for (const el of root.querySelectorAll('sup.reference, .mw-editsection, .noprint')) el.remove();
    for (const box of root.querySelectorAll('input[type="checkbox"]')) {
      box.replaceWith(document.createTextNode(box.checked || box.hasAttribute('checked') ? BOX_ON : BOX_OFF));
    }
    // Tablas sin cabecera: la primera fila hace de cabecera (si no, Turndown las deja en HTML).
    for (const table of root.querySelectorAll('table')) {
      const row = table.rows && table.rows[0];
      if (!row || row.parentNode.nodeName === 'THEAD') continue;
      if ([...row.cells].every((c) => c.nodeName === 'TH')) continue;
      for (const cell of [...row.cells]) {
        const th = document.createElement('th');
        th.innerHTML = cell.innerHTML;
        cell.replaceWith(th);
      }
    }
  }

  /** Últimos retoques para el lector de la app. */
  function tidy(md) {
    return md
      .split('\n')
      // Nada debe empezar con 4 espacios salvo listas anidadas (si no, la app lo muestra como código).
      .map((l) => (/^\s{4,}(?:[-*+]|\d+[.)]) /.test(l) ? l : l.replace(/^\s{4,}/, '')).replace(/[ \t]+$/, ''))
      .join('\n')
      .replace(/[]\s?/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function htmlToMarkdown(nodeOrHtml) {
    return tidy(makeTurndown().turndown(nodeOrHtml));
  }

  // ------------------------------------------------------------------
  // Recetas (schema.org/Recipe en JSON-LD o microdatos)
  // ------------------------------------------------------------------

  const isRecipeType = (t) => t === 'Recipe' || (Array.isArray(t) && t.includes('Recipe'))
    || (typeof t === 'string' && /(^|\/)Recipe$/.test(t));

  function findRecipeNode(node, depth = 0) {
    if (!node || depth > 8) return null;
    if (Array.isArray(node)) {
      for (const n of node) {
        const r = findRecipeNode(n, depth + 1);
        if (r) return r;
      }
      return null;
    }
    if (typeof node !== 'object') return null;
    if (isRecipeType(node['@type'])) return node;
    for (const k of ['@graph', 'mainEntity', 'mainEntityOfPage', 'itemListElement', 'item']) {
      const r = findRecipeNode(node[k], depth + 1);
      if (r) return r;
    }
    return null;
  }

  function recipeFromJsonLd() {
    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
      let data;
      try {
        data = JSON.parse(s.textContent);
      } catch {
        try {
          data = JSON.parse(s.textContent.replace(/[\u0000-\u001f]+/g, ' '));
        } catch {
          continue;
        }
      }
      const r = findRecipeNode(data);
      if (r) return r;
    }
    return null;
  }

  function recipeFromMicrodata() {
    const root = document.querySelector('[itemscope][itemtype*="schema.org/Recipe"]');
    if (!root) return null;
    const val = (el) => el.getAttribute('content') || el.getAttribute('datetime') || el.getAttribute('src')
      || el.getAttribute('href') || el.textContent;
    const one = (prop) => {
      const el = root.querySelector(`[itemprop~="${prop}"]`);
      return el ? val(el) : undefined;
    };
    const all = (...props) => [...root.querySelectorAll(props.map((p) => `[itemprop~="${p}"]`).join(','))];
    const steps = [];
    for (const el of all('recipeInstructions')) {
      const items = el.querySelectorAll('li, p');
      if (items.length) items.forEach((i) => steps.push(i.textContent));
      else steps.push(el.innerHTML);
    }
    const img = root.querySelector('[itemprop~="image"]');
    return {
      name: one('name'),
      description: one('description'),
      image: img ? (img.nodeName === 'IMG' ? bestImageSrc(img) : val(img)) : undefined,
      recipeYield: one('recipeYield'),
      prepTime: one('prepTime'),
      cookTime: one('cookTime'),
      totalTime: one('totalTime'),
      recipeIngredient: all('recipeIngredient', 'ingredients').map((e) => e.textContent),
      recipeInstructions: steps
    };
  }

  function imageUrl(image) {
    if (!image) return '';
    if (typeof image === 'string') return absolute(image);
    if (Array.isArray(image)) {
      // La más grande si dicen el tamaño; si no, la primera.
      const objs = image.filter((i) => i && typeof i === 'object' && (i.width || i.height));
      if (objs.length) {
        objs.sort((a, b) => (Number(b.width) || 0) - (Number(a.width) || 0));
        return imageUrl(objs[0]);
      }
      return imageUrl(image[0]);
    }
    if (typeof image === 'object') return absolute(image.url || image.contentUrl || image['@id']);
    return '';
  }

  /** PT1H30M → "1 h 30 min". */
  function duration(iso) {
    if (!iso || typeof iso !== 'string') return '';
    const m = /^P(?:(\d+)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i.exec(iso.trim());
    if (!m) return oneLine(iso);
    let minutes = (Number(m[1]) || 0) * 1440 + (Number(m[2]) || 0) * 60 + (Number(m[3]) || 0) + Math.round((Number(m[4]) || 0) / 60);
    if (!minutes) return '';
    const d = Math.floor(minutes / 1440); minutes -= d * 1440;
    const h = Math.floor(minutes / 60); minutes -= h * 60;
    return [d && `${d} d`, h && `${h} h`, minutes && `${Math.round(minutes)} min`].filter(Boolean).join(' ');
  }

  function textOf(v) {
    if (v == null) return '';
    if (Array.isArray(v)) return v.map(textOf).filter(Boolean).join(', ');
    if (typeof v === 'object') return oneLine(v.name || v.text || '');
    return oneLine(v);
  }

  const STEP_PREFIX = /^(?:(?:step|paso|étape|etape|schritt|passo)\s*\d+\s*[:.)\-–]?\s*|\d+\s*[.)\-–]\s+)/i;

  /** Pasos agrupados en secciones: [{ name, steps: [texto] }]. */
  function instructions(raw) {
    const sections = [{ name: '', steps: [] }];
    const push = (text) => {
      for (const line of plain(text).split('\n')) {
        const t = line.replace(STEP_PREFIX, '').trim();
        if (t) sections[sections.length - 1].steps.push(t);
      }
    };
    const visit = (node) => {
      if (node == null) return;
      if (typeof node === 'string') { push(node); return; }
      if (Array.isArray(node)) { node.forEach(visit); return; }
      if (typeof node !== 'object') return;
      const type = node['@type'];
      const isSection = type === 'HowToSection' || (Array.isArray(type) && type.includes('HowToSection'));
      if (isSection || (node.itemListElement && !node.text)) {
        sections.push({ name: oneLine(node.name || ''), steps: [] });
        visit(node.itemListElement);
        return;
      }
      push(node.text || node.name || node.description || '');
    };
    visit(raw);
    return sections.filter((s) => s.steps.length);
  }

  function readRecipe() {
    const r = recipeFromJsonLd() || recipeFromMicrodata();
    if (!r) return null;
    const ingredients = (Array.isArray(r.recipeIngredient) ? r.recipeIngredient
      : Array.isArray(r.ingredients) ? r.ingredients
        : r.recipeIngredient ? [r.recipeIngredient] : [])
      .map(oneLine).filter(Boolean);
    const steps = instructions(r.recipeInstructions);
    if (!ingredients.length && !steps.length) return null;
    return {
      name: oneLine(r.name || ''),
      description: plain(r.description || ''),
      image: imageUrl(r.image),
      servings: textOf(Array.isArray(r.recipeYield) ? r.recipeYield[0] : r.recipeYield),
      prep: duration(r.prepTime),
      cook: duration(r.cookTime),
      total: duration(r.totalTime),
      calories: r.nutrition ? textOf(r.nutrition.calories) : '',
      ingredients,
      steps
    };
  }

  function recipeToMarkdown(rec, { ingredientsAsTasks }) {
    const out = [];
    if (rec.image) out.push(`![${mdText(rec.name)}](${mdUrl(rec.image)})`);
    if (rec.description) out.push(rec.description.split('\n').join('\n\n'));
    const meta = [
      [msg('recipe_servings', 'Raciones'), rec.servings],
      [msg('recipe_prep', 'Preparación'), rec.prep],
      [msg('recipe_cook', 'Cocción'), rec.cook],
      [msg('recipe_total', 'Total'), rec.total],
      [msg('recipe_calories', 'Calorías'), rec.calories]
    ].filter(([, v]) => v).map(([k, v]) => `**${k}:** ${v}`);
    if (meta.length) out.push(meta.join(' · '));
    if (rec.ingredients.length) {
      const marker = ingredientsAsTasks ? '- [ ] ' : '- ';
      out.push(`## ${msg('recipe_ingredients', 'Ingredientes')}\n${rec.ingredients.map((i) => marker + i).join('\n')}`);
    }
    if (rec.steps.length) {
      const blocks = [`## ${msg('recipe_steps', 'Elaboración')}`];
      for (const section of rec.steps) {
        const lines = section.steps.map((s, i) => `${i + 1}. ${s}`).join('\n');
        blocks.push(section.name ? `### ${section.name}\n${lines}` : lines);
      }
      out.push(blocks.join('\n\n'));
    }
    return tidy(out.join('\n\n'));
  }

  // ------------------------------------------------------------------
  // Selección, artículo y página
  // ------------------------------------------------------------------

  function selectionContainer() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.toString().trim()) return null;
    const div = document.createElement('div');
    for (let i = 0; i < sel.rangeCount; i++) {
      const range = sel.getRangeAt(i);
      const frag = range.cloneContents();
      // Si la selección está dentro de una lista, se conserva la lista.
      const ancestor = range.commonAncestorContainer;
      const host = ancestor.nodeType === 1 ? ancestor : ancestor.parentElement;
      if (host && /^(UL|OL)$/.test(host.nodeName) && frag.firstElementChild?.nodeName === 'LI') {
        const list = document.createElement(host.nodeName);
        list.appendChild(frag);
        div.appendChild(list);
      } else {
        div.appendChild(frag);
      }
    }
    return div;
  }

  function readArticle() {
    try {
      const doc = document.cloneNode(true);
      prepareStructure(doc);
      const article = new Readability(doc, { charThreshold: 300, keepClasses: false }).parse();
      if (!article || !article.content) return null;
      const container = document.createElement('div');
      container.innerHTML = article.content;
      const markdown = htmlToMarkdown(prepareClone(container, { stripChrome: false }));
      if (markdown.replace(/\s/g, '').length < 80) return null;
      return { title: oneLine(article.title || ''), markdown, excerpt: oneLine(article.excerpt || '') };
    } catch {
      return null;
    }
  }

  function readPage() {
    const clone = document.body ? document.body.cloneNode(true) : document.createElement('div');
    return htmlToMarkdown(prepareClone(clone, { stripChrome: true }));
  }

  function metaContent(...names) {
    for (const n of names) {
      const el = document.querySelector(`meta[property="${n}"], meta[name="${n}"]`);
      if (el && el.content) return el.content.trim();
    }
    return '';
  }

  function linkOnly(title) {
    const desc = oneLine(metaContent('og:description', 'description', 'twitter:description'));
    const image = absolute(metaContent('og:image', 'twitter:image'));
    const out = [`[${mdText(title || location.href)}](${mdUrl(location.href)})`];
    if (desc) out.push(`> ${desc}`);
    if (image) out.push(`![](${mdUrl(image)})`);
    return out.join('\n\n');
  }

  // ------------------------------------------------------------------
  // Punto de entrada
  // ------------------------------------------------------------------

  window.__misNotasExtract = (options = {}) => {
    const pageTitle = oneLine(metaContent('og:title') || document.title || '') || location.hostname;
    markImages();
    try {
      const recipe = readRecipe();
      const selection = selectionContainer();
      const modes = { recipe: Boolean(recipe), selection: Boolean(selection) };

      let mode = options.mode || 'auto';
      if (mode === 'auto') mode = selection ? 'selection' : recipe ? 'recipe' : 'article';
      if (mode === 'recipe' && !recipe) mode = 'article';
      if (mode === 'selection' && !selection) mode = 'article';

      let title = pageTitle;
      let markdown = '';
      if (mode === 'recipe') {
        title = recipe.name || pageTitle;
        markdown = recipeToMarkdown(recipe, options);
      } else if (mode === 'selection') {
        markdown = htmlToMarkdown(prepareClone(selection, { stripChrome: false }));
      } else if (mode === 'article') {
        const article = readArticle();
        if (article) {
          title = article.title || pageTitle;
          markdown = article.markdown;
        } else {
          mode = 'page';
        }
      }
      if (mode === 'page') markdown = readPage();
      if (mode === 'link') markdown = linkOnly(pageTitle);

      return { title, url: location.href, mode, markdown, modes };
    } finally {
      unmarkImages();
    }
  };
})();
