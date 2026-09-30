const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function reveal(element) {
  if (!element || reducedMotion()) return;
  element.getAnimations().forEach((animation) => animation.cancel());
  element.animate([
    { opacity: 0, transform: 'translateY(6px)', filter: 'blur(3px)' },
    { opacity: 1, transform: 'translateY(0)', filter: 'blur(0)' },
  ], { duration: 320, easing: 'cubic-bezier(.2,.8,.2,1)' });
}

export function createDialog(modal, opener, initialFocus) {
  const panel = modal.firstElementChild;
  let open = false;
  let revision = 0;
  let previousOverflow = '';
  let siblings = [];
  const animate = (closing) => {
    [modal, panel].forEach((element) => element.getAnimations().forEach((animation) => animation.cancel()));
    if (reducedMotion()) return Promise.resolve();
    const options = { duration: closing ? 180 : 300, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'both' };
    const fade = [{ opacity: 0 }, { opacity: 1 }];
    const lift = [
      { opacity: 0, transform: 'translateY(16px) scale(.97)', filter: 'blur(5px)' },
      { opacity: 1, transform: 'translateY(0) scale(1)', filter: 'blur(0)' },
    ];
    modal.animate(closing ? fade.toReversed() : fade, options);
    return panel.animate(closing ? lift.toReversed() : lift, options).finished.catch(() => {});
  };
  modal.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab' || !open) return;
    const focusable = [...modal.querySelectorAll('button, input, a[href], [tabindex="0"]')]
      .filter((element) => !element.disabled && element.getClientRects().length);
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  });
  return {
    show() {
      if (open) return;
      revision += 1;
      open = true;
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      siblings = [...modal.parentElement.children].filter((element) => element !== modal).map((element) => [element, element.inert]);
      siblings.forEach(([element]) => { element.inert = true; });
      modal.inert = false;
      modal.classList.remove('hidden');
      modal.classList.add('flex');
      animate(false);
      initialFocus?.focus({ preventScroll: true });
    },
    async hide() {
      if (!open) return;
      const current = ++revision;
      open = false;
      modal.inert = true;
      await animate(true);
      if (current !== revision) return;
      modal.classList.add('hidden');
      modal.classList.remove('flex');
      document.body.style.overflow = previousOverflow;
      siblings.forEach(([element, inert]) => { element.inert = inert; });
      opener?.focus({ preventScroll: true });
    },
  };
}
