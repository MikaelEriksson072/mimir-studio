import { useRef } from 'react';
import { cx } from '../lib/util';

/** Drag handle between panels; reports the pointer delta in pixels. */
export function Splitter({ dir, className, onDrag }: { dir: 'v' | 'h'; className?: string; onDrag: (delta: number) => void }) {
  const start = useRef(0);
  return <div className={cx('splitter', dir, className)} role="separator" aria-orientation={dir === 'v' ? 'vertical' : 'horizontal'}
    onMouseDown={e => {
      e.preventDefault(); start.current = dir === 'v' ? e.clientX : e.clientY;
      const mv = (ev: MouseEvent) => { const p = dir === 'v' ? ev.clientX : ev.clientY; onDrag(p - start.current); start.current = p; };
      const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); document.body.classList.remove('dragging'); };
      document.body.classList.add('dragging');
      window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
    }} />;
}
