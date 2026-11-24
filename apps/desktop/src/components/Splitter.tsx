import { useRef } from 'react';
import { cx } from '../lib/util';

/** Drag handle between panels; reports the pointer delta in pixels (a double-click, `onReset`, where it has one). */
export function Splitter({ dir, className, onDrag, onReset, title, label }: { dir: 'v' | 'h'; className?: string; onDrag: (delta: number) => void; onReset?: () => void; title?: string; label?: string }) {
  const start = useRef(0);
  return <div className={cx('splitter', dir, className)} role="separator" aria-orientation={dir === 'v' ? 'vertical' : 'horizontal'} title={title} aria-label={label}
    onDoubleClick={onReset}
    onMouseDown={e => {
      e.preventDefault(); start.current = dir === 'v' ? e.clientX : e.clientY;
      const mv = (ev: MouseEvent) => { const p = dir === 'v' ? ev.clientX : ev.clientY; onDrag(p - start.current); start.current = p; };
      const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); document.body.classList.remove('dragging'); };
      document.body.classList.add('dragging');
      window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
    }} />;
}
