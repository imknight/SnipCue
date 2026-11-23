import { useId, useRef } from 'react';

export function MoreActions({ label, actions }: {
  label: string;
  actions: { label: string; onSelect: () => void; danger?: boolean }[];
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  return (
    <>
      <button ref={trigger} type="button" className="icon-button" aria-label={label} title={label} {...{ popovertarget: id }}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const menu = popover.current!;
          const spaceBelow = window.innerHeight - rect.bottom;
          const above = spaceBelow < 175 && rect.top > spaceBelow;
          menu.style.top = above ? 'auto' : `${rect.bottom + 4}px`;
          menu.style.bottom = above ? `${window.innerHeight - rect.top + 4}px` : 'auto';
          menu.style.right = `${Math.min(window.innerWidth - 180, window.innerWidth - rect.right)}px`;
        }}><span aria-hidden="true">⋯</span></button>
      <div ref={popover} id={id} role="group" aria-label={label} className="card library-menu" {...{ popover: 'auto' }}>
        {actions.map((action, index) => (
          <div key={action.label}>
            {!!action.danger && index > 0 && <hr />}
            <button type="button" className={action.danger ? 'danger' : undefined} onClick={() => {
              popover.current?.hidePopover();
              trigger.current?.focus({ preventScroll: true });
              action.onSelect();
            }}>{action.label}</button>
          </div>
        ))}
      </div>
    </>
  );
}
