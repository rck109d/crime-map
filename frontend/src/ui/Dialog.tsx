import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { CloseIcon } from "./icons";

interface Props {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ComponentChildren;
  footer?: ComponentChildren;
}

/** Modal built on <dialog>: a bottom sheet on phones, a centred card on wide screens. */
export function Dialog({ title, open, onClose, children, footer }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current!;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      class="dialog"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose(); // click on the backdrop
      }}
    >
      {open && (
        <div class="dialog-body">
          <div class="dialog-head">
            <h2>{title}</h2>
            <button class="icon-button" onClick={onClose} aria-label="Close">
              <CloseIcon size={18} />
            </button>
          </div>
          <div class="dialog-scroll">{children}</div>
          {footer && <div class="dialog-foot">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}
