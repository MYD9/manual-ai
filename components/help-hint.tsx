'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { CircleHelp } from 'lucide-react';
import { Popover, PopoverContent, PopoverDescription, PopoverTitle, PopoverTrigger } from '@/components/ui/popover';
import { tokens } from '@/lib/motion';

export function useHintHover() {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    const media = window.matchMedia('(hover: hover) and (pointer: fine)');
    const update = () => setEnabled(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return enabled;
}

/** On-demand guidance: mouse hover, keyboard focus, or an explicit touch/click. */
export function HelpHint({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const hover = useHintHover();
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className="icon-btn help-hint"
        aria-label={label}
        openOnHover={hover}
        delay={tokens.duration.normal}
        closeDelay={tokens.duration.fast}
        onFocus={event => {
          if (event.currentTarget.matches(':focus-visible')) setOpen(true);
        }}
      ><CircleHelp size={15} aria-hidden="true" /></PopoverTrigger>
      <PopoverContent className="help-hint-content" side="top" align="start" initialFocus={false} finalFocus={false}>
        <PopoverTitle className="sr-only">{label}</PopoverTitle>
        <PopoverDescription>{children}</PopoverDescription>
      </PopoverContent>
    </Popover>
  );
}
