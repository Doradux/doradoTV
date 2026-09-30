import { createMorph } from 'morphicons/dom';
import { ChevronDown, ChevronUp } from 'lucide';

// Keep the native select as the value/change-event source for the channel filter.
export function createCustomSelect(select, trigger, list, label, chevron, config = {}) {
  const morph = createMorph(chevron, ChevronDown, { reducedMotion: 'user' });
  const controller = new AbortController();
  const { signal } = controller;
  const portal = config.portal === true;
  const labelPrefix = config.labelPrefix || 'Filtrar categoría';
  const listParent = list.parentNode;
  const listNextSibling = list.nextSibling;
  let portalRestoreTimer = null;
  let expanded = false;
  let active = 0;
  let query = '';
  let lastTyped = 0;
  const options = () => [...select.options];

  function highlight(index) {
    active = Math.max(0, Math.min(index, list.children.length - 1));
    [...list.children].forEach((item, i) => item.classList.toggle('is-active', i === active));
    const item = list.children[active];
    if (expanded && item) {
      trigger.setAttribute('aria-activedescendant', item.id);
      item.scrollIntoView({ block: 'nearest' });
    }
  }

  function restorePortal() {
    if (!portal || list.parentNode !== document.body) return;
    list.classList.remove('is-portaled');
    for (const property of ['position', 'top', 'right', 'bottom', 'left', 'width', 'maxWidth', 'zIndex']) list.style[property] = '';
    if (listNextSibling?.parentNode === listParent) listParent.insertBefore(list, listNextSibling);
    else listParent.append(list);
  }

  function position() {
    const rect = trigger.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom - 16;
    const above = rect.top - 16;
    const upwards = below < 240 && above > below;
    list.dataset.side = upwards ? 'top' : 'bottom';
    list.style.maxHeight = `${Math.max(60, Math.min(288, upwards ? above : below))}px`;
    if (!portal) return;

    const viewportPadding = 12;
    const width = Math.min(Math.max(rect.width, 240), window.innerWidth - viewportPadding * 2);
    const left = Math.min(Math.max(viewportPadding, rect.left), window.innerWidth - width - viewportPadding);
    list.style.position = 'fixed';
    list.style.left = `${left}px`;
    list.style.width = `${width}px`;
    list.style.maxWidth = `${window.innerWidth - viewportPadding * 2}px`;
    list.style.zIndex = '100';
    if (upwards) {
      list.style.top = 'auto';
      list.style.bottom = `${Math.max(viewportPadding, window.innerHeight - rect.top + 8)}px`;
    } else {
      list.style.top = `${Math.max(viewportPadding, rect.bottom + 8)}px`;
      list.style.bottom = 'auto';
    }
  }

  function setOpen(next) {
    expanded = next;
    trigger.setAttribute('aria-expanded', String(next));
    list.setAttribute('aria-hidden', String(!next));
    list.inert = !next;
    list.classList.toggle('is-open', next);
    trigger.closest('.channel-panel')?.classList.toggle('has-open-select', next);
    morph.morphTo(next ? ChevronUp : ChevronDown, 'snappy');
    query = '';
    clearTimeout(portalRestoreTimer);
    if (next) {
      if (portal && list.parentNode !== document.body) {
        document.body.append(list);
        list.classList.add('is-portaled');
      }
      position();
      highlight(select.selectedIndex);
    } else {
      trigger.removeAttribute('aria-activedescendant');
      if (portal) portalRestoreTimer = setTimeout(() => { if (!expanded) restorePortal(); }, 260);
    }
  }

  function choose(index) {
    select.selectedIndex = index;
    refresh();
    setOpen(false);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function refresh() {
    label.textContent = select.selectedOptions[0]?.textContent || 'Todas las categorías';
    trigger.setAttribute('aria-label', `${labelPrefix}: ${label.textContent}`);
    list.replaceChildren(...options().map((option, index) => {
      const item = document.createElement('div');
      item.id = `${select.id}-option-${index}`;
      item.className = 'select-option';
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', String(option.selected));
      item.dataset.index = index;
      const text = document.createElement('span');
      text.textContent = option.textContent;
      const check = document.createElement('span');
      check.className = 'select-check';
      check.setAttribute('aria-hidden', 'true');
      check.textContent = '✓';
      item.append(text, check);
      return item;
    }));
    if (expanded) highlight(select.selectedIndex);
  }

  trigger.addEventListener('click', () => setOpen(!expanded), { signal });
  trigger.addEventListener('keydown', (event) => {
    const key = event.key;
    if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' ', 'Escape'].includes(key)) {
      event.preventDefault();
      if (key === 'Escape') { if (expanded) event.stopPropagation(); setOpen(false); return; }
      if (key === 'Enter' || key === ' ') {
        if (expanded) choose(active); else setOpen(true);
        return;
      }
      if (!expanded) setOpen(true);
      if (key === 'Home') highlight(0);
      else if (key === 'End') highlight(list.children.length - 1);
      else highlight(active + (key === 'ArrowDown' ? 1 : -1));
    } else if (key === 'Tab') setOpen(false);
    else if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      if (!expanded) setOpen(true);
      const now = performance.now();
      query = (now - lastTyped > 700 ? '' : query) + key.toLocaleLowerCase('es');
      lastTyped = now;
      const index = options().findIndex((option) => option.textContent.toLocaleLowerCase('es').startsWith(query));
      if (index >= 0) highlight(index);
    }
  }, { signal });
  list.addEventListener('mousedown', (event) => event.preventDefault(), { signal });
  list.addEventListener('click', (event) => {
    const option = event.target.closest('[data-index]');
    if (option) { choose(Number(option.dataset.index)); trigger.focus({ preventScroll: true }); }
  }, { signal });
  document.addEventListener('pointerdown', (event) => {
    if (expanded && !trigger.parentElement.contains(event.target) && !list.contains(event.target)) setOpen(false);
  }, { signal });
  trigger.addEventListener('blur', () => setOpen(false), { signal });
  window.addEventListener('resize', () => { if (expanded) position(); }, { signal });
  document.addEventListener('scroll', () => { if (expanded) position(); }, { capture: true, signal });
  select.addEventListener('change', refresh, { signal });
  list.inert = true;
  refresh();
  return { refresh, destroy() { clearTimeout(portalRestoreTimer); restorePortal(); controller.abort(); morph.destroy(); } };
}
